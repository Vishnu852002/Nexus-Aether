/**
 * Nexus Adaptive Routing Engine
 * 
 * Designed and implemented as a hybrid LLM orchestration platform with
 * cost-aware routing, adaptive failover, real-time observability, and
 * extensible tool execution system.
 * 
 * Implements lightweight adaptive routing inspired by load balancing strategies:
 *   - Rolling window latency (not lifetime average)
 *   - Dynamic error spike penalties with exponential decay
 *   - Provider health scoring (0–100) affecting candidate viability
 *   - Automatic traffic shifting when error rate rises
 *   - Cost/speed/quality strategy biases
 *   - Hardware-aware local model scoring
 * 
 * Includes failover: cloud fails → local, local OOM → cloud.
 */

const { getConfig } = require('./store');
const { getModelPricing, estimateCost } = require('./pricing');
const { getHardwareInfo } = require('./hardware');
const metrics = require('./metrics');

// Provider modules (lazy loaded)
let providers = null;
function getProviders() {
    if (!providers) {
        providers = {
            openai: require('./providers/openai'),
            anthropic: require('./providers/anthropic'),
            gemini: require('./providers/gemini'),
            openrouter: require('./providers/openrouter'),
            ollama: require('./providers/ollama'),
            lmstudio: require('./providers/lmstudio'),
        };
    }
    return providers;
}

// ═══ ROUTING STRATEGY ═══

const STRATEGY = {
    COST: 'cost',      // Minimize cost (prefer local)
    SPEED: 'speed',    // Minimize latency (fastest provider)
    QUALITY: 'quality', // Best model regardless of cost
    AUTO: 'auto',      // Balanced tradeoff (default)
};

/**
 * Score a model/provider combo for adaptive routing.
 * Higher score = better candidate.
 * 
 * Scoring is based on 7 factors:
 *   1. Cost (local=free vs cloud pricing)
 *   2. Prompt length sensitivity
 *   3. Hardware capability (GPU/VRAM)
 *   4. Rolling average latency (last 20 requests)
 *   5. Rolling error rate + spike penalty
 *   6. Provider health (0–100)
 *   7. Strategy bias (cost/speed/quality/auto)
 */
