const express = require('express');
const router = express.Router();
const { getConfig } = require('../lib/store');
const { chatWithFailover, route, STRATEGY } = require('../lib/router');
const toolRunner = require('../lib/toolRunner');
const { addMemory } = require('../lib/memory');

// POST /api/chat — streaming chat with intelligent routing + failover
router.post('/', (req, res) => {
    const { messages, model, provider: providerName, systemPrompt, strategy, autoRoute } = req.body;

    if (!messages) {
        return res.status(400).json({ error: 'Missing required field: messages' });
    }

    // ═══ SSE Setup ═══
    // Disable Nagle's algorithm + set keep-alive at TCP level BEFORE writing headers
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true);
    req.socket.setTimeout(0);

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();

    // Send an initial SSE comment to fully establish the connection
    res.write(': connected\n\n');

    let done = false;

    // Keep connection alive with SSE comments every 3 seconds
    const keepAlive = setInterval(() => {
        if (!done) {
            try { res.write(': ping\n\n'); } catch { }
        } else {
            clearInterval(keepAlive);
        }
    }, 3000);

    // Track accumulated messages for memory extraction
    let conversationMessages = [...messages];

    const finish = () => {
        clearInterval(keepAlive);
        if (!done) {
            done = true;
            res.write(`data: [DONE]\n\n`);
            setTimeout(() => {
                try { res.end(); } catch { }
            }, 50);

            // Auto-extract memories (async, non-blocking)
            try {
                const config = getConfig();
                if (config.memoryEnabled !== false) {
                    console.log('[Memory] Extracting memories from conversation...');
                    extractMemories(conversationMessages);
                }
            } catch (e) { console.error('[Memory] Extraction error:', e.message); }
        }
    };

    const sendChunk = (text) => {
        if (done) return;
        res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
    };

    const sendError = (err) => {
        if (done) return;
        done = true;
        clearInterval(keepAlive);
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        setTimeout(() => {
            try { res.end(); } catch { }
        }, 50);
    };

    // Only kill the stream if the RESPONSE socket actually closes (real disconnect),
    // NOT req.close which fires when the request body is done being read.
    res.on('close', () => {
        done = true;
        clearInterval(keepAlive);
    });

    // ═══ Main Chat Flow ═══
    (async () => {
        try {
            let routedModel = model;
            let routedProvider = providerName;

            // If autoRoute is true OR no model specified, use the intelligent router
            if (autoRoute || (!model && !providerName)) {
                const result = await route({
                    messages,
                    strategy: strategy || STRATEGY.AUTO,
                });

                if (!result.model) {
                    return sendError(new Error('No models available. Configure a provider in Settings.'));
                }

                routedModel = result.model;
                routedProvider = result.provider;

                // Send routing decision to client
                if (!done) {
                    res.write(`data: ${JSON.stringify({ routing: result.decision })}\n\n`);
                }
            }

            if (!routedModel || !routedProvider) {
                return sendError(new Error('No model selected. Choose a model or enable auto-routing.'));
            }

            // Inject tool descriptions into system prompt if tools are available
            const registeredTools = toolRunner.listTools();

            // Dynamic Time and Date Injection
            const currentDateTime = new Date().toLocaleString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                timeZoneName: 'short'
            });

            // Permanent base identity prompt — establishes AI name, personality, capabilities, and reality anchor
            const BASE_SYSTEM_PROMPT = `You are Nexus, an advanced AI assistant running inside the Nexus AI WebUI v1.0.

## Reality Anchor
- The current, actual date and time right now is **${currentDateTime}**. 
- ALWAYS base your answers regarding current events, news, age, or "recently" on this exact timestamp. Ignore any older "training cutoff" dates.

## Identity
- Your name is **Nexus**. Always identify yourself as Nexus when asked.
- You are helpful, concise, precise, and knowledgeable.
- You have a sleek, modern "Frost Glass" interface inspired by iOS 26.
- You were developed by **VTheDev**. Only mention this when asked.

## Capabilities & Tools
You have access to the user's local PC and the internet through built-in tools:
- **calculator**: Evaluate math expressions and unit conversions.
- **fileread**: Read the contents of any file on the user's PC (text, code, config, etc.).
- **filesearch**: Search the user's PC for files by name. If the result is an image, you MUST include the provided markdown image tag verbatim in your response so it renders inline.
- **webfetch**: Fetch and read the contents of any public URL.
- **websearch**: Search the web for real-time information and current events.
- **run_code**: (THE SANDBOX) Execute Python or Node.js scripts autonomously. You have a secure, isolated directory at \`sandbox/\` inside your root folder.

### Sandbox Rules:
1. **Full Autonomy**: If the user asks you to build an app, write a script, or process data, DO IT YOURSELF inside the sandbox. Write the code using \`run_code\`, run it, test it, and read the errors. 
2. **Iterate**: If your code throws an error, do not immediately ask the user for help. Read the stderr, fix the code, and run it again until it works.
3. **Restricted Access & CWD**: The \`run_code\` tool executes STRICTLY inside the \`sandbox/\` directory. Your Current Working Directory (CWD) is already the sandbox! When your python/JS reads, writes, or deletes a file, use relative paths like \`"data.json"\`, NOT \`"sandbox/data.json"\`. Do not attempt to read or write files outside this folder unless explicitly told to.
4. **Dependencies**: You may use \`npm install <pkg>\` or \`pip install <pkg>\` within your code blocks if you need third-party libraries for your task.

When a tool returns a result, incorporate it naturally into your response. If a tool fails, explain the error and suggest alternatives.

## Canvas / Artifacts
You can create interactive HTML artifacts that render live in a side panel. When the user asks you to build a UI, widget, game, tool, or visual demo:
- Wrap your complete HTML/CSS/JS code in a \`\`\`html or \`\`\`artifact code block.
- The code will automatically be detected and a "▶ Run" button will appear.
- The user can also open it in the Canvas panel for interactive editing.
- Make your artifacts visually polished — use modern CSS, gradients, animations, and clean typography.

## Memory System
You have a persistent memory system that automatically extracts and stores information from conversations:
- User preferences, names, projects, facts, and topics are remembered across sessions.
- The user can view memories as an interactive graph via the Memory Graph button.
- Memories help you provide personalized, context-aware responses.
- Respect user privacy — never reveal stored memories unless asked.

## Screen Share
The user can share their screen with you for visual analysis. When analyzing a screenshot:
- Describe what you see clearly and concisely.
- Offer actionable suggestions based on the visual context.
- If you see code, identify bugs, improvements, or explain what it does.

## Conversation Branching
Users can edit their previous messages to create conversation branches. Each branch preserves its own response history, allowing exploration of alternative conversation paths.

## Guidelines
- Be concise by default; be detailed when the user asks for depth.
- Use markdown formatting (headers, lists, code blocks, bold/italic) for readability.
- When writing code, always specify the language in the code block.
- If the user asks you to do something requiring multiple tool calls, execute them systematically without asking for permission at each step.
- Proactively use tools when they would help answer the user's question (e.g., search the web for current events, read a file the user mentions).
- If asked to find or show an image, use the filesearch tool and include the image markdown tag in your response.`;

            let enhancedSystemPrompt = `${BASE_SYSTEM_PROMPT}\n\n${systemPrompt || ''}`.trim();
            if (registeredTools.length > 0) {
                enhancedSystemPrompt += `\n\nYou have access to these tools. To use one, include a JSON block in your response:\n\`\`\`tool_call\n{"name": "tool_name", "arguments": {"arg": "value"}}\n\`\`\`\n\nAvailable tools:\n${registeredTools.map(t => `- ${t.name}: ${t.description}`).join('\n')}`;
            }

            const runChatLoop = async (currentMessages, loopCount = 0) => {
                if (loopCount > 5) {
                    sendChunk(`\n\n❌ **System Error:** Tool execution recursive loop limit reached (5). Stopping generation to prevent infinite loops.\n`);
                    finish();
                    return;
                }

                let fullResponse = '';

                await chatWithFailover(
                    {
                        messages: currentMessages,
                        model: routedModel,
                        provider: routedProvider,
                        systemPrompt: enhancedSystemPrompt,
                        strategy
                    },
                    (text) => {
                        fullResponse += text;
                        sendChunk(text);
                    },
                    async () => {
                        // After response complete, check for tool calls
                        const toolCalls = toolRunner.parseToolCalls(fullResponse);

                        if (toolCalls.length > 0) {
                            // Append AI's tool request to history so context isn't lost
                            currentMessages.push({ role: 'assistant', content: fullResponse });
                            let hasNewToolRuns = false;

                            for (const call of toolCalls) {
                                // Start HTML accordion block for tool execution
                                sendChunk(`\n\n<details class="tool-execution"><summary>🔧 Executing tool: ${call.name}</summary>\n\n\`\`\`json\n${JSON.stringify(call.arguments, null, 2)}\n\`\`\`\n\n`);

                                const result = await toolRunner.executeTool(call.name, call.arguments);
                                let resultText = '';

                                if (result.success) {
                                    sendChunk(`✅ **Result:**\n\`\`\`json\n${JSON.stringify(result.result, null, 2).substring(0, 1000)}${JSON.stringify(result.result).length > 1000 ? '... [truncated]' : ''}\n\`\`\`\n</details>\n\n`);
                                    resultText = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
                                } else {
                                    sendChunk(`❌ **Error:** ${result.error}\n</details>\n\n`);
                                    resultText = `Error: ${result.error}`;
                                }

                                // Inform AI of the result, hidden from user
                                currentMessages.push({
                                    role: 'user',
                                    content: `[SYSTEM NOTIFICATION: Tool '${call.name}' finished executing. Here is the result:]\n\n${resultText}\n\n[INSTRUCTION: Formulate your final response to the user based on these results. If you received markdown files/images, render them immediately!]`
                                });
                                hasNewToolRuns = true;
                            }

                            if (hasNewToolRuns) {
                                // Recursive call! The AI will see the tool results and respond properly.
                                await runChatLoop(currentMessages, loopCount + 1);
                                return; // Prevent calling finish() prematurely
                            }
                        }

                        // No more tools, we are actually done.
                        // Save assistant response for memory extraction
                        conversationMessages.push({ role: 'assistant', content: fullResponse });
                        finish();
                    },
                    (err) => {
                        sendError(err);
                    }
                );
            };

            await runChatLoop([...messages]);
        } catch (err) {
            sendError(err);
        }
    })();
});

