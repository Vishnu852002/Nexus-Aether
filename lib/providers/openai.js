const https = require('https');

const API_BASE = 'https://api.openai.com';

async function streamChat(messages, model, apiKey, onChunk, onDone, onError) {
    const body = JSON.stringify({
        model,
        messages,
        stream: true
    });

    const url = new URL('/v1/chat/completions', API_BASE);

    const options = {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        }
    };

    const req = https.request(options, (res) => {
        if (res.statusCode !== 200) {
            let errBody = '';
            res.on('data', d => errBody += d);
            res.on('end', () => onError(new Error(`OpenAI API error ${res.statusCode}: ${errBody}`)));
            return;
        }

        let buffer = '';
        res.on('data', (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data: ')) continue;
                const data = trimmed.slice(6);
                if (data === '[DONE]') {
                    onDone();
                    return;
                }
                try {
                    const parsed = JSON.parse(data);
                    const content = parsed.choices?.[0]?.delta?.content;
                    if (content) onChunk(content);
                } catch { }
            }
        });

        res.on('end', () => {
            if (buffer.trim()) {
                const trimmed = buffer.trim();
                if (trimmed.startsWith('data: ') && trimmed.slice(6) === '[DONE]') {
                    onDone();
                }
            }
        });
    });

    req.on('error', onError);
    req.write(body);
    req.end();
}

async function listModels(apiKey) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.openai.com',
            path: '/v1/models',
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
                    const models = data.data
                        .filter(m => !/whisper|dall-e|tts|embedding|babbage|davinci|curie|ada/i.test(m.id))
                        .map(m => ({
                            id: m.id,
                            name: m.id,
                            provider: 'openai',
                            type: 'cloud'
                        }))
                        .sort((a, b) => a.id.localeCompare(b.id));
                    resolve(models);
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

module.exports = { streamChat, listModels };
