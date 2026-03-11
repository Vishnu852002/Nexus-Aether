// Cloud model pricing per million tokens (USD)
// Updated Feb 2026 — add new models as they launch
const PRICING = {
    // OpenAI
    'gpt-4o': { input: 2.50, output: 10.00 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    'gpt-4-turbo': { input: 10.00, output: 30.00 },
    'gpt-4': { input: 30.00, output: 60.00 },
    'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
    'o1': { input: 15.00, output: 60.00 },
    'o1-mini': { input: 3.00, output: 12.00 },
    'o3-mini': { input: 1.10, output: 4.40 },

    // Anthropic
    'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
    'claude-opus-4-20250514': { input: 15.00, output: 75.00 },
    'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
    'claude-3-5-haiku-20241022': { input: 0.80, output: 4.00 },
    'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },

    // Google Gemini
    'gemini-2.5-pro': { input: 1.25, output: 10.00 },
    'gemini-2.5-flash': { input: 0.15, output: 0.60 },
    'gemini-2.0-flash': { input: 0.10, output: 0.40 },
    'gemini-1.5-pro': { input: 1.25, output: 5.00 },
    'gemini-1.5-flash': { input: 0.075, output: 0.30 },
};

function estimateCost(model, inputTokens, outputTokens) {
    // Try exact match first, then partial match
    let pricing = PRICING[model];
    if (!pricing) {
        const key = Object.keys(PRICING).find(k => model.includes(k));
        if (key) pricing = PRICING[key];
    }

    if (!pricing) {
        return { inputCost: 0, outputCost: 0, totalCost: 0, estimated: false };
    }

    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;

    return {
        inputCost: Math.round(inputCost * 10000) / 10000,
        outputCost: Math.round(outputCost * 10000) / 10000,
        totalCost: Math.round((inputCost + outputCost) * 10000) / 10000,
        estimated: true,
        pricing
    };
}

function getModelPricing(model) {
    let pricing = PRICING[model];
    if (!pricing) {
        const key = Object.keys(PRICING).find(k => model.includes(k));
        if (key) pricing = PRICING[key];
    }
    return pricing || null;
}

function isExpensive(model) {
    const p = getModelPricing(model);
    return p ? p.input >= 10 : false;
}

module.exports = { PRICING, estimateCost, getModelPricing, isExpensive };
