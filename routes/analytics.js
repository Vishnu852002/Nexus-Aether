const express = require('express');
const router = express.Router();
const metrics = require('../lib/metrics');
const toolRunner = require('../lib/toolRunner');

// GET /api/analytics — full analytics dashboard data
router.get('/', (req, res) => {
    try {
        const analytics = metrics.getAnalytics();
        analytics.tools = {
            ...analytics.tools,
            registered: toolRunner.listTools()
        };
        res.json(analytics);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/analytics/reset — reset all metrics
router.post('/reset', (req, res) => {
    metrics.resetMetrics();
    res.json({ success: true });
});

// GET /api/analytics/routing — recent routing decisions
router.get('/routing', (req, res) => {
    const analytics = metrics.getAnalytics();
    res.json(analytics.routing);
});

// GET /api/analytics/failovers — recent failover events
router.get('/failovers', (req, res) => {
    const analytics = metrics.getAnalytics();
    res.json(analytics.failovers);
});

module.exports = router;
