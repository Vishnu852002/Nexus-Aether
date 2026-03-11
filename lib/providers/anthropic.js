const https = require('https');

async function streamChat(messages, model, apiKey, onChunk, onDone, onError) {
    // Convert from OpenAI format to Anthropic format
    const systemMsg = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
    }));

    const body = JSON.stringify({
        model,
        max_tokens: 8192,
        system: systemMsg?.content || '',
        messages: chatMessages,
        stream: true
    });

    const options = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        }
    };

    const req = https.request(options, (res) => {
        if (res.statusCode !== 200) {
            let errBody = '';
            res.on('data', d => errBody += d);
            res.on('end', () => onError(new Error(`Anthropic API error ${res.statusCode}: ${errBody}`)));
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
                    if (data.type === 'content_block_delta' && data.delta?.text) {
                        onChunk(data.delta.text);
                    }
                    if (data.type === 'message_stop') {
                        onDone();
                    }
                } catch { }
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
            hostname: 'api.anthropic.com',
            path: '/v1/models',
            method: 'GET',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    if (!data.data) {
                        // Fallback: return known models
                        return resolve(getKnownModels());
                    }
                    const models = data.data.map(m => ({
                        id: m.id,
                        name: m.id,
                        provider: 'anthropic',
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
        { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic', type: 'cloud' },
        { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', provider: 'anthropic', type: 'cloud' },
        { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic', type: 'cloud' },
        { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic', type: 'cloud' },
    ];
}

module.exports = { streamChat, listModels };
