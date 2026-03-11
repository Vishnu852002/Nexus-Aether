/**
 * Nexus Metrics Store — Adaptive Observability
 * 
 * Implements lightweight adaptive routing inspired by load balancing strategies:
 *   - Rolling window latency (last N requests, not lifetime average)
 *   - Exponential error spike detection with dynamic penalty
 *   - Automatic traffic shifting when error rate rises
 *   - Provider health scoring (0–100) recalculated on every request
 * 
 * Persists to data/metrics.json.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const METRICS_PATH = path.join(DATA_DIR, 'metrics.json');

// ═══ ADAPTIVE CONSTANTS ═══
const ROLLING_WINDOW_SIZE = 20;           // Last N requests for rolling averages
const ERROR_SPIKE_WINDOW_MS = 60_000;     // 60s window for spike detection
const ERROR_SPIKE_THRESHOLD = 3;          // 3+ errors in window = spike
const SPIKE_PENALTY_DECAY_MS = 120_000;   // Penalty decays over 2 minutes
const HEALTH_RECOVERY_RATE = 0.05;        // Health recovers 5% per successful request

// In-memory metrics
let metrics = null;

function getDefaultMetrics() {
    return {
        sessions: [],
        providers: {},
        routing: { decisions: [], totalRouted: 0 },
        failovers: [],
        tools: { calls: [], totalCalls: 0 },
        startedAt: new Date().toISOString()
    };
}

function getProviderMetrics(provider) {
    if (!metrics.providers[provider]) {
        metrics.providers[provider] = {
            requests: 0,
            errors: 0,
            totalLatencyMs: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalCost: 0,
            lastUsed: null,
            // ═══ ADAPTIVE FIELDS ═══
            recentLatencies: [],       // Rolling window: [{ms, timestamp}]
            recentErrors: [],          // Rolling window: [{timestamp, message}]
            health: 100,               // 0–100 provider health score
            spikePenalty: 0,           // Dynamic penalty during error spikes
            spikeDetectedAt: null,     // When the current spike started
            trafficWeight: 1.0         // Traffic multiplier (reduced during issues)
        };
    }
    return metrics.providers[provider];
}

function load() {
    if (metrics) return metrics;
    try {
        if (fs.existsSync(METRICS_PATH)) {
            metrics = JSON.parse(fs.readFileSync(METRICS_PATH, 'utf-8'));
            // Ensure adaptive fields exist on loaded data
            for (const pm of Object.values(metrics.providers || {})) {
                if (!pm.recentLatencies) pm.recentLatencies = [];
                if (!pm.recentErrors) pm.recentErrors = [];
                if (pm.health === undefined) pm.health = 100;
                if (pm.spikePenalty === undefined) pm.spikePenalty = 0;
                if (pm.trafficWeight === undefined) pm.trafficWeight = 1.0;
            }
        } else {
            metrics = getDefaultMetrics();
        }
    } catch {
        metrics = getDefaultMetrics();
    }
    return metrics;
}

function save() {
    try {
        const dir = path.dirname(METRICS_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(METRICS_PATH, JSON.stringify(metrics, null, 2));
    } catch (e) {
        console.error('Failed to save metrics:', e.message);
    }
}

// ═══ ADAPTIVE ENGINE ═══

/**
 * Detect error spikes: 3+ errors within a 60-second window.
 * When a spike is detected, apply an exponential penalty that decays over time.
 */
function detectErrorSpike(pm) {
    const now = Date.now();
    const recentWindow = pm.recentErrors.filter(
        e => (now - new Date(e.timestamp).getTime()) < ERROR_SPIKE_WINDOW_MS
    );

    if (recentWindow.length >= ERROR_SPIKE_THRESHOLD) {
        // Spike detected — apply penalty proportional to error count
        const severity = Math.min(recentWindow.length / ERROR_SPIKE_THRESHOLD, 3); // 1x–3x
        pm.spikePenalty = Math.min(50, severity * 15); // max penalty: 50 pts
        pm.spikeDetectedAt = new Date().toISOString();
        pm.trafficWeight = Math.max(0.1, 1.0 - (pm.spikePenalty / 100)); // Reduce traffic

        console.log(`[Nexus Adaptive] ⚠️ Error spike on ${Object.keys(metrics.providers).find(k => metrics.providers[k] === pm) || '?'}: ${recentWindow.length} errors in ${ERROR_SPIKE_WINDOW_MS / 1000}s, penalty=${pm.spikePenalty}, weight=${pm.trafficWeight.toFixed(2)}`);
        return true;
    }
    return false;
}

/**
 * Decay spike penalty over time (exponential decay).
 * Called before routing decisions to update current penalty state.
 */
