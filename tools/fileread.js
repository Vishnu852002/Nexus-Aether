/**
 * File Reader Tool
 * Lets the AI read text files from the user's PC for context.
 * Read-only — cannot modify, delete, or write files.
 */

const fs = require('fs');
const path = require('path');

// Blocked paths (system/sensitive directories)
const BLOCKED_PATHS = [
    'C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)',
    'C:\\ProgramData', 'C:\\Recovery', 'C:\\$Recycle.Bin',
    '/etc', '/var', '/usr', '/bin', '/sbin', '/boot', '/proc', '/sys'
];

// Allowed text extensions
const TEXT_EXTENSIONS = new Set([
    '.txt', '.md', '.json', '.js', '.ts', '.jsx', '.tsx', '.py', '.java',
    '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs', '.rb', '.php',
    '.html', '.htm', '.css', '.scss', '.less', '.xml', '.yaml', '.yml',
    '.toml', '.ini', '.cfg', '.conf', '.env', '.sh', '.bat', '.ps1',
    '.sql', '.csv', '.log', '.gitignore', '.dockerignore', '.editorconfig',
    '.svelte', '.vue', '.astro', '.mdx', '.tex', '.r', '.matlab',
    '.makefile', '.cmake', '.gradle', '.properties', '.lock',
    ''  // files without extension (README, LICENSE, etc.)
]);

const MAX_FILE_SIZE = 100 * 1024; // 100KB max

module.exports = {
    description: 'Read a text file from the user\'s computer to use as context. ' +
        'Provide the absolute file path. Read-only access, text files only, max 100KB.',
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Absolute path to the file to read, e.g. "F:\\myownweb\\package.json" or "C:\\Users\\User\\notes.txt"'
            }
        },
        required: ['path']
    },

    async execute({ path: filePath }) {
        // Normalize the path
        const resolved = path.resolve(filePath);

        // Security: block system directories
        for (const blocked of BLOCKED_PATHS) {
            if (resolved.toLowerCase().startsWith(blocked.toLowerCase())) {
                throw new Error(`Access denied: cannot read from system directory "${blocked}"`);
            }
        }

        // Check file exists
        if (!fs.existsSync(resolved)) {
            throw new Error(`File not found: "${resolved}"`);
        }

        // Check it's a file (not a directory)
        const stats = fs.statSync(resolved);
        if (stats.isDirectory()) {
            // Return directory listing instead
            const entries = fs.readdirSync(resolved, { withFileTypes: true });
            const listing = entries.slice(0, 50).map(e =>
                `${e.isDirectory() ? '📁' : '📄'} ${e.name}`
            ).join('\n');
            return {
                type: 'directory',
                path: resolved,
                count: entries.length,
                listing
            };
        }

        // Check extension
        const ext = path.extname(resolved).toLowerCase();
        if (!TEXT_EXTENSIONS.has(ext)) {
            throw new Error(`Cannot read binary file (${ext}). Only text files are supported.`);
        }

        // Check size
        if (stats.size > MAX_FILE_SIZE) {
            throw new Error(`File too large (${(stats.size / 1024).toFixed(1)}KB). Max is 100KB. Try a smaller file.`);
        }

        // Read the file
        const content = fs.readFileSync(resolved, 'utf-8');

        return {
            path: resolved,
            filename: path.basename(resolved),
            size: `${(stats.size / 1024).toFixed(1)}KB`,
            lines: content.split('\n').length,
            content
        };
    }
};
