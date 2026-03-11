const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { getConfig, saveConfig } = require('../lib/store');
const { getHardwareInfo } = require('../lib/hardware');
const { PRICING } = require('../lib/pricing');

// GET /api/settings — get current config (keys masked)
router.get('/', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const config = getConfig();

    // Mask API keys
    const masked = JSON.parse(JSON.stringify(config));
    for (const [name, pConfig] of Object.entries(masked.providers || {})) {
        if (pConfig.apiKey) {
            pConfig.apiKey = pConfig.apiKey.length > 8
                ? pConfig.apiKey.slice(0, 4) + '•'.repeat(20) + pConfig.apiKey.slice(-4)
                : '••••••••';
        }
    }

    res.json(masked);
});

// POST /api/settings — save settings
router.post('/', (req, res) => {
    try {
        const config = getConfig();
        const updates = req.body;

        // Update providers
        if (updates.providers) {
            if (!config.providers) config.providers = {};

            for (const [name, pConfig] of Object.entries(updates.providers)) {
                if (!config.providers[name]) config.providers[name] = {};

                // Only update apiKey if it's not the masked version
                if (pConfig.apiKey !== undefined && !pConfig.apiKey.includes('•')) {
                    config.providers[name].apiKey = pConfig.apiKey;
                }
                if (pConfig.baseUrl !== undefined) {
                    config.providers[name].baseUrl = pConfig.baseUrl;
                }
                if (pConfig.enabled !== undefined) {
                    config.providers[name].enabled = pConfig.enabled;
                }
            }
        }

        // Update appearance
        if (updates.appearance) {
            config.appearance = { ...config.appearance, ...updates.appearance };
        }

        // Update default model
        if (updates.defaultModel !== undefined) config.defaultModel = updates.defaultModel;
        if (updates.defaultProvider !== undefined) config.defaultProvider = updates.defaultProvider;
        if (updates.onboardingComplete !== undefined) config.onboardingComplete = updates.onboardingComplete;
        if (updates.systemPrompt !== undefined) config.systemPrompt = updates.systemPrompt;
        if (updates.routingStrategy !== undefined) config.routingStrategy = updates.routingStrategy;
        if (updates.personalContext !== undefined) config.personalContext = updates.personalContext;
        if (updates.memoryEnabled !== undefined) config.memoryEnabled = updates.memoryEnabled;
        if (updates.shimmerEnabled !== undefined) config.shimmerEnabled = updates.shimmerEnabled;

        saveConfig(config);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/settings/background — upload a custom background image
router.post('/background', (req, res) => {
    try {
        const body = req.body;

        if (body.url) {
            // URL-based background
            const config = getConfig();
            if (!config.appearance) config.appearance = {};
            config.appearance.backgroundImage = body.url;
            saveConfig(config);
            return res.json({ success: true, url: body.url });
        }

        if (body.clear) {
            // Clear background
            const config = getConfig();
            if (config.appearance) delete config.appearance.backgroundImage;
            saveConfig(config);
            return res.json({ success: true, url: null });
        }

        if (body.data && body.filename) {
            // Base64 upload
            const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
            const uploadsDir = path.join(DATA_DIR, 'uploads');
            if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

            const ext = path.extname(body.filename) || '.jpg';
            const safeName = 'bg-' + Date.now() + ext;
            const filePath = path.join(uploadsDir, safeName);
            const base64Data = body.data.replace(/^data:[a-zA-Z0-9\/+-]+;base64,/, '');
            fs.writeFileSync(filePath, base64Data, 'base64');

            const url = `/uploads/${safeName}`;
            const config = getConfig();
            if (!config.appearance) config.appearance = {};
            config.appearance.backgroundImage = url;
            saveConfig(config);
            return res.json({ success: true, url });
        }

        return res.status(400).json({ error: 'Invalid payload — provide data+filename, url, or clear' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/settings/hardware — get system hardware info
router.get('/hardware', async (req, res) => {
    try {
        const info = await getHardwareInfo();
        res.json(info);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/settings/pricing — get pricing table
router.get('/pricing', (req, res) => {
    res.json(PRICING);
});

// GET /api/settings/templates — get pre-built AI persona templates
router.get('/templates', (req, res) => {
    try {
        const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
        let templatesPath = path.join(DATA_DIR, 'templates.json');

        // Fallback for Electron: If templates not in DATA_DIR (APPDATA), check bundled data
        if (!fs.existsSync(templatesPath)) {
            templatesPath = path.join(__dirname, '..', 'data', 'templates.json');
        }

        if (fs.existsSync(templatesPath)) {
            const templates = JSON.parse(fs.readFileSync(templatesPath, 'utf-8'));
            res.json(templates);
        } else {
            res.json([]);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