function decayPenalty(pm) {
    if (!pm.spikeDetectedAt || pm.spikePenalty <= 0) return;

    const elapsed = Date.now() - new Date(pm.spikeDetectedAt).getTime();
    if (elapsed > SPIKE_PENALTY_DECAY_MS) {
        // Fully decayed
        pm.spikePenalty = 0;
        pm.spikeDetectedAt = null;
        pm.trafficWeight = 1.0;
    } else {
        // Exponential decay: penalty * e^(-elapsed/halflife)
        const halflife = SPIKE_PENALTY_DECAY_MS / 3;
        const decayFactor = Math.exp(-elapsed / halflife);
        pm.spikePenalty = Math.round(pm.spikePenalty * decayFactor);
        pm.trafficWeight = Math.max(0.1, 1.0 - (pm.spikePenalty / 100));
    }
}

/**
 * Update provider health score after each request.
 * Health goes down on errors, recovers slowly on successes.
 */
function updateHealth(pm, wasError) {
    if (wasError) {
        // Sharp drop: -15 per error, minimum 0
        pm.health = Math.max(0, pm.health - 15);
    } else {
        // Gradual recovery: +5% towards 100
        pm.health = Math.min(100, pm.health + (100 - pm.health) * HEALTH_RECOVERY_RATE);
    }
}

// ═══ RECORDING FUNCTIONS ═══

function recordRequest(provider, model, latencyMs, inputTokens, outputTokens, cost, error = null) {
    load();
    const pm = getProviderMetrics(provider);
    const now = new Date().toISOString();

    pm.requests++;
    pm.totalLatencyMs += latencyMs;
    pm.totalInputTokens += inputTokens;
    pm.totalOutputTokens += outputTokens;
    pm.totalCost += cost;
    pm.lastUsed = now;

    // Rolling latency window
    pm.recentLatencies.push({ ms: latencyMs, timestamp: now });
    if (pm.recentLatencies.length > ROLLING_WINDOW_SIZE) {
        pm.recentLatencies = pm.recentLatencies.slice(-ROLLING_WINDOW_SIZE);
    }

    if (error) {
        pm.errors++;
        pm.recentErrors.push({ timestamp: now, message: error.message || String(error) });
        if (pm.recentErrors.length > 50) {
            pm.recentErrors = pm.recentErrors.slice(-50);
        }
        detectErrorSpike(pm);
    }

    updateHealth(pm, !!error);
    save();
}

function recordRoutingDecision(decision) {
    load();
    metrics.routing.decisions.push({
        ...decision,
        timestamp: new Date().toISOString()
    });
    if (metrics.routing.decisions.length > 200) {
        metrics.routing.decisions = metrics.routing.decisions.slice(-200);
    }
    metrics.routing.totalRouted++;
    save();
}

function recordFailover(from, to, reason) {
    load();
    metrics.failovers.push({
        from,
        to,
        reason,
        timestamp: new Date().toISOString()
    });
    if (metrics.failovers.length > 100) {
        metrics.failovers = metrics.failovers.slice(-100);
    }
    save();
}

function recordToolCall(toolName, success, durationMs, error = null) {
    load();
    metrics.tools.calls.push({
        tool: toolName,
        success,
        durationMs,
        error: error?.message || null,
        timestamp: new Date().toISOString()
    });
    if (metrics.tools.calls.length > 200) {
        metrics.tools.calls = metrics.tools.calls.slice(-200);
    }
    metrics.tools.totalCalls++;
    save();
}

// ═══ ADAPTIVE QUERY FUNCTIONS ═══

/**
 * Get rolling average latency (last N requests, not lifetime).
 * This reacts faster to changing conditions.
 */
function getRollingAvgLatency(provider) {
    load();
    const pm = metrics.providers?.[provider];
    if (!pm || pm.recentLatencies.length === 0) return null;
    const sum = pm.recentLatencies.reduce((s, r) => s + r.ms, 0);
    return Math.round(sum / pm.recentLatencies.length);
}

/**
 * Get rolling error rate (errors in last N requests).
 * More responsive than lifetime average.
 */
function getRollingErrorRate(provider) {
    load();
    const pm = metrics.providers?.[provider];
    if (!pm || pm.requests === 0) return 0;

    // Use the recent error window relative to total recent requests
    const recentCount = pm.recentLatencies.length;
    if (recentCount === 0) return 0;

    const recentErrorCount = pm.recentErrors.filter(e => {
        const errTime = new Date(e.timestamp).getTime();
        if (pm.recentLatencies.length === 0) return false;
        const oldestRecent = new Date(pm.recentLatencies[0].timestamp).getTime();
        return errTime >= oldestRecent;
    }).length;

    return recentErrorCount / recentCount;
}