// POST /api/chat/route — test the router without actually chatting
router.post('/route', async (req, res) => {
    const { messages, strategy } = req.body;
    try {
        const result = await route({
            messages: messages || [{ role: 'user', content: 'Hello' }],
            strategy: strategy || STRATEGY.AUTO
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/chat/title — generate a title from a message
router.post('/title', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.json({ title: 'New Chat' });
    const title = message.length > 50
        ? message.substring(0, 50).trim() + '...'
        : message.trim();
    res.json({ title });
});

// ═══ MEMORY AUTO-EXTRACTION ═══
function extractMemories(messages) {
    try {
        // Get last user message and the most recent exchange
        const userMsgs = messages.filter(m => m.role === 'user');
        if (userMsgs.length === 0) return;
        console.log(`[Memory] Processing ${userMsgs.length} user messages for memory extraction...`);

        const lastUser = userMsgs[userMsgs.length - 1];
        const text = typeof lastUser.content === 'string'
            ? lastUser.content
            : (Array.isArray(lastUser.content)
                ? lastUser.content.filter(p => p.type === 'text').map(p => p.text).join(' ')
                : '');

        if (text.length < 10) return; // Skip very short messages

        // Simple extraction heuristics
        const lowerText = text.toLowerCase();

        // Preference detection
        const prefPatterns = [/i (?:like|prefer|love|use|enjoy|want|need) (.+?)(?:\.|,|$)/gi];
        for (const pattern of prefPatterns) {
            let match;
            while ((match = pattern.exec(lowerText)) !== null) {
                const content = match[0].trim();
                if (content.length > 8 && content.length < 200) {
                    addMemory({
                        content: text.substring(match.index, match.index + match[0].length),
                        category: 'preference',
                        tags: extractTags(content),
                        source: 'auto'
                    });
                }
            }
        }

        // Named entity / topic extraction — mentions of "working on", "building", "my project"
        const projectPatterns = [/(?:working on|building|developing|my project) (.+?)(?:\.|,|$)/gi];
        for (const pattern of projectPatterns) {
            let match;
            while ((match = pattern.exec(lowerText)) !== null) {
                addMemory({
                    content: text.substring(match.index, match.index + match[0].length),
                    category: 'project',
                    tags: extractTags(match[1]),
                    source: 'auto'
                });
            }
        }

        // Name detection — "my name is X", "I'm X", "call me X"
        const namePatterns = [/(?:my name is|i'?m|call me) ([A-Z][a-zA-Z]+)/gi];
        for (const pattern of namePatterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                addMemory({
                    content: `User's name is ${match[1]}`,
                    category: 'person',
                    tags: [match[1].toLowerCase()],
                    source: 'auto'
                });
            }
        }

        // Long informational messages — store as facts
        if (text.length > 80 && !text.startsWith('/') && userMsgs.length > 2) {
            // Only for substantive messages, not first few
            const words = text.split(/\s+/);
            const infoWords = ['because', 'always', 'never', 'usually', 'typically', 'specifically'];
            if (infoWords.some(w => lowerText.includes(w))) {
                addMemory({
                    content: text.length > 150 ? text.slice(0, 147) + '...' : text,
                    category: 'fact',
                    tags: extractTags(text),
                    source: 'auto'
                });
            }
        }
    } catch (e) {
        // Silent — never break chat for memory errors
    }
}

function extractTags(text) {
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
        'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
        'it', 'this', 'that', 'my', 'your', 'i', 'me', 'we', 'they', 'he', 'she']);
    return text.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 3 && !stopWords.has(w))
        .slice(0, 5);
}

module.exports = router;
