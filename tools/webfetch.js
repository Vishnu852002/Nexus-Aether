/**
 * Web Fetch Tool
 * Fetches content from a URL and returns extracted text.
 */

const https = require('https');
const http = require('http');

module.exports = {
    description: 'Fetch a web page and return its text content. Useful for getting current information.',
    parameters: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: 'The URL to fetch, e.g. "https://example.com"'
            },
            maxLength: {
                type: 'number',
                description: 'Maximum characters to return (default: 2000)'
            }
        },
        required: ['url']
    },

    async execute({ url, maxLength = 2000 }) {
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            throw new Error('URL must start with http:// or https://');
        }

        // Block private IPs for security
        const parsed = new URL(url);
        const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
        if (blockedHosts.includes(parsed.hostname) || parsed.hostname.startsWith('192.168.') || parsed.hostname.startsWith('10.')) {
            throw new Error('Cannot fetch private/local URLs for security reasons');
        }

        return new Promise((resolve, reject) => {
            const transport = url.startsWith('https') ? https : http;

            const req = transport.get(url, {
                timeout: 8000,
                headers: {
                    'User-Agent': 'Nexus-AI-Assistant/1.0',
                    'Accept': 'text/html,text/plain,application/json'
                }
            }, (res) => {
                // Handle redirects
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    // Follow one redirect
                    const redirectUrl = res.headers.location.startsWith('http')
                        ? res.headers.location
                        : new URL(res.headers.location, url).href;

                    transport.get(redirectUrl, { timeout: 8000 }, (res2) => {
                        collectResponse(res2, maxLength, resolve, reject);
                    }).on('error', reject);
                    return;
                }

                collectResponse(res, maxLength, resolve, reject);
            });

            req.on('error', (err) => reject(new Error(`Fetch failed: ${err.message}`)));
            req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out (8s)')); });
        });
    }
};

function collectResponse(res, maxLength, resolve, reject) {
    if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
    }

    let body = '';
    res.on('data', (chunk) => {
        body += chunk;
        if (body.length > maxLength * 3) {
            res.destroy(); // Don't download huge pages
        }
    });

    res.on('end', () => {
        // Strip HTML tags for cleaner output
        let text = body
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .trim();

        // Truncate
        if (text.length > maxLength) {
            text = text.substring(0, maxLength) + '... [truncated]';
        }

        resolve({
            url: res.responseUrl || 'fetched',
            contentLength: body.length,
            extractedText: text,
            truncated: text.length >= maxLength
        });
    });
}