/**
 * Get the current spike penalty for a provider.
 * Auto-decays over time — higher penalty = more recent/severe spike.
 */
function getSpikePenalty(provider) {
    load();
    const pm = metrics.providers?.[provider];
    if (!pm) return 0;
    decayPenalty(pm);
    return pm.spikePenalty;
}

/**
 * Get provider health score (0–100).
 * 100 = perfect, 0 = completely degraded.
 */
function getProviderHealth(provider) {
    load();
    const pm = metrics.providers?.[provider];
    if (!pm) return 100; // Unknown provider = assume healthy
    decayPenalty(pm);
    return Math.round(pm.health);
}

/**
 * Get traffic weight (0.1–1.0).
 * Used to proportionally reduce traffic to unhealthy providers.
 */
function getTrafficWeight(provider) {
    load();
    const pm = metrics.providers?.[provider];
    if (!pm) return 1.0;
    decayPenalty(pm);
    return pm.trafficWeight;
}

// Legacy functions (kept for backward compat, now use rolling data)
function getProviderAvgLatency(provider) {
    return getRollingAvgLatency(provider);
}

function getProviderErrorRate(provider) {
    return getRollingErrorRate(provider);
}

// ═══ ANALYTICS DASHBOARD ═══

function getAnalytics() {
    load();
    const analytics = {
        providers: {},
        routing: {
            totalRouted: metrics.routing.totalRouted,
            recentDecisions: metrics.routing.decisions.slice(-20)
        },
        failovers: {
            total: metrics.failovers.length,
            recent: metrics.failovers.slice(-10)
        },
        tools: {
            totalCalls: metrics.tools.totalCalls,
            recentCalls: metrics.tools.calls.slice(-20)
        },
        overview: {
            totalRequests: 0,
            totalErrors: 0,
            totalCost: 0,
            totalTokens: 0,
            localPercent: 0,
            cloudPercent: 0,
            avgLatencyMs: 0,
            startedAt: metrics.startedAt
        }
    };

    let totalRequests = 0, totalErrors = 0, totalCost = 0, totalTokens = 0;
    let totalLatency = 0, localReqs = 0, cloudReqs = 0;

    for (const [name, pm] of Object.entries(metrics.providers)) {
        decayPenalty(pm);
        const rollingLatency = getRollingAvgLatency(name);
        const rollingErrRate = getRollingErrorRate(name);
        const lifetimeErrRate = pm.requests > 0 ? Math.round((pm.errors / pm.requests) * 100) : 0;

        analytics.providers[name] = {
            requests: pm.requests,
            errors: pm.errors,
            errorRate: `${lifetimeErrRate}%`,
            rollingErrorRate: `${Math.round(rollingErrRate * 100)}%`,
            avgLatencyMs: rollingLatency || 0,
            totalTokens: pm.totalInputTokens + pm.totalOutputTokens,
            totalCost: Math.round(pm.totalCost * 10000) / 10000,
            lastUsed: pm.lastUsed,
            health: Math.round(pm.health),
            spikePenalty: pm.spikePenalty,
            trafficWeight: pm.trafficWeight
        };

        totalRequests += pm.requests;
        totalErrors += pm.errors;
        totalCost += pm.totalCost;
        totalTokens += pm.totalInputTokens + pm.totalOutputTokens;
        totalLatency += pm.totalLatencyMs;

        if (['ollama', 'lmstudio'].includes(name)) localReqs += pm.requests;
        else cloudReqs += pm.requests;
    }

    analytics.overview.totalRequests = totalRequests;
    analytics.overview.totalErrors = totalErrors;
    analytics.overview.totalCost = Math.round(totalCost * 10000) / 10000;
    analytics.overview.totalTokens = totalTokens;
    analytics.overview.avgLatencyMs = totalRequests > 0 ? Math.round(totalLatency / totalRequests) : 0;
    analytics.overview.localPercent = totalRequests > 0 ? Math.round((localReqs / totalRequests) * 100) : 0;
    analytics.overview.cloudPercent = totalRequests > 0 ? Math.round((cloudReqs / totalRequests) * 100) : 0;

    return analytics;
}

function resetMetrics() {
    metrics = getDefaultMetrics();
    save();
}

module.exports = {
    recordRequest,
    recordRoutingDecision,
    recordFailover,
    recordToolCall,
    getAnalytics,
    getProviderAvgLatency,
    getProviderErrorRate,
    getRollingAvgLatency,
    getRollingErrorRate,
    getSpikePenalty,
    getProviderHealth,
    getTrafficWeight,
    resetMetrics,
    load
};
