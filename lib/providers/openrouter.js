const https = require('https');

const API_BASE = 'https://openrouter.ai';

async function streamChat(messages, model, apiKey, onChunk, onDone, onError) {
    const body = JSON.stringify({
        model,
        messages,
        stream: true
    });

    const options = {
        hostname: 'openrouter.ai',
        path: '/api/v1/chat/completions',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'GlassChat'
        }
    };

    const req = https.request(options, (res) => {
        if (res.statusCode !== 200) {
            let errBody = '';
            res.on('data', d => errBody += d);
            res.on('end', () => onError(new Error(`OpenRouter API error ${res.statusCode}: ${errBody}`)));
            return;
        }

        let buffer = '';
        res.on('data', (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data: ')) continue;
                const data = trimmed.slice(6);
                if (data === '[DONE]') { onDone(); return; }
                try {
                    const parsed = JSON.parse(data);
                    const content = parsed.choices?.[0]?.delta?.content;
                    if (content) onChunk(content);
                } catch { }
            }
        });

        res.on('end', () => onDone());
    });

    req.on('error', onError);
    req.write(body);
    req.end();
}

async function listModels(apiKey) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'openrouter.ai',
            path: '/api/v1/models',
            method: 'GET',
            headers: { 'Authorization': `Bearer ${apiKey}` }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    if (!data.data) return resolve([]);
                    const models = data.data.map(m => ({
                        id: m.id,
                        name: m.name || m.id,
                        provider: 'openrouter',
                        type: 'cloud',
                        contextLength: m.context_length,
                        pricing: m.pricing
                    }));
                    resolve(models);
                } catch (e) {
                    resolve([]);
                }
            });
        });
        req.on('error', () => resolve([]));
        req.end();
    });
}

module.exports = { streamChat, listModels };
