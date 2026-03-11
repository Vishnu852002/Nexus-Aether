/**
 * Nexus Tool Runner
 * 
 * Minimal plugin/tool architecture.
 * Tools are JSON-schema defined, dynamically loaded from /tools.
 * Models can request tool calls, which are executed in a sandbox.
 */

const path = require('path');
const metrics = require('./metrics');

// Tool registry
const tools = {};

/**
 * Register a tool.
 * @param {string} name 
 * @param {object} definition - { description, parameters (JSON schema), execute(args) }
 */
function register(name, definition) {
    tools[name] = {
        name,
        description: definition.description,
        parameters: definition.parameters,
        execute: definition.execute
    };
}

/**
 * Get all tool schemas (for sending to model).
 */
function getToolSchemas() {
    return Object.values(tools).map(t => ({
        type: 'function',
        function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters
        }
    }));
}

/**
 * Execute a tool call from a model response.
 */
async function executeTool(name, args) {
    const tool = tools[name];
    if (!tool) {
        const err = new Error(`Unknown tool: ${name}`);
        metrics.recordToolCall(name, false, 0, err);
        throw err;
    }

    const start = Date.now();
    try {
        // Parse args if string
        const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;

        // Execute with timeout (10s max)
        const result = await Promise.race([
            tool.execute(parsedArgs),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Tool execution timed out (10s)')), 10000)
            )
        ]);

        const duration = Date.now() - start;
        metrics.recordToolCall(name, true, duration);

        return {
            success: true,
            result,
            toolName: name,
            durationMs: duration
        };
    } catch (err) {
        const duration = Date.now() - start;
        metrics.recordToolCall(name, false, duration, err);

        return {
            success: false,
            error: err.message,
            toolName: name,
            durationMs: duration
        };
    }
}

/**
 * Parse tool calls from an assistant message (OpenAI-style).
 * Looks for ```tool_call blocks or JSON function calls.
 */
function parseToolCalls(content) {
    const calls = [];

    // Look for JSON tool call patterns in the text
    const patterns = [
        /```tool_call\s*\n([\s\S]*?)```/g,
        /\{"tool":\s*"(\w+)",\s*"args":\s*(\{[^}]+\})\}/g,
    ];

    // Pattern 1: ```tool_call blocks
    let match;
    const blockRegex = /```tool_call\s*\n([\s\S]*?)```/g;
    while ((match = blockRegex.exec(content)) !== null) {
        try {
            const parsed = JSON.parse(match[1].trim());
            if (parsed.name && parsed.arguments) {
                calls.push({ name: parsed.name, arguments: parsed.arguments });
            }
        } catch { }
    }

    // Pattern 2: inline JSON
    const inlineRegex = /\{"tool":\s*"(\w+)",\s*"args":\s*(\{[^}]+\})\}/g;
    while ((match = inlineRegex.exec(content)) !== null) {
        try {
            calls.push({ name: match[1], arguments: JSON.parse(match[2]) });
        } catch { }
    }

    return calls;
}

/**
 * Get list of registered tools and their descriptions.
 */
function listTools() {
    return Object.values(tools).map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters
    }));
}

module.exports = { register, getToolSchemas, executeTool, parseToolCalls, listTools };
