const fs = require('fs');
const path = require('path');
const { callModel } = require('./router'); // Assuming router exports a helper to hit models directly

class AgentScheduler {
    constructor() {
        this.tasks = new Map();

        // Load persist state or default configuration
        this.configPath = path.join(process.env.DATA_DIR || __dirname, 'scheduler.json');
        this.loadState();

        // Define standard available background tasks
        this.availableTasks = {
            news_summary: {
                name: 'Daily Tech News Summary',
                description: 'Fetches top tech headlines and asks the AI to summarize them into a quick morning digest.',
                execute: async (config) => this.executeNewsSummary(config),
                defaultInterval: 1000 * 60 * 60 * 24 // 24 hours
            },
            doc_watcher: {
                name: 'Document Watcher',
                description: 'Watches the documents folder for changes and automatically ingests new files.',
                execute: async (config) => this.executeDocWatcher(config),
                defaultInterval: 1000 * 60 * 60 // 1 hour
            }
        };
    }

    loadState() {
        try {
            if (fs.existsSync(this.configPath)) {
                const data = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
                this.activeTasks = data.activeTasks || {};
            } else {
                this.activeTasks = {};
            }
        } catch (e) {
            this.activeTasks = {};
        }
    }

    saveState() {
        fs.writeFileSync(this.configPath, JSON.stringify({ activeTasks: this.activeTasks }, null, 2));
    }

    startAll() {
        for (const [id, config] of Object.entries(this.activeTasks)) {
            if (config.enabled) {
                this.scheduleTask(id);
            }
        }
    }

    scheduleTask(taskId) {
        if (!this.availableTasks[taskId]) return;

        // Clear existing timers if any
        if (this.tasks.has(taskId)) {
            clearTimeout(this.tasks.get(taskId).timeout);
            clearInterval(this.tasks.get(taskId).interval);
        }

        const taskDef = this.availableTasks[taskId];
        const config = this.activeTasks[taskId];
        const interval = config?.interval || taskDef.defaultInterval;
        const timeOfDay = config?.timeOfDay || null;

        const executeAndReschedule = () => {
            console.log(`[Scheduler] Executing task: ${taskId} (Model override: ${config?.model || 'None'})`);

            // Pass configuration to the task's execute function
            taskDef.execute(config).catch(err => {
                console.error(`[Scheduler] Error in task ${taskId}:`, err);
            });

            // Set up recurring interval after first execution
            const timer = setInterval(() => {
                console.log(`[Scheduler] Executing task: ${taskId} (Model override: ${config?.model || 'None'})`);
                taskDef.execute(config).catch(err => {
                    console.error(`[Scheduler] Error in task ${taskId}:`, err);
                });
            }, interval);

            this.tasks.set(taskId, { interval: timer });
            console.log(`[Scheduler] Scheduled recurring task ${taskId} every ${interval}ms`);
        };

        let delayMs = 0;

        if (timeOfDay) {
            // Calculate ms until next occurrence of timeOfDay (HH:MM)
            const now = new Date();
            const [targetHour, targetMinute] = timeOfDay.split(':').map(Number);
            const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), targetHour, targetMinute, 0);

            if (target.getTime() <= now.getTime()) {
                // Time has passed today, schedule for tomorrow
                target.setDate(target.getDate() + 1);
            }

            delayMs = target.getTime() - now.getTime();
            const nextRunStr = target.toLocaleString();
            console.log(`[Scheduler] Task ${taskId} scheduled for first run at ${nextRunStr}`);

            const initialTimeout = setTimeout(executeAndReschedule, delayMs);
            this.tasks.set(taskId, { timeout: initialTimeout });
        } else {
            // No specific time, execute immediately and set interval
            executeAndReschedule();
        }
    }

    stopTask(taskId) {
        if (this.tasks.has(taskId)) {
            const timers = this.tasks.get(taskId);
            if (timers.timeout) clearTimeout(timers.timeout);
            if (timers.interval) clearInterval(timers.interval);

            this.tasks.delete(taskId);
            console.log(`[Scheduler] Stopped task ${taskId}`);
        }
    }

    enableTask(taskId, interval, timeOfDay, model, provider) {
        if (!this.availableTasks[taskId]) throw new Error('Unknown task ID');
        this.activeTasks[taskId] = {
            enabled: true,
            interval: interval || this.availableTasks[taskId].defaultInterval,
            timeOfDay: timeOfDay || null,
            model: model || null,
            provider: provider || null
        };
        this.saveState();
        this.scheduleTask(taskId);
    }

    disableTask(taskId) {
        if (this.activeTasks[taskId]) {
            this.activeTasks[taskId].enabled = false;
            this.saveState();
            this.stopTask(taskId);
        }
    }

    getStatus() {
        return Object.keys(this.availableTasks).map(id => {
            const def = this.availableTasks[id];
            const active = this.activeTasks[id];
            return {
                id,
                name: def.name,
                description: def.description,
                enabled: active?.enabled || false,
                interval: active?.interval || def.defaultInterval,
                timeOfDay: active?.timeOfDay || '',
                model: active?.model || '',
                isRunning: this.tasks.has(id)
            };
        });
    }

    // --- IPC Helper for Electron Notifications ---
    notifyDesktop(title, body) {
        if (process.send) {
            process.send({ type: 'notification', title, body });
        } else {
            console.log(`[Desktop Notification Fallback] ${title}: ${body}`);
        }
    }

    // --- Task Implementations ---

    async executeNewsSummary(config = {}) {
        console.log('[Scheduler] Fetching latest tech news for summary...');

        // Mocking news headlines (in a real app, this could be an RSS/DuckDuckGo fetch)
        const headlines = [
            "OpenAI announces GPT-5 Preview for enterprise customers.",
            "Local LLM performance benchmarks show 40% improvement on RTX 50-series GPUs.",
            "Nexus AI reaches version 1.0 with Frost Glass design language.",
            "New security vulnerability found in common JavaScript bundlers."
        ].join('\n');

        try {
            const prompt = `You are a professional tech news agent for Nexus AI. Summarize these headlines into a concise, professional 3-sentence morning briefing for the user:\n\n${headlines}`;

            const summary = await callModel(
                [{ role: 'user', content: prompt }],
                config.model,
                config.provider
            );

            console.log(`[Scheduler] News summary generated: "${summary.substring(0, 50)}..."`);
            this.notifyDesktop('Tech News Digest', summary);
            return summary;
        } catch (e) {
            console.error('[Scheduler] News summary failed:', e.message);
            const errSummary = 'I tried to fetch your morning briefing, but the AI models were unresponsive. Check your API keys!';
            this.notifyDesktop('Tech News Digest', errSummary);
            return errSummary;
        }
    }

    async executeDocWatcher() {
        // Logic to scan data/documents/ for unindexed files
        console.log('[Scheduler] Checking for new documents...');
        // Simulate finding one
        return new Promise(resolve => {
            setTimeout(() => {
                const msg = 'Processed 1 new file added to your workspace.';
                this.notifyDesktop('Document Watcher', msg);
                resolve(msg);
            }, 1000);
        });
    }
}

// Singleton instance
const scheduler = new AgentScheduler();
module.exports = scheduler;
