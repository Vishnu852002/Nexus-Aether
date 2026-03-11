const express = require('express');
const router = express.Router();
const { getMemories, addMemory, deleteMemory, clearMemories, getGraph } = require('../lib/memory');

// GET /api/memory — list all memories
router.get('/', (req, res) => {
    res.json(getMemories());
});

// GET /api/memory/graph — D3-compatible { nodes, edges }
router.get('/graph', (req, res) => {
    res.json(getGraph());
});

// POST /api/memory — add a memory manually
router.post('/', (req, res) => {
    const { content, category, tags } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required' });
    const mem = addMemory({ content, category, tags, source: 'manual' });
    if (mem) {
        res.json(mem);
    } else {
        res.json({ skipped: true, reason: 'duplicate' });
    }
});

// DELETE /api/memory/:id
router.delete('/:id', (req, res) => {
    deleteMemory(req.params.id);
    res.json({ success: true });
});

// DELETE /api/memory — clear all
router.delete('/', (req, res) => {
    clearMemories();
    res.json({ success: true });
});

module.exports = router;