function scoreCandidate(candidate, context) {
    const { strategy, promptTokens, hw } = context;
    let score = 50;   // base score
    const reasons = [];

    const isLocal = ['ollama', 'lmstudio'].includes(candidate.provider);

    // ═══ Factor 1: Cost ═══
    if (isLocal) {
        score += 20;
        reasons.push('+20 local (free)');
    } else {
        const pricing = getModelPricing(candidate.id);
        if (pricing) {
            const estCost = (promptTokens / 1_000_000) * pricing.input;
            if (estCost > 0.01) {
                score -= 15;
                reasons.push('-15 expensive prompt ($' + estCost.toFixed(4) + ')');
            } else if (estCost > 0.001) {
                score -= 5;
                reasons.push('-5 moderate cost');
            } else {
                score += 5;
                reasons.push('+5 cheap cloud model');
            }
        }
    }

    // ═══ Factor 2: Prompt length ═══
    if (promptTokens > 4000) {
        if (!isLocal) {
            score += 10;
            reasons.push('+10 long prompt suits cloud');
        } else {
            score -= 10;
            reasons.push('-10 long prompt risky on local');
        }
    } else if (promptTokens < 500) {
        if (isLocal) {
            score += 5;
            reasons.push('+5 short prompt good for local');
        }
    }

    // ═══ Factor 3: Hardware capability ═══
    if (isLocal && hw) {
        const vram = hw.primaryGpu?.vram || 0;
        if (vram >= 12000) {
            score += 15;
            reasons.push(`+15 strong GPU (${Math.round(vram / 1024)}GB VRAM)`);
        } else if (vram >= 6000) {
            score += 5;
            reasons.push(`+5 adequate GPU (${Math.round(vram / 1024)}GB VRAM)`);
        } else if (vram > 0) {
            score -= 10;
            reasons.push(`-10 weak GPU (${Math.round(vram / 1024)}GB VRAM)`);
        } else {
            score -= 20;
            reasons.push('-20 no GPU detected');
        }
    }

    // ═══ Factor 4: Rolling latency (adaptive) ═══
    const rollingLatency = metrics.getRollingAvgLatency(candidate.provider);
    if (rollingLatency !== null) {
        if (rollingLatency < 500) {
            score += 12;
            reasons.push(`+12 fast rolling avg (${rollingLatency}ms)`);
        } else if (rollingLatency < 1500) {
            score += 4;
            reasons.push(`+4 ok rolling avg (${rollingLatency}ms)`);
        } else if (rollingLatency < 3000) {
            score -= 8;
            reasons.push(`-8 slow rolling avg (${rollingLatency}ms)`);
        } else {
            score -= 18;
            reasons.push(`-18 very slow (${rollingLatency}ms)`);
        }
    }

    // ═══ Factor 5: Rolling error rate + spike penalty ═══
    const rollingErrRate = metrics.getRollingErrorRate(candidate.provider);
    const spikePenalty = metrics.getSpikePenalty(candidate.provider);

    if (rollingErrRate > 0.5) {
        score -= 35;
        reasons.push(`-35 critical error rate (${Math.round(rollingErrRate * 100)}% rolling)`);
    } else if (rollingErrRate > 0.3) {
        score -= 25;
        reasons.push(`-25 high error rate (${Math.round(rollingErrRate * 100)}% rolling)`);
    } else if (rollingErrRate > 0.1) {
        score -= 10;
        reasons.push(`-10 some errors (${Math.round(rollingErrRate * 100)}% rolling)`);
    }

    // Apply spike penalty (dynamic, decays over time)
    if (spikePenalty > 0) {
        score -= spikePenalty;
        reasons.push(`-${spikePenalty} error spike penalty (decaying)`);
    }

    // ═══ Factor 6: Provider health ═══
    const health = metrics.getProviderHealth(candidate.provider);
    if (health < 30) {
        score -= 20;
        reasons.push(`-20 degraded health (${health}/100)`);
    } else if (health < 60) {
        score -= 8;
        reasons.push(`-8 reduced health (${health}/100)`);
    } else if (health >= 90) {
        score += 5;
        reasons.push(`+5 healthy provider (${health}/100)`);
    }

    // Apply traffic weight multiplier
    const weight = metrics.getTrafficWeight(candidate.provider);
    if (weight < 1.0) {
        const reduction = Math.round((1 - weight) * score);
        score = Math.round(score * weight);
        reasons.push(`×${weight.toFixed(2)} traffic weight (-${reduction})`);
    }

    // ═══ Factor 7: Strategy bias ═══
    if (strategy === STRATEGY.COST) {
        if (isLocal) { score += 40; reasons.push('+40 cost strategy → strongly prefer local (free)'); }
        else { score -= 25; reasons.push('-25 cost strategy → penalize cloud (costs money)'); }
    } else if (strategy === STRATEGY.SPEED) {
        if (rollingLatency !== null && rollingLatency < 1000) {
            score += 15;
            reasons.push('+15 speed strategy → fast provider');
        }
    } else if (strategy === STRATEGY.QUALITY) {
        const qualityModels = [
            'gpt-4.1', 'gpt-4o', 'gpt-4.1-mini',
            'claude-sonnet-4', 'claude-opus-4',
            'gemini-2.5-pro', 'gemini-2.5-flash',
            'deepseek-r1', 'qwen3'
        ];
        if (qualityModels.some(q => candidate.id.includes(q))) {
            score += 30;
            reasons.push('+30 quality strategy → top-tier model');
        }
    }

    return { ...candidate, score, reasons };
}

/**
 * Route a chat request — pick the best model adaptively.
 * Returns { provider, model, decision } where decision explains why.
 */
