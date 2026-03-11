const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const SANDBOX_DIR = path.resolve(process.cwd(), 'sandbox');

// Ensure sandbox directory exists
if (!fs.existsSync(SANDBOX_DIR)) {
    fs.mkdirSync(SANDBOX_DIR, { recursive: true });
}

module.exports = {
    name: 'run_code',
    description: 'Execute Python or Node.js code autonomously inside a safe, isolated /sandbox directory. Use this to write scripts, build mini-apps, test logic, or process files. You have full read/write access WITHIN the sandbox. All output (stdout/stderr) will be returned to you.',
    parameters: {
        type: 'object',
        properties: {
            language: {
                type: 'string',
                enum: ['nodejs', 'python'],
                description: 'The runtime to use.'
            },
            code: {
                type: 'string',
                description: 'The complete, runnable code script to execute.'
            },
            filename: {
                type: 'string',
                description: 'Optional filename to save the code as (e.g., app.js, script.py). If omitted, a temporary file will be used.'
            }
        },
        required: ['language', 'code']
    },
    execute: async (args) => {
        const { language, code, filename } = args;

        // Determine extension and command
        const ext = language === 'python' ? '.py' : '.js';
        const cmd = language === 'python' ? 'python' : 'node'; // Note: assumes 'python' is in PATH. On Windows it might be 'py' or 'python'.

        // Use provided filename or generate a temp one
        const safeFilename = filename ? path.basename(filename) : `temp_${Date.now()}${ext}`;
        const scriptPath = path.join(SANDBOX_DIR, safeFilename);

        // Security check: ensure the resolved path is still strictly inside the sandbox
        // This prevents directory traversal attacks like filename: "../../../windows/system32/hack.py"
        if (!scriptPath.startsWith(SANDBOX_DIR)) {
            return {
                error: "SECURITY VIOLATION: Attempted to write outside of the restricted /sandbox directory."
            };
        }

        try {
            // Write the script to the sandbox
            fs.writeFileSync(scriptPath, code, 'utf8');

            // Execute the script
            return new Promise((resolve) => {
                // Hard timeout of 30 seconds to prevent infinite loops locking up the server
                exec(`${cmd} "${safeFilename}"`, { cwd: SANDBOX_DIR, timeout: 30000 }, (error, stdout, stderr) => {

                    let status = "Success";
                    if (error) {
                        status = error.killed ? "Timeout Exceeded (Killed)" : "Runtime Error";
                    }

                    // Auto-cleanup temporary scripts
                    if (!filename || safeFilename.startsWith('temp_')) {
                        try {
                            if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
                        } catch (e) {
                            // ignore cleanup errors
                        }
                    }

                    resolve({
                        status,
                        script_path: scriptPath,
                        stdout: stdout.trim(),
                        stderr: stderr.trim() || (error ? error.message : "")
                    });
                });
            });

        } catch (err) {
            return {
                error: `Failed to write or execute script: ${err.message}`
            };
        }
    }
};
