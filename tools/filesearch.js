/**
 * PC File Search Tool
 * Lets the AI search the user's computer for a file by name.
 */

const { execSync } = require('child_process');
const os = require('os');
const path = require('path');

module.exports = {
    description: 'Search the PC for a file by its exact name. If it is an image, the tool provides markdown so the AI can display it in the chat.',
    parameters: {
        type: 'object',
        properties: {
            filename: {
                type: 'string',
                description: 'Exact name of the file to search for, e.g. "content.png" or "document.pdf"'
            }
        },
        required: ['filename']
    },

    async execute(args) {
        // Handle LLM hallucinations of argument names
        let filename = args.filename || args.name || args.file || args.query;

        if (!filename || typeof filename !== 'string' || /[&|;]/.test(filename)) {
            throw new Error('Invalid filename');
        }

        filename = filename.trim();
        const home = os.homedir();

        let targetDir = home;
        let searchPattern = filename;
        let isDirectCheck = false;

        // If the AI provided a full path instead of just a filename
        if (filename.includes('\\') || filename.includes('/')) {
            const fs = require('fs');
            // Try direct check first
            if (fs.existsSync(filename)) {
                isDirectCheck = true;
                searchPattern = filename;
            } else {
                searchPattern = path.basename(filename);
                targetDir = path.dirname(filename);
                if (!fs.existsSync(targetDir)) {
                    targetDir = home; // Fallback to home dir
                }
            }
        }

        try {
            let lines = [];

            if (isDirectCheck) {
                lines = [searchPattern];
            } else {
                // Using Windows 'where' command recursively in the target directory
                const cmd = `where /r "${targetDir}" "${searchPattern}"`;
                const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
                lines = output.split('\n').map(l => l.trim()).filter(Boolean);
            }

            if (lines.length === 0) {
                return { error: `File not found on PC.` };
            }

            const firstMatch = lines[0];
            const ext = path.extname(firstMatch).toLowerCase();
            const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext);

            let result = `Found file at: ${firstMatch}\n`;

            if (isImage) {
                // Return markdown that the frontend can use to render the image
                const encodedPath = encodeURIComponent(firstMatch);
                result += `\nINSTRUCTIONS FOR AI: Since this is an image, you MUST include the following EXACT markdown in your final response to visually show it to the user:\n\n![${filename}](/api/files/serve?path=${encodedPath})`;
            } else {
                result += `\nYou can use the 'fileread' tool to read its contents if needed.`;
            }

            return {
                message: result,
                total_matches: lines.length,
                all_paths: lines.slice(0, 5) // limit list
            };

        } catch (err) {
            return { error: `File "${filename}" not found in ${home}.` };
        }
    }
};
