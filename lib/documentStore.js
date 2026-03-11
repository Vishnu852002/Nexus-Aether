// ═══════════════════════════════════════════
// DOCUMENT STORE — Phase 19
// Text extraction, chunking, and BM25 retrieval
// ═══════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DOCS_DIR = path.join(DATA_DIR, 'documents');

// Ensure directory exists
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

// ─── TEXT EXTRACTION ───

async function extractText(filePath, mimeType) {
    const ext = path.extname(filePath).toLowerCase();

    // Plain text formats
    const textExts = ['.txt', '.md', '.markdown', '.json', '.csv', '.tsv',
        '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h',
        '.cs', '.go', '.rs', '.rb', '.php', '.html', '.css', '.scss',
        '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.env',
        '.sh', '.bat', '.ps1', '.sql', '.r', '.swift', '.kt',
        '.log', '.gitignore', '.dockerfile'];

    if (textExts.includes(ext)) {
        return fs.readFileSync(filePath, 'utf8');
    }

    // PDF
    if (ext === '.pdf') {
        let parser;
        try {
            const { PDFParse } = require('pdf-parse');
            const dataBuffer = fs.readFileSync(filePath);
            parser = new PDFParse({ data: dataBuffer });
            const result = await parser.getText();
            await parser.destroy();
            return result.text || '';
        } catch (e) {
            if (parser) { try { await parser.destroy(); } catch (err) { } }
            throw new Error(`PDF extraction failed: ${e.message}`);
        }
    }

    throw new Error(`Unsupported file type: ${ext}`);
}

// ─── CHUNKING ───

function chunkText(text, chunkSize = 500, overlap = 100) {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    if (words.length <= chunkSize) {
        return [{ text: words.join(' '), index: 0 }];
    }

    const chunks = [];
    let i = 0;
    let chunkIdx = 0;

    while (i < words.length) {
        const end = Math.min(i + chunkSize, words.length);
        chunks.push({
            text: words.slice(i, end).join(' '),
            index: chunkIdx++
        });
        i += chunkSize - overlap;
        if (i >= words.length) break;
    }

    return chunks;
}

// ─── BM25 SEARCH (no embeddings needed!) ───

function tokenize(text) {
    return text.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2);
}

function bm25Search(query, chunks, topK = 5) {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return chunks.slice(0, topK);

    const N = chunks.length;
    const avgDl = chunks.reduce((sum, c) => sum + tokenize(c.text).length, 0) / N;
    const k1 = 1.5;
    const b = 0.75;

    // Document frequency for each query term
    const df = {};
    for (const token of queryTokens) {
        df[token] = chunks.filter(c => tokenize(c.text).includes(token)).length;
    }

    const scores = chunks.map((chunk, idx) => {
        const chunkTokens = tokenize(chunk.text);
        const dl = chunkTokens.length;

        // Count term frequencies
        const tf = {};
        for (const t of chunkTokens) {
            tf[t] = (tf[t] || 0) + 1;
        }

        let score = 0;
        for (const token of queryTokens) {
            const termFreq = tf[token] || 0;
            const docFreq = df[token] || 0;

            // IDF component
            const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);

            // TF component with length normalization
            const tfNorm = (termFreq * (k1 + 1)) / (termFreq + k1 * (1 - b + b * dl / avgDl));

            score += idf * tfNorm;
        }

        return { chunk, score, index: idx };
    });

    return scores
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .filter(s => s.score > 0)
        .map(s => s.chunk);
}

// ─── DOCUMENT CRUD ───

function getMetadataPath(docId) {
    return path.join(DOCS_DIR, `${docId}.json`);
}

function getChunksPath(docId) {
    return path.join(DOCS_DIR, `${docId}.chunks.json`);
}

function getOriginalPath(docId, ext) {
    return path.join(DOCS_DIR, `${docId}${ext}`);
}

function listDocuments() {
    if (!fs.existsSync(DOCS_DIR)) return [];
    return fs.readdirSync(DOCS_DIR)
        .filter(f => f.endsWith('.json') && !f.endsWith('.chunks.json'))
        .map(f => {
            try {
                return JSON.parse(fs.readFileSync(path.join(DOCS_DIR, f), 'utf8'));
            } catch { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getDocument(docId) {
    const metaPath = getMetadataPath(docId);
    if (!fs.existsSync(metaPath)) return null;
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
}

function getDocumentChunks(docId) {
    const chunksPath = getChunksPath(docId);
    if (!fs.existsSync(chunksPath)) return [];
    return JSON.parse(fs.readFileSync(chunksPath, 'utf8'));
}

async function ingestDocument(filePath, originalName) {
    const docId = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(originalName).toLowerCase();

    // Extract text
    const text = await extractText(filePath, null);
    const wordCount = text.split(/\s+/).length;

    // Chunk the text
    const chunks = chunkText(text);

    // Save original file
    const savedPath = getOriginalPath(docId, ext);
    fs.copyFileSync(filePath, savedPath);

    // Save metadata
    const metadata = {
        id: docId,
        name: originalName,
        ext: ext,
        size: fs.statSync(filePath).size,
        wordCount,
        chunkCount: chunks.length,
        status: 'ready',
        createdAt: new Date().toISOString()
    };
    fs.writeFileSync(getMetadataPath(docId), JSON.stringify(metadata, null, 2));

    // Save chunks
    fs.writeFileSync(getChunksPath(docId), JSON.stringify(chunks, null, 2));

    console.log(`[DocStore] Ingested "${originalName}" → ${chunks.length} chunks, ${wordCount} words`);
    return metadata;
}

function deleteDocument(docId) {
    const doc = getDocument(docId);
    if (!doc) return false;

    // Remove all files for this document
    const files = [
        getMetadataPath(docId),
        getChunksPath(docId),
        getOriginalPath(docId, doc.ext)
    ];
    for (const f of files) {
        try { fs.unlinkSync(f); } catch { }
    }
    return true;
}

// ─── RAG QUERY ───

function retrieveContext(query, docIds = null, topK = 5) {
    let allChunks = [];

    const docs = listDocuments();
    const targetDocs = docIds
        ? docs.filter(d => docIds.includes(d.id))
        : docs;

    for (const doc of targetDocs) {
        const chunks = getDocumentChunks(doc.id);
        allChunks.push(...chunks.map(c => ({
            ...c,
            docId: doc.id,
            docName: doc.name
        })));
    }

    if (allChunks.length === 0) return [];

    return bm25Search(query, allChunks, topK);
}

function buildRAGPrompt(query, contextChunks) {
    if (contextChunks.length === 0) {
        return `The user asked: "${query}"\n\nNo relevant document context was found. Answer based on your general knowledge, but mention that no matching content was found in the uploaded documents.`;
    }

    const context = contextChunks.map((c, i) =>
        `[Source: ${c.docName}, Chunk ${c.index + 1}]\n${c.text}`
    ).join('\n\n---\n\n');

    return `You are answering a question based on the user's uploaded documents. Use ONLY the provided context to answer. If the context doesn't contain enough information, say so.

## Document Context
${context}

## User Question
${query}

Answer the question using the document context above. Cite which source document the information comes from. Be thorough but concise.`;
}

module.exports = {
    extractText,
    chunkText,
    bm25Search,
    listDocuments,
    getDocument,
    getDocumentChunks,
    ingestDocument,
    deleteDocument,
    retrieveContext,
    buildRAGPrompt
};
