const express = require('express');
const router = express.Router();
const http = require('http');
const https = require('https');
const { getConfig } = require('../lib/store');
const { getModelPricing, isExpensive } = require('../lib/pricing');

// ═══ POPULAR MODELS FALLBACK ═══
const POPULAR_MODELS = [
    { name: 'llama3.1', desc: 'Meta Llama 3.1 — versatile open-weight LLM', pulls: '50M+', sizes: ['8b', '70b', '405b'] },
    { name: 'gemma2', desc: 'Google Gemma 2 — lightweight and efficient', pulls: '15M+', sizes: ['2b', '9b', '27b'] },
    { name: 'mistral', desc: 'Mistral 7B — fast and capable', pulls: '20M+', sizes: ['7b'] },
    { name: 'phi3', desc: 'Microsoft Phi-3 — compact powerhouse', pulls: '8M+', sizes: ['3.8b', '14b'] },
    { name: 'qwen2.5', desc: 'Alibaba Qwen 2.5 — multilingual', pulls: '10M+', sizes: ['0.5b', '1.5b', '3b', '7b', '14b', '32b', '72b'] },
    { name: 'codellama', desc: 'Meta Code Llama — coding specialist', pulls: '5M+', sizes: ['7b', '13b', '34b', '70b'] },
    { name: 'deepseek-r1', desc: 'DeepSeek R1 — reasoning model', pulls: '12M+', sizes: ['1.5b', '7b', '8b', '14b', '32b', '70b'] },
    { name: 'llava', desc: 'LLaVA — multimodal vision + language', pulls: '6M+', sizes: ['7b', '13b', '34b'] },
    { name: 'nomic-embed-text', desc: 'Nomic — text embedding model', pulls: '10M+', sizes: ['v1.5'] },
    { name: 'mixtral', desc: 'Mistral MoE — mixture of experts', pulls: '4M+', sizes: ['8x7b', '8x22b'] },
];

