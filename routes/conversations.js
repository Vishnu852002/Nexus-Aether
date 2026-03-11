const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const CONV_DIR = path.join(DATA_DIR, 'conversations');

// GET /api/conversations — list all conversations
router.get('/', (req, res) => {
    try {
        if (!fs.existsSync(CONV_DIR)) {
            return res.json([]);
        }

        const files = fs.readdirSync(CONV_DIR).filter(f => f.endsWith('.json'));
        const conversations = files.map(f => {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(CONV_DIR, f), 'utf-8'));
                return {
                    id: data.id,
                    title: data.title,
                    createdAt: data.createdAt,
                    updatedAt: data.updatedAt,
                    messageCount: data.messages?.length || 0,
                    model: data.model,
                    provider: data.provider
                };
            } catch {
                return null;
            }
        }).filter(Boolean);

        // Sort by most recent
        conversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        res.json(conversations);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/conversations/:id — get full conversation
router.get('/:id', (req, res) => {
    try {
        const filePath = path.join(CONV_DIR, `${req.params.id}.json`);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/conversations — create new conversation
router.post('/', (req, res) => {
    try {
        const id = uuidv4();
        const conversation = {
            id,
            title: req.body.title || 'New Chat',
            messages: [],
            model: req.body.model || null,
            provider: req.body.provider || null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        fs.writeFileSync(
            path.join(CONV_DIR, `${id}.json`),
            JSON.stringify(conversation, null, 2)
        );

        res.json(conversation);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/conversations/:id — update conversation (title, messages, model)
router.put('/:id', (req, res) => {
    try {
        const filePath = path.join(CONV_DIR, `${req.params.id}.json`);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Conversation not found' });
        }

        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        if (req.body.title !== undefined) data.title = req.body.title;
        if (req.body.messages !== undefined) data.messages = req.body.messages;
        if (req.body.model !== undefined) data.model = req.body.model;
        if (req.body.provider !== undefined) data.provider = req.body.provider;
        data.updatedAt = new Date().toISOString();

        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/conversations/:id
router.delete('/:id', (req, res) => {
    try {
        const filePath = path.join(CONV_DIR, `${req.params.id}.json`);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
