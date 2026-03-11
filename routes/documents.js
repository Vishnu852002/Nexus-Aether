const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const docStore = require('../lib/documentStore');
const { chatWithFailover, route, STRATEGY } = require('../lib/router');
const { getConfig } = require('../lib/store');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_TMP = path.join(DATA_DIR, 'documents', '_tmp');
if (!fs.existsSync(UPLOAD_TMP)) fs.mkdirSync(UPLOAD_TMP, { recursive: true });

// ─── LIST DOCUMENTS ───
router.get('/', (req, res) => {
    try {
        const docs = docStore.listDocuments();
        res.json(docs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── UPLOAD DOCUMENT ───
// Note: This route is explicitly mounted in server.js to bypass express.json()
// ─── UPLOAD DOCUMENT HANDLER ───
// Exported separately so server.js can mount it before express.json()
const uploadDocument = async (req, res) => {
    try {
        const originalName = req.headers['x-filename'] || 'document.txt';
        const ext = path.extname(originalName).toLowerCase();

        // Validate file type
        const allowedExts = ['.txt', '.md', '.pdf', '.json', '.csv', '.tsv',
            '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h',
            '.cs', '.go', '.rs', '.rb', '.php', '.html', '.css', '.scss',
            '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg',
            '.sh', '.bat', '.ps1', '.sql', '.r', '.swift', '.kt',
            '.log', '.gitignore', '.dockerfile', '.markdown'];

        if (!allowedExts.includes(ext)) {
            return res.status(400).json({ error: `Unsupported file type: ${ext}. Supported: ${allowedExts.join(', ')}` });
        }

        // Save to temp
        const tmpPath = path.join(UPLOAD_TMP, `${crypto.randomBytes(8).toString('hex')}${ext}`);

        let fileBuffer = req.body;
        if (!Buffer.isBuffer(fileBuffer)) {
            if (typeof fileBuffer === 'object' && Object.keys(fileBuffer).length === 0) {
                throw new Error("Empty or missing file data. Check upload middleware.");
            }
            fileBuffer = Buffer.from(fileBuffer);
        }

        fs.writeFileSync(tmpPath, fileBuffer);

        // Ingest
        const metadata = await docStore.ingestDocument(tmpPath, originalName);

        // Cleanup temp
        try { fs.unlinkSync(tmpPath); } catch { }

        res.json(metadata);
    } catch (err) {
        console.error('[Documents] Upload error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

// ─── DELETE DOCUMENT ───
router.delete('/:id', (req, res) => {
    try {
        const success = docStore.deleteDocument(req.params.id);
        if (!success) return res.status(404).json({ error: 'Document not found' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── RAG QUERY (streaming) ───
router.post('/query', (req, res) => {
    const { query, docIds } = req.body;
    if (!query) return res.status(400).json({ error: 'Missing query' });

    // SSE setup
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true);
    req.socket.setTimeout(0);

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();
    res.write(': connected\n\n');

    let done = false;
    const keepAlive = setInterval(() => {
        if (!done) { try { res.write(': ping\n\n'); } catch { } }
        else clearInterval(keepAlive);
    }, 3000);

    (async () => {
        try {
            // Step 1: Retrieve relevant chunks
            const contextChunks = docStore.retrieveContext(query, docIds, 6);

            // Send retrieval info to client
            res.write(`data: ${JSON.stringify({
                retrieval: {
                    chunksFound: contextChunks.length,
                    sources: [...new Set(contextChunks.map(c => c.docName))]
                }
            })}\n\n`);

            // Step 2: Build RAG prompt
            const ragPrompt = docStore.buildRAGPrompt(query, contextChunks);

            // Step 3: Route to a model
            let targetModel = req.body.model;
            let targetProvider = req.body.provider;

            if (!targetModel) {
                const routeResult = await route({
                    messages: [{ role: 'user', content: query }],
                    strategy: STRATEGY.AUTO
                });
                targetModel = routeResult.model;
                targetProvider = routeResult.provider;
            }

            if (!targetModel) {
                res.write(`data: ${JSON.stringify({ error: 'No models available. Configure a provider in Settings.' })}\n\n`);
                res.write('data: [DONE]\n\n');
                done = true;
                clearInterval(keepAlive);
                return res.end();
            }

            // Step 4: Stream the AI response with document context
            await chatWithFailover(
                {
                    messages: [{ role: 'user', content: ragPrompt }],
                    model: targetModel,
                    provider: targetProvider,
                    systemPrompt: 'You are a document analysis assistant. Answer questions using ONLY the provided document context. Be precise, cite sources, and format your answers with markdown.',
                    strategy: 'auto'
                },
                (text) => {
                    if (!done) res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
                },
                () => {
                    if (!done) {
                        done = true;
                        clearInterval(keepAlive);
                        res.write('data: [DONE]\n\n');
                        setTimeout(() => { try { res.end(); } catch { } }, 50);
                    }
                },
                (err) => {
                    if (!done) {
                        done = true;
                        clearInterval(keepAlive);
                        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
                        setTimeout(() => { try { res.end(); } catch { } }, 50);
                    }
                }
            );
        } catch (err) {
            if (!done) {
                done = true;
                clearInterval(keepAlive);
                res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
                res.write('data: [DONE]\n\n');
                try { res.end(); } catch { }
            }
        }
    })();

    res.on('close', () => {
        done = true;
        clearInterval(keepAlive);
    });
});

// ─── SUMMARIZE / STUDY GUIDE ───
router.post('/summarize/:id', (req, res) => {
    const doc = docStore.getDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const { mode } = req.body; // 'summary', 'study-guide', 'key-points'

    // SSE setup
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true);
    req.socket.setTimeout(0);

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();
    res.write(': connected\n\n');

    let done = false;
    const keepAlive = setInterval(() => {
        if (!done) { try { res.write(': ping\n\n'); } catch { } }
        else clearInterval(keepAlive);
    }, 3000);

    (async () => {
        try {
            // Get all chunks
            const chunks = docStore.getDocumentChunks(req.params.id);
            const fullText = chunks.map(c => c.text).join('\n\n');

            // Truncate if very long (keep first ~6000 words for summary)
            const words = fullText.split(/\s+/);
            const truncatedText = words.length > 6000
                ? words.slice(0, 6000).join(' ') + '\n\n[... document continues ...]'
                : fullText;

            const prompts = {
                'summary': `Provide a comprehensive summary of the following document. Include the main topics, key arguments, and conclusions.\n\n## Document: ${doc.name}\n\n${truncatedText}`,
                'study-guide': `Create a detailed study guide for the following document. Include:\n1. **Key Concepts** — the most important ideas\n2. **Definitions** — important terms and their meanings\n3. **Summary by Section** — break down the main sections\n4. **Review Questions** — 5-10 questions to test understanding\n5. **Key Takeaways** — the most critical points to remember\n\n## Document: ${doc.name}\n\n${truncatedText}`,
                'key-points': `Extract the key points from the following document as a numbered list. Focus on the most important facts, arguments, and conclusions.\n\n## Document: ${doc.name}\n\n${truncatedText}`
            };

            const prompt = prompts[mode] || prompts['summary'];

            // Route to model
            let targetModel = req.body.model;
            let targetProvider = req.body.provider;

            if (!targetModel) {
                const routeResult = await route({
                    messages: [{ role: 'user', content: 'summarize' }],
                    strategy: STRATEGY.AUTO
                });
                targetModel = routeResult.model;
                targetProvider = routeResult.provider;
            }

            if (!targetModel) {
                res.write(`data: ${JSON.stringify({ error: 'No models available.' })}\n\n`);
                res.write('data: [DONE]\n\n');
                done = true;
                clearInterval(keepAlive);
                return res.end();
            }

            await chatWithFailover(
                {
                    messages: [{ role: 'user', content: prompt }],
                    model: targetModel,
                    provider: targetProvider,
                    systemPrompt: 'You are an expert document analyst. Generate clear, well-structured analysis in markdown format.',
                    strategy: 'auto'
                },
                (text) => {
                    if (!done) res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
                },
                () => {
                    if (!done) {
                        done = true;
                        clearInterval(keepAlive);
                        res.write('data: [DONE]\n\n');
                        setTimeout(() => { try { res.end(); } catch { } }, 50);
                    }
                },
                (err) => {
                    if (!done) {
                        done = true;
                        clearInterval(keepAlive);
                        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
                        setTimeout(() => { try { res.end(); } catch { } }, 50);
                    }
                }
            );
        } catch (err) {
            if (!done) {
                done = true;
                clearInterval(keepAlive);
                res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
                res.write('data: [DONE]\n\n');
                try { res.end(); } catch { }
            }
        }
    })();

    res.on('close', () => {
        done = true;
        clearInterval(keepAlive);
    });
});

module.exports = {
    router,
    uploadDocument
};
