const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const ALLOW_LAN = ['1', 'true', 'yes', 'on'].includes(String(process.env.ALLOW_LAN || '').toLowerCase());
const LISTEN_HOST = ALLOW_LAN ? '0.0.0.0' : '127.0.0.1';
const LOCAL_ONLY_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
function normalizeHostname(hostname = '') {
    return hostname.toLowerCase().replace(/\.$/, '');
}
function isLocalOnlyHost(hostname = '') {
    const normalized = normalizeHostname(hostname);
    return LOCAL_ONLY_HOSTS.has(normalized);
}
function isStateChangingMethod(method = 'GET') {
    return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}
function isSameOriginRequest(req) {
    const origin = req.get('origin');
    if (!origin) {
        return !ALLOW_LAN;
    }
    try {
        const parsedOrigin = new URL(origin);
        const reqHost = normalizeHostname(req.hostname || '');
        const reqPort = String(req.app.get('port'));
        const originHost = normalizeHostname(parsedOrigin.hostname);
        const originPort = parsedOrigin.port || (parsedOrigin.protocol === 'https:' ? '443' : '80');
        return originHost === reqHost && originPort === reqPort;
    } catch (err) {
        return false;
    }
}
function cspValue() {
    const directives = [
        "default-src 'self'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "form-action 'self'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
        "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
        "connect-src 'self'",
        "frame-src 'self' blob:",
        "worker-src 'self' blob:"
    ];
    return directives.join('; ');
}
app.set('port', PORT);
app.disable('x-powered-by');

// Ensure data directories exist
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CONV_DIR = path.join(DATA_DIR, 'conversations');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CONV_DIR)) fs.mkdirSync(CONV_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Initialize config if needed
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({
        providers: {
            openai: { apiKey: '', enabled: false },
            anthropic: { apiKey: '', enabled: false },
            gemini: { apiKey: '', enabled: false },
            openrouter: { apiKey: '', enabled: false },
            ollama: { baseUrl: 'http://localhost:11434', enabled: true },
            lmstudio: { baseUrl: 'http://localhost:1234', enabled: true }
        },
        appearance: {
            theme: 'purple-night',
            userBubbleColor: '#7C5CFC',
            customBackground: null
        },
        defaultModel: null,
        defaultProvider: null,
        routingStrategy: 'auto',
        onboardingComplete: false
    }, null, 2));
}

// ═══ Register Tools ═══
const toolRunner = require('./lib/toolRunner');

// Load all tools from /tools directory
const TOOLS_DIR = path.join(__dirname, 'tools');
if (fs.existsSync(TOOLS_DIR)) {
    for (const file of fs.readdirSync(TOOLS_DIR)) {
        if (!file.endsWith('.js')) continue;
        try {
            const toolDef = require(path.join(TOOLS_DIR, file));
            const name = path.basename(file, '.js');
            toolRunner.register(name, toolDef);
            console.log(`  🔧 Tool registered: ${name}`);
        } catch (err) {
            console.error(`  ⚠️ Failed to load tool ${file}:`, err.message);
        }
    }
}

// Security middleware
app.use((req, res, next) => {
    // In secure default mode, reject non-local Host headers (DNS rebinding protection).
    if (!ALLOW_LAN && !isLocalOnlyHost(req.hostname || '')) {
        return res.status(403).json({ error: 'Forbidden host' });
    }

    // Block cross-site state-changing API requests.
    if (req.path.startsWith('/api/') && isStateChangingMethod(req.method) && !isSameOriginRequest(req)) {
        return res.status(403).json({ error: 'Cross-site request blocked' });
    }

    res.setHeader('Content-Security-Policy', cspValue());
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    next();
});

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// ─── CRITICAL: Raw File Upload for Document Studio must bypass global JSON parser ───
// We mount this specific route directly here so it doesn't get swallowed by express.json
const { router: docRouter, uploadDocument } = require('./routes/documents');
app.post('/api/documents/upload', express.raw({ type: '*/*', limit: '100mb' }), uploadDocument);

app.use(express.json({ limit: '50mb' }));

// API Routes
app.use('/api/chat', require('./routes/chat'));
app.use('/api/conversations', require('./routes/conversations'));
app.use('/api/models', require('./routes/models'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/tools', require('./routes/tools'));
app.use('/api/files', require('./routes/files'));
app.use('/api/memory', require('./routes/memory'));
app.use('/api/documents', docRouter);
app.use('/api/scheduler', require('./routes/scheduler'));

// Start the background scheduler engine
const scheduler = require('./lib/scheduler');
scheduler.startAll();

// Network info API (for QR code dialog)
app.get('/api/network', (req, res) => {
    const localIP = getLocalIP();
    const networkUrl = ALLOW_LAN && localIP !== 'localhost' ? `http://${localIP}:${PORT}` : null;
    res.json({
        localUrl: `http://localhost:${PORT}`,
        networkUrl,
        networkEnabled: ALLOW_LAN,
        ip: localIP,
        port: PORT,
        hostname: os.hostname()
    });
});

// SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get local network IP
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

app.listen(PORT, LISTEN_HOST, () => {
    const localIP = getLocalIP();
    const networkUrl = ALLOW_LAN && localIP !== 'localhost' ? `http://${localIP}:${PORT}` : null;

    console.log('');
    console.log('Nexus-Aether server started');
    console.log(`Local: http://localhost:${PORT}`);

    if (networkUrl) {
        console.log(`Network: ${networkUrl}`);
        console.log('Scan QR code to open on your phone:');
        try {
            const qrcode = require('qrcode-terminal');
            qrcode.generate(networkUrl, { small: true }, (qr) => {
                console.log(qr);
                console.log(`Open ${networkUrl} on your phone`);
                console.log('');
            });
        } catch (e) {
            console.log(`Open ${networkUrl} on your phone`);
            console.log('');
        }
    } else {
        console.log('Network: disabled (set ALLOW_LAN=true to enable LAN access)');
        console.log('');
    }
});