async function route(opts = {}) {
    const {
        messages = [],
        strategy = STRATEGY.AUTO,
        preferredProvider = null,
        preferredModel = null,
        excludeProviders = [],
    } = opts;

    const config = getConfig();
    const providerModules = getProviders();

    // If user explicitly chose a model, respect it (no routing needed)
    if (preferredModel && preferredProvider) {
        return {
            provider: preferredProvider,
            model: preferredModel,
            decision: {
                reason: 'User explicitly selected model',
                autoRouted: false,
                score: 100,
                candidates: []
            }
        };
    }

    // Gather available models from all enabled providers
    const candidates = [];
    const hw = await getHardwareInfo().catch(() => null);

    // Estimate prompt token count (~4 chars/token)
    const totalChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
    const promptTokens = Math.ceil(totalChars / 4);

    const context = { strategy, promptTokens, hw };

    for (const [provName, pConfig] of Object.entries(config.providers || {})) {
        if (!pConfig.enabled) continue;
        if (excludeProviders.includes(provName)) continue;

        const provider = providerModules[provName];
        if (!provider) continue;

        // Skip providers with critically low health unless it's the only option
        const provHealth = metrics.getProviderHealth(provName);
        if (provHealth < 10) {
            console.log(`[Nexus Router] Skipping ${provName}: health=${provHealth}/100 (critically degraded)`);
            continue;
        }

        try {
            const authOrBase = ['ollama', 'lmstudio'].includes(provName)
                ? pConfig.baseUrl
                : pConfig.apiKey;

            if (!authOrBase && !['ollama', 'lmstudio'].includes(provName)) continue;

            const models = await provider.listModels(authOrBase);
            if (Array.isArray(models)) {
                for (const m of models) {
                    candidates.push(scoreCandidate({ ...m, provider: provName }, context));
                }
            }
        } catch (err) {
            // Provider unavailable — skip silently
        }
    }

    if (candidates.length === 0) {
        return {
            provider: null,
            model: null,
            decision: {
                reason: 'No models available from any provider',
                autoRouted: true,
                score: 0,
                candidates: []
            }
        };
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);
    const winner = candidates[0];

    const decision = {
        reason: `Selected ${winner.id} from ${winner.provider} (score: ${winner.score})`,
        autoRouted: true,
        score: winner.score,
        factors: winner.reasons,
        promptTokens,
        strategy,
        hardwareDetected: !!hw?.primaryGpu,
        providerHealth: metrics.getProviderHealth(winner.provider),
        topCandidates: candidates.slice(0, 5).map(c => ({
            model: c.id,
            provider: c.provider,
            score: c.score,
            health: metrics.getProviderHealth(c.provider),
            reasons: c.reasons
        }))
    };

    // Record the routing decision
    metrics.recordRoutingDecision({
        selectedModel: winner.id,
        selectedProvider: winner.provider,
        score: winner.score,
        strategy,
        promptTokens,
        candidateCount: candidates.length,
        providerHealth: metrics.getProviderHealth(winner.provider)
    });

    return {
        provider: winner.provider,
        model: winner.id,
        decision
    };
}

/**
 * Execute chat with failover.
 * If primary provider fails → try fallback (cloud↔local).
 */
