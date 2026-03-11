const express = require('express');
const router = express.Router();
const scheduler = require('../lib/scheduler');

// GET /api/scheduler/tasks - Get all available background agents and their statuses
router.get('/tasks', (req, res) => {
    try {
        const statuses = scheduler.getStatus();
        res.json(statuses);
    } catch (err) {
        console.error('[Scheduler API] Get tasks error', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/scheduler/enable - Enable a task
router.post('/enable', (req, res) => {
    try {
        const { taskId, interval, timeOfDay, model, provider } = req.body;
        if (!taskId) return res.status(400).json({ error: "taskId is required" });

        scheduler.enableTask(taskId, interval, timeOfDay, model, provider);
        res.json({ success: true, statuses: scheduler.getStatus() });
    } catch (err) {
        console.error('[Scheduler API] Enable task error', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/scheduler/disable - Disable a task
router.post('/disable', (req, res) => {
    try {
        const { taskId } = req.body;
        if (!taskId) return res.status(400).json({ error: "taskId is required" });

        scheduler.disableTask(taskId);
        res.json({ success: true, statuses: scheduler.getStatus() });
    } catch (err) {
        console.error('[Scheduler API] Disable task error', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/scheduler/trigger - Run a task immediately for testing
router.post('/trigger', async (req, res) => {
    try {
        const { taskId } = req.body;
        if (!taskId || !scheduler.availableTasks[taskId]) {
            return res.status(400).json({ error: "Valid taskId is required" });
        }

        // Execute and wait for result so the browser UI can display it
        const config = scheduler.activeTasks[taskId] || {};
        const result = await scheduler.availableTasks[taskId].execute(config);
        res.json({ success: true, message: "Task triggered immediately.", result });
    } catch (err) {
        console.error('[Scheduler API] Trigger task error', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
