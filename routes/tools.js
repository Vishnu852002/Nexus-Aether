const express = require('express');
const router = express.Router();
const toolRunner = require('../lib/toolRunner');

// GET /api/tools — list registered tools
router.get('/', (req, res) => {
    res.json(toolRunner.listTools());
});

// POST /api/tools/execute — execute a tool directly
router.post('/execute', async (req, res) => {
    const { name, arguments: args } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Missing tool name' });
    }

    const result = await toolRunner.executeTool(name, args || {});
    res.json(result);
});

// GET /api/tools/schemas — get tool schemas for model consumption
router.get('/schemas', (req, res) => {
    res.json(toolRunner.getToolSchemas());
});

module.exports = router;