async function chatWithFailover(opts, onChunk, onDone, onError) {
    const {
        messages, model, provider: providerName, systemPrompt,
        strategy
    } = opts;

    const config = getConfig();
    const providerModules = getProviders();

    // Build full message list
    const fullMessages = [...messages];
    if (systemPrompt && !fullMessages.find(m => m.role === 'system')) {
        fullMessages.unshift({ role: 'system', content: systemPrompt });
    }

    // Sanitize messages for providers that don't support multimodal arrays or require specific formats
    function sanitizeMessages(msgs, provName) {
        const supportsMultimodal = ['openai', 'anthropic', 'gemini', 'openrouter', 'lmstudio'].includes(provName);

        return msgs.map(m => {
            if (Array.isArray(m.content)) {
                if (supportsMultimodal) return m;

                const textParts = m.content
                    .filter(p => p.type === 'text')
                    .map(p => p.text);
                const imageParts = m.content.filter(p => p.type === 'image_url');
                const imageCount = imageParts.length;

                if (provName === 'ollama') {
                    // Ollama expects a single string for content and an array of base64 strings for images
                    let flatContent = textParts.join('\n');
                    const images = imageParts.map(p => {
                        const url = p.image_url.url;
                        return url.includes(',') ? url.split(',')[1] : url; // Strip data URI prefix
                    });
                    if (images.length > 0) {
                        return { ...m, content: flatContent, images };
                    }
                    return { ...m, content: flatContent };
                }

                // Strip images for unsupported providers
                let flatContent = textParts.join('\n');
                if (imageCount > 0) {
                    flatContent += `\n[${imageCount} image(s) attached — this model cannot view images]`;
                }
                return { ...m, content: flatContent };
            }
            return m;
        });
    }

    // Primary attempt
    const primaryProvider = providerModules[providerName];
    if (!primaryProvider) {
        return onError(new Error(`Unknown provider: ${providerName}`));
    }

    const pConfig = config.providers?.[providerName];
    const isLocal = ['ollama', 'lmstudio'].includes(providerName);
    const authOrBase = isLocal ? pConfig?.baseUrl : pConfig?.apiKey;

    const startTime = Date.now();
    let tokenCount = 0;

    const wrappedChunk = (text) => {
        tokenCount += Math.ceil(text.length / 4);
        onChunk(text);
    };

    const sanitizedMessages = sanitizeMessages(fullMessages, providerName);

    try {
        await new Promise((resolve, reject) => {
            primaryProvider.streamChat(
                sanitizedMessages, model, authOrBase,
                wrappedChunk,
                () => {
                    const latency = Date.now() - startTime;
                    const pricing = getModelPricing(model);
                    const cost = pricing
                        ? (tokenCount / 1_000_000) * ((pricing.input + pricing.output) / 2)
                        : 0;

                    metrics.recordRequest(providerName, model, latency, tokenCount, tokenCount, cost);
                    resolve();
                },
                (err) => reject(err)
            );
        });
        onDone();
    } catch (primaryErr) {
        console.error(`[Nexus Router] Primary failed (${providerName}/${model}):`, primaryErr.message);

        // Record the error (this triggers spike detection automatically)
        metrics.recordRequest(providerName, model, Date.now() - startTime, 0, 0, 0, primaryErr);

        // ═══ FAILOVER ═══
        const fallbackType = isLocal ? 'cloud' : 'local';
        const fallbackProviders = Object.entries(config.providers || {})
            .filter(([name, cfg]) => {
                if (!cfg.enabled) return false;
                if (name === providerName) return false;
                const isFallbackLocal = ['ollama', 'lmstudio'].includes(name);
                return fallbackType === 'local' ? isFallbackLocal : !isFallbackLocal;
            })
            // Sort fallbacks by health (healthiest first)
            .sort(([a], [b]) => metrics.getProviderHealth(b) - metrics.getProviderHealth(a));

        if (fallbackProviders.length === 0) {
            return onError(primaryErr);
        }

        // Try fallbacks in health order
        for (const [fbName, fbConfig] of fallbackProviders) {
            const fbProvider = providerModules[fbName];
            if (!fbProvider) continue;

            const fbAuth = ['ollama', 'lmstudio'].includes(fbName)
                ? fbConfig.baseUrl
                : fbConfig.apiKey;

            if (!fbAuth && !['ollama', 'lmstudio'].includes(fbName)) continue;

            try {
                const fbModels = await fbProvider.listModels(fbAuth);
                if (!Array.isArray(fbModels) || fbModels.length === 0) continue;

                const fbModel = fbModels[0].id;
                const reason = `${providerName} failed (${primaryErr.message}), falling back to ${fbName}/${fbModel}`;
                console.log(`[Nexus Router] FAILOVER: ${reason}`);
                metrics.recordFailover(providerName, fbName, reason);

                // Send failover notice to client
                onChunk(`\n\n> ⚡ **Failover**: ${providerName} failed — switching to ${fbName} (${fbModel})\n\n`);

                const fbStart = Date.now();
                let fbTokens = 0;

                await new Promise((resolve, reject) => {
                    fbProvider.streamChat(
                        sanitizeMessages(fullMessages, fbName), fbModel, fbAuth,
                        (text) => { fbTokens += Math.ceil(text.length / 4); onChunk(text); },
                        () => {
                            metrics.recordRequest(fbName, fbModel, Date.now() - fbStart, fbTokens, fbTokens, 0);
                            resolve();
                        },
                        reject
                    );
                });

                onDone();
                return;
            } catch (fbErr) {
                console.error(`[Nexus Router] Fallback ${fbName} also failed:`, fbErr.message);
                metrics.recordRequest(fbName, 'unknown', 0, 0, 0, 0, fbErr);
                continue;
            }
        }

        // All fallbacks failed
        onError(new Error(`All providers failed. Primary (${providerName}): ${primaryErr.message}`));
    }
}

/**
 * Non-streaming helper for background tasks.
 * Returns the full response string.
 */
async function callModel(messages, preferredModel = null, preferredProvider = null, strategy = STRATEGY.AUTO) {
    let targetProvider = preferredProvider;
    let targetModel = preferredModel;

    if (!targetModel || !targetProvider) {
        const { provider, model } = await route({ messages, strategy });
        targetProvider = provider;
        targetModel = model;
    }

    if (!targetProvider || !targetModel) {
        throw new Error('No model available for background task');
    }

    let fullText = '';
    await new Promise((resolve, reject) => {
        chatWithFailover(
            { messages, model: targetModel, provider: targetProvider, strategy },
            (chunk) => { fullText += chunk; },
            resolve,
            reject
        );
    });

    return fullText;
}

module.exports = { route, chatWithFailover, callModel, STRATEGY };
