/**
 * Calculator Tool
 * Safe math expression evaluator.
 */

module.exports = {
    description: 'Evaluate mathematical expressions. Supports basic arithmetic, trig, log, sqrt, etc.',
    parameters: {
        type: 'object',
        properties: {
            expression: {
                type: 'string',
                description: 'Mathematical expression to evaluate, e.g. "2 * (3 + 4)" or "sqrt(144)"'
            }
        },
        required: ['expression']
    },

    async execute({ expression }) {
        // Whitelist safe math operations
        const allowed = /^[\d\s\+\-\*\/\.\(\)\%\^]+$/;
        const mathFns = ['Math.sin', 'Math.cos', 'Math.tan', 'Math.sqrt', 'Math.log', 'Math.log2',
            'Math.log10', 'Math.abs', 'Math.ceil', 'Math.floor', 'Math.round', 'Math.pow',
            'Math.PI', 'Math.E', 'Math.min', 'Math.max'];

        // Replace friendly function names with Math.* equivalents
        let safe = expression
            .replace(/\bsin\(/g, 'Math.sin(')
            .replace(/\bcos\(/g, 'Math.cos(')
            .replace(/\btan\(/g, 'Math.tan(')
            .replace(/\bsqrt\(/g, 'Math.sqrt(')
            .replace(/\blog\(/g, 'Math.log(')
            .replace(/\blog2\(/g, 'Math.log2(')
            .replace(/\blog10\(/g, 'Math.log10(')
            .replace(/\babs\(/g, 'Math.abs(')
            .replace(/\bceil\(/g, 'Math.ceil(')
            .replace(/\bfloor\(/g, 'Math.floor(')
            .replace(/\bround\(/g, 'Math.round(')
            .replace(/\bpow\(/g, 'Math.pow(')
            .replace(/\bmin\(/g, 'Math.min(')
            .replace(/\bmax\(/g, 'Math.max(')
            .replace(/\bPI\b/g, 'Math.PI')
            .replace(/\bpi\b/g, 'Math.PI')
            .replace(/\be\b/g, 'Math.E')
            .replace(/\^/g, '**');

        // Security: reject anything that's not math
        const sanitized = safe.replace(/Math\.\w+/g, '').replace(/[\d\s\+\-\*\/\.\(\)\%\,]/g, '');
        if (sanitized.length > 0) {
            throw new Error(`Unsafe expression detected: "${expression}". Only math operations allowed.`);
        }

        try {
            const fn = new Function(`"use strict"; return (${safe});`);
            const result = fn();

            if (typeof result !== 'number' || !isFinite(result)) {
                return { expression, result: String(result), note: 'Result is not a finite number' };
            }

            return {
                expression,
                result: Number(result.toFixed(10)),
                formatted: result.toLocaleString()
            };
        } catch (err) {
            throw new Error(`Failed to evaluate: ${err.message}`);
        }
    }
};