// ═══ HELPERS ═══
function fetchUrl(url, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const transport = url.startsWith('https') ? https : http;
        const req = transport.get(url, { timeout, headers: { 'User-Agent': 'NexusAI/1.0' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                fetchUrl(res.headers.location, timeout).then(resolve).catch(reject);
                res.resume();
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
}

function getOllamaBase() {
    const config = getConfig();
    return config.providers?.ollama?.baseUrl || 'http://localhost:11434';
}

const providers = {
    openai: require('../lib/providers/openai'),
    anthropic: require('../lib/providers/anthropic'),
    gemini: require('../lib/providers/gemini'),
    openrouter: require('../lib/providers/openrouter'),
    ollama: require('../lib/providers/ollama'),
    lmstudio: require('../lib/providers/lmstudio')
};

// GET /api/models — fetch models from all configured providers
router.get('/', async (req, res) => {
    try {
        const config = getConfig();
        const results = {};

        const fetchPromises = Object.entries(config.providers || {}).map(async ([name, pConfig]) => {
            if (!pConfig.enabled) return;

            try {
                const provider = providers[name];
                if (!provider) return;

                const authOrBase = ['ollama', 'lmstudio'].includes(name)
                    ? pConfig.baseUrl
                    : pConfig.apiKey;

                if (!authOrBase && !['ollama', 'lmstudio'].includes(name)) return;

                const models = await provider.listModels(authOrBase);

                // Enrich with pricing for cloud models
                results[name] = models.map(m => {
                    // Prefer dynamic pricing (like from OpenRouter API) over hardcoded fallbacks
                    const pricing = m.pricing || getModelPricing(m.id);
                    return {
                        ...m,
                        pricing: pricing || undefined,
                        expensive: pricing ? (pricing.input >= 10) : isExpensive(m.id)
                    };
                });
            } catch (err) {
                results[name] = { error: err.message };
            }
        });

        await Promise.all(fetchPromises);
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/models/status — check which providers are connected
router.get('/status', async (req, res) => {
    const config = getConfig();
    const status = {};

    for (const [name, pConfig] of Object.entries(config.providers || {})) {
        if (['ollama', 'lmstudio'].includes(name)) {
            try {
                const provider = providers[name];
                status[name] = {
                    enabled: pConfig.enabled,
                    connected: await provider.isAvailable(pConfig.baseUrl),
                    type: 'local'
                };
            } catch {
                status[name] = { enabled: pConfig.enabled, connected: false, type: 'local' };
            }
        } else {
            status[name] = {
                enabled: pConfig.enabled,
                configured: !!pConfig.apiKey,
                type: 'cloud'
            };
        }
    }

    res.json(status);
});

// ═══ MODEL LIBRARY — Browse Ollama models ═══

// GET /api/models/library?q=<query>&c=<category>
router.get('/library', async (req, res) => {
    const query = req.query.q || '';
    const category = req.query.c || '';

    try {
        let searchUrl = 'https://ollama.com/search';
        const params = new URLSearchParams();
        if (query) params.set('q', query);
        if (category) params.set('c', category);
        const qs = params.toString();
        if (qs) searchUrl += '?' + qs;

        const html = await fetchUrl(searchUrl);
        const models = parseSearchResults(html);
        res.json({ models, query, category });
    } catch (err) {
        console.log('[ModelLibrary] Ollama.com unreachable, using fallback catalog:', err.message);
        let filtered = POPULAR_MODELS;
        if (query) {
            const q = query.toLowerCase();
            filtered = filtered.filter(m => m.name.includes(q) || m.desc.toLowerCase().includes(q));
        }
        res.json({ models: filtered, query, category, fallback: true });
    }
});

function parseSearchResults(html) {
    const models = [];
    // Match model cards — each is an <li> or <a> block with model info
    // Pattern: look for links to /library/<name> with surrounding metadata
    const cardRegex = /<a[^>]*href="\/library\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = cardRegex.exec(html)) !== null) {
        const name = match[1];
        const cardHtml = match[2];

        // Extract description
        const descMatch = cardHtml.match(/<p[^>]*class="[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
        const desc = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';

        // Extract pull count
        const pullMatch = cardHtml.match(/([\d.]+[KMB]?)\s*(?:Pull|pull)/i);
        const pulls = pullMatch ? pullMatch[1] : '';

        // Extract size tags
        const sizes = [];
        const sizeRegex = /(\d+(?:\.\d+)?[bBxX][\d]*[bB]?)/g;
        let sizeMatch;
        while ((sizeMatch = sizeRegex.exec(cardHtml)) !== null) {
            sizes.push(sizeMatch[1].toLowerCase());
        }

        if (name && !models.find(m => m.name === name)) {
            models.push({ name, desc: desc.substring(0, 200), pulls, sizes });
        }
    }

    // If regex parsing failed, try a simpler pattern
    if (models.length === 0) {
        const simpleRegex = /href="\/library\/([^"]+)"/g;
        let sm;
        const seen = new Set();
        while ((sm = simpleRegex.exec(html)) !== null) {
            const name = sm[1];
            if (!seen.has(name) && !name.includes('/')) {
                seen.add(name);
                models.push({ name, desc: '', pulls: '', sizes: [] });
            }
        }
    }

    return models.slice(0, 50);
}

// GET /api/models/library/:name — model detail with size variants
router.get('/library/:name', async (req, res) => {
    const name = req.params.name;
    try {
        const html = await fetchUrl(`https://ollama.com/library/${encodeURIComponent(name)}`);

        // Extract description from meta or first paragraph
        const metaDesc = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/i);
        const desc = metaDesc ? metaDesc[1] : '';

        // Extract tags/variants with sizes
        const variants = [];
        // Look for tag entries — patterns like "8b", "70b" with associated sizes
        const tagRegex = /href="\/library\/[^"]*:([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        let tm;
        while ((tm = tagRegex.exec(html)) !== null) {
            const tag = tm[1];
            const block = tm[2];
            const sizeMatch = block.match(/([\d.]+)\s*(GB|MB)/i);
            const size = sizeMatch ? sizeMatch[1] + ' ' + sizeMatch[2].toUpperCase() : '';
            const sizeBytes = sizeMatch
                ? parseFloat(sizeMatch[1]) * (sizeMatch[2].toLowerCase() === 'gb' ? 1073741824 : 1048576)
                : 0;
            if (!variants.find(v => v.tag === tag)) {
                variants.push({ tag, size, sizeBytes: Math.round(sizeBytes) });
            }
        }

        res.json({ name, description: desc, variants });
    } catch (err) {
        res.status(502).json({ error: 'Failed to fetch model details: ' + err.message });
    }
});

// POST /api/models/pull — SSE streaming pull from Ollama
router.post('/pull', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Model name required' });

    const base = getOllamaBase();
    const url = new URL('/api/pull', base);
    const transport = url.protocol === 'https:' ? https : http;

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();

    const body = JSON.stringify({ name, stream: true });

    const ollamaReq = transport.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (ollamaRes) => {
        if (ollamaRes.statusCode !== 200) {
            let errBody = '';
            ollamaRes.on('data', d => errBody += d);
            ollamaRes.on('end', () => {
                res.write(`data: ${JSON.stringify({ error: `Ollama error ${ollamaRes.statusCode}: ${errBody}` })}\n\n`);
                res.end();
            });
            return;
        }

        let buffer = '';
        ollamaRes.on('data', chunk => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const data = JSON.parse(line);
                    res.write(`data: ${JSON.stringify(data)}\n\n`);
                    if (data.status === 'success') {
                        res.end();
                    }
                } catch { /* skip malformed lines */ }
            }
        });

        ollamaRes.on('end', () => {
            if (buffer.trim()) {
                try {
                    const data = JSON.parse(buffer);
                    res.write(`data: ${JSON.stringify(data)}\n\n`);
                } catch { /* ignore */ }
            }
            res.write(`data: ${JSON.stringify({ status: 'success' })}\n\n`);
            res.end();
        });

        ollamaRes.on('error', (err) => {
            res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
            res.end();
        });
    });

    ollamaReq.on('error', (err) => {
        res.write(`data: ${JSON.stringify({ error: 'Cannot connect to Ollama: ' + err.message })}\n\n`);
        res.end();
    });

    // Keepalive ping
    const pingInterval = setInterval(() => {
        try { res.write(': ping\n\n'); } catch { clearInterval(pingInterval); }
    }, 5000);

    // Cancel on client disconnect
    res.on('close', () => {
        clearInterval(pingInterval);
        ollamaReq.destroy();
    });

    ollamaReq.write(body);
    ollamaReq.end();
});

// DELETE /api/models/ollama — delete a model from Ollama
router.delete('/ollama', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Model name required' });

    const base = getOllamaBase();
    const url = new URL('/api/delete', base);
    const transport = url.protocol === 'https:' ? https : http;
    const body = JSON.stringify({ name });

    const ollamaReq = transport.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (ollamaRes) => {
        let respBody = '';
        ollamaRes.on('data', d => respBody += d);
        ollamaRes.on('end', () => {
            if (ollamaRes.statusCode === 200) {
                res.json({ success: true });
            } else {
                res.status(ollamaRes.statusCode || 500).json({ error: respBody || 'Delete failed' });
            }
        });
    });

    ollamaReq.on('error', (err) => {
        res.status(502).json({ error: 'Cannot connect to Ollama: ' + err.message });
    });

    ollamaReq.write(body);
    ollamaReq.end();
});

module.exports = router;
