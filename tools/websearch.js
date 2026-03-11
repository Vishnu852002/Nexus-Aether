/**
 * Web Search Tool (DuckDuckGo HTML Scraper)
 * Scrapes DuckDuckGo HTML Lite version for search results.
 */

const https = require('https');

module.exports = {
    description: 'Perform a web search to find current information, news, or general knowledge from the internet.',
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'The search query to search for.'
            }
        },
        required: ['query']
    },

    async execute({ query }) {
        return new Promise((resolve, reject) => {
            const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

            const options = {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml'
                }
            };

            https.get(searchUrl, options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        // Sometimes ddg redirects, but html interface usually doesn't for direct queries
                        return reject(new Error('Search failed due to redirect cap.'));
                    }

                    // Poor man's HTML parsing to avoid installing dependencies like cheerio
                    const results = [];
                    // DuckDuckGo lite search results are inside <a class="result__url" href="..."> and <a class="result__snippet"...
                    const snippetRegex = /<a class="result__snippet[^>]*>([\s\S]*?)<\/a>/gi;
                    const urlRegex = /<a class="result__url" href="([^"]+)">/gi;
                    const titleRegex = /<h2 class="result__title">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/gi;

                    let matchSnippet, matchUrl, matchTitle;

                    // Simple extraction of top 3-4 results
                    for (let i = 0; i < 4; i++) {
                        matchSnippet = snippetRegex.exec(data);
                        matchUrl = urlRegex.exec(data);
                        matchTitle = titleRegex.exec(data);

                        if (matchSnippet && matchUrl && matchTitle) {
                            // Strip HTML tags
                            const cleanTitle = matchTitle[1].replace(/<[^>]+>/g, '').trim();
                            const cleanSnippet = matchSnippet[1].replace(/<[^>]+>/g, '').trim();

                            // duckduckgo URLs are sometimes relative bounce links, try to extract actual URL
                            let realUrl = matchUrl[1];
                            if (realUrl.startsWith('//duckduckgo.com/l/?uddg=')) {
                                try {
                                    realUrl = decodeURIComponent(realUrl.split('uddg=')[1].split('&')[0]);
                                } catch (e) { }
                            }

                            results.push({
                                title: cleanTitle,
                                url: realUrl,
                                snippet: cleanSnippet
                            });
                        }
                    }

                    if (results.length === 0) {
                        resolve({ note: `No results found for "${query}"` });
                    } else {
                        resolve({ results });
                    }
                });
            }).on('error', (err) => {
                reject(new Error(`Failed to perform web search: ${err.message}`));
            });
        });
    }
};
