const https = require('https');

async function streamChat(messages, model, apiKey, onChunk, onDone, onError) {
    // Convert messages to Gemini format
    const systemMsg = messages.find(m => m.role === 'system');
    const contents = messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
    }));

    const body = JSON.stringify({
        contents,
        systemInstruction: systemMsg ? { parts: [{ text: systemMsg.content }] } : undefined,
        generationConfig: {
            maxOutputTokens: 8192
        }
    });

    // Use streaming endpoint
    const path = `/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

    const options = {
        hostname: 'generativelanguage.googleapis.com',
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    };

    const req = https.request(options, (res) => {
        if (res.statusCode !== 200) {
            let errBody = '';
            res.on('data', d => errBody += d);
            res.on('end', () => onError(new Error(`Gemini API error ${res.statusCode}: ${errBody}`)));
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
                try {
                    const data = JSON.parse(trimmed.slice(6));
                    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (text) onChunk(text);
                    if (data.candidates?.[0]?.finishReason) {
                        onDone();
                    }
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
            hostname: 'generativelanguage.googleapis.com',
            path: `/v1beta/models?key=${apiKey}`,
            method: 'GET'
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    if (!data.models) return resolve(getKnownModels());
                    const models = data.models
                        .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
                        .map(m => ({
                            id: m.name.replace('models/', ''),
                            name: m.displayName || m.name.replace('models/', ''),
                            provider: 'gemini',
                            type: 'cloud'
                        }));
                    resolve(models);
                } catch {
                    resolve(getKnownModels());
                }
            });
        });
        req.on('error', () => resolve(getKnownModels()));
        req.end();
    });
}

function getKnownModels() {
    return [
        { id: 'gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro', provider: 'gemini', type: 'cloud' },
        { id: 'gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash', provider: 'gemini', type: 'cloud' },
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'gemini', type: 'cloud' },
        { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'gemini', type: 'cloud' },
    ];
}

module.exports = { streamChat, listModels };
