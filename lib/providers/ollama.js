const http = require('http');

const DEFAULT_BASE = 'http://localhost:11434';

function getBase(baseUrl) {
    return baseUrl || DEFAULT_BASE;
}

async function streamChat(messages, model, baseUrl, onChunk, onDone, onError) {
    const base = getBase(baseUrl);
    const url = new URL('/api/chat', base);

    const body = JSON.stringify({ model, messages, stream: true });
    console.log(`[Ollama] streamChat → ${url.href} model=${model}`);

    const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    };

    const transport = url.protocol === 'https:' ? require('https') : http;

    const req = transport.request(options, (res) => {
        console.log(`[Ollama] Response status: ${res.statusCode}`);
        if (res.statusCode !== 200) {
            let errBody = '';
            res.on('data', d => errBody += d);
            res.on('end', () => {
                console.error(`[Ollama] Error response: ${errBody}`);
                onError(new Error(`Ollama error ${res.statusCode}: ${errBody}`));
            });
            return;
        }

        let buffer = '';
        let finished = false;
        let chunkCount = 0;

        const processLine = (line) => {
            if (!line.trim()) return;
            try {
                const data = JSON.parse(line);
                if (data.message?.content) {
                    chunkCount++;
                    onChunk(data.message.content);
                }
                if (data.done && !finished) {
                    finished = true;
                    console.log(`[Ollama] Stream done. ${chunkCount} content chunks sent.`);
                    onDone();
                }
            } catch (e) {
                console.warn(`[Ollama] JSON parse error:`, e.message, `line: ${line.substring(0, 100)}`);
            }
        };

        res.on('data', (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop(); // keep incomplete last line

            for (const line of lines) {
                processLine(line);
            }
        });

        res.on('end', () => {
            console.log(`[Ollama] Response stream ended. finished=${finished} chunkCount=${chunkCount}`);
            // Flush any remaining data in buffer
            if (buffer.trim()) {
                processLine(buffer);
            }
            if (!finished) {
                finished = true;
                onDone();
            }
        });

        res.on('error', (err) => {
            console.error(`[Ollama] Response stream error:`, err.message);
            if (!finished) {
                finished = true;
                onError(err);
            }
        });
    });

    req.on('error', (err) => {
        console.error(`[Ollama] Request error:`, err.message);
        onError(err);
    });
    req.write(body);
    req.end();
}

async function listModels(baseUrl) {
    const base = getBase(baseUrl);
    return new Promise((resolve) => {
        const url = new URL('/api/tags', base);
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
                    if (!data.models) return resolve([]);
                    const models = data.models.map(m => ({
                        id: m.name,
                        name: m.name,
                        provider: 'ollama',
                        type: 'local',
                        size: m.size ? Math.round(m.size / (1024 * 1024 * 1024) * 10) / 10 + ' GB' : null,
                        parameterSize: m.details?.parameter_size || null,
                        quantization: m.details?.quantization_level || null
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
        const url = new URL('/api/tags', base);
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
