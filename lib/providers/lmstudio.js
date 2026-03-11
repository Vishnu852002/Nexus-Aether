const http = require('http');

const DEFAULT_BASE = 'http://localhost:1234';

function getBase(baseUrl) {
    return baseUrl || DEFAULT_BASE;
}

async function streamChat(messages, model, baseUrl, onChunk, onDone, onError) {
    const base = getBase(baseUrl);
    const url = new URL('/v1/chat/completions', base);

    const body = JSON.stringify({ model, messages, stream: true });

    const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    };

    const transport = url.protocol === 'https:' ? require('https') : http;

    const req = transport.request(options, (res) => {
        if (res.statusCode !== 200) {
            let errBody = '';
            res.on('data', d => errBody += d);
            res.on('end', () => onError(new Error(`LM Studio error ${res.statusCode}: ${errBody}`)));
            return;
        }

        let buffer = '';
        let finished = false;

        const finish = () => {
            if (!finished) { finished = true; onDone(); }
        };

        const processLine = (line) => {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) return;
            const data = trimmed.slice(6);
            if (data === '[DONE]') { finish(); return; }
            try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) onChunk(content);
            } catch { }
        };

        res.on('data', (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                processLine(line);
            }
        });

        res.on('end', () => {
            if (buffer.trim()) processLine(buffer);
            finish();
        });
    });

    req.on('error', onError);
    req.write(body);
    req.end();
}

async function listModels(baseUrl) {
    const base = getBase(baseUrl);
    return new Promise((resolve) => {
        const url = new URL('/v1/models', base);
        const transport = url.protocol === 'https:' ? require('https') : http;

        const req = transport.request({
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: 'GET',
            timeout: 3000
        }, (res) => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    if (!data.data) return resolve([]);
                    const models = data.data.map(m => ({
                        id: m.id,
                        name: m.id,
                        provider: 'lmstudio',
                        type: 'local'
                    }));
                    resolve(models);
                } catch {
                    resolve([]);
                }
            });
        });

        req.on('error', () => resolve([]));
        req.on('timeout', () => { req.destroy(); resolve([]); });
        req.end();
    });
}

async function isAvailable(baseUrl) {
    const base = getBase(baseUrl);
    return new Promise((resolve) => {
        const url = new URL('/v1/models', base);
        const transport = url.protocol === 'https:' ? require('https') : http;

        const req = transport.request({
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: 'GET',
            timeout: 2000
        }, (res) => {
            res.resume();
            resolve(res.statusCode === 200);
        });

        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.end();
    });
}

module.exports = { streamChat, listModels, isAvailable };
