const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const os = require('os');

// ═══ SECURITY: Only allow access to these root directories ═══
const HOME = os.homedir();
const ALLOWED_ROOTS = [
    path.join(HOME, 'Desktop'),
    path.join(HOME, 'Documents'),
    path.join(HOME, 'Downloads'),
    path.join(HOME, 'Pictures'),
    path.join(HOME, 'Videos'),
    path.join(HOME, 'Music'),
];

// Image/media extensions for gallery mode
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.ico', '.avif']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.avi', '.mkv']);
const MEDIA_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS]);

/**
 * Validate that a path is within allowed directories.
 * Prevents directory traversal attacks.
 */
function isPathAllowed(requestedPath) {
    const resolved = path.resolve(requestedPath);
    return ALLOWED_ROOTS.some(root => {
        const resolvedRoot = path.resolve(root);
        return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
    });
}

/**
 * Get file info without sensitive data
 */
function getFileInfo(filePath, stat) {
    const ext = path.extname(filePath).toLowerCase();
    return {
        name: path.basename(filePath),
        path: filePath,
        isDirectory: stat.isDirectory(),
        size: stat.isFile() ? stat.size : null,
        modified: stat.mtime.toISOString(),
        ext: ext || null,
        isImage: IMAGE_EXTS.has(ext),
        isVideo: VIDEO_EXTS.has(ext),
        isMedia: MEDIA_EXTS.has(ext),
    };
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

// GET /api/files/roots — list allowed root directories
router.get('/roots', (req, res) => {
    const roots = ALLOWED_ROOTS
        .filter(r => fs.existsSync(r))
        .map(r => ({
            name: path.basename(r),
            path: r,
            icon: {
                'Desktop': '🖥️',
                'Documents': '📄',
                'Downloads': '📥',
                'Pictures': '🖼️',
                'Videos': '🎬',
                'Music': '🎵',
            }[path.basename(r)] || '📁'
        }));
    res.json(roots);
});

// GET /api/files/browse?path=... — list directory contents
router.get('/browse', (req, res) => {
    const dirPath = req.query.path;
    if (!dirPath) return res.status(400).json({ error: 'Missing path parameter' });

    if (!isPathAllowed(dirPath)) {
        return res.status(403).json({ error: 'Access denied: path outside allowed directories' });
    }

    const resolved = path.resolve(dirPath);

    try {
        const stat = fs.statSync(resolved);
        if (!stat.isDirectory()) {
            return res.status(400).json({ error: 'Not a directory' });
        }

        const entries = fs.readdirSync(resolved);
        const items = [];

        for (const name of entries) {
            // Skip hidden files and system files
            if (name.startsWith('.') || name.startsWith('$')) continue;
            if (['Thumbs.db', 'desktop.ini', '.DS_Store'].includes(name)) continue;

            try {
                const fullPath = path.join(resolved, name);
                const entryStat = fs.statSync(fullPath);
                const info = getFileInfo(fullPath, entryStat);
                info.sizeFormatted = info.size !== null ? formatSize(info.size) : null;
                items.push(info);
            } catch {
                // Skip files we can't access
            }
        }

        // Sort: directories first, then by name
        items.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });

        // Build breadcrumb path
        const parts = [];
        let current = resolved;
        while (current !== path.dirname(current)) {
            if (ALLOWED_ROOTS.some(r => path.resolve(r) === current)) {
                parts.unshift({ name: path.basename(current), path: current });
                break;
            }
            parts.unshift({ name: path.basename(current), path: current });
            current = path.dirname(current);
        }

        res.json({
            path: resolved,
            parent: path.dirname(resolved),
            parentAllowed: isPathAllowed(path.dirname(resolved)),
            breadcrumbs: parts,
            items,
            mediaCount: items.filter(i => i.isMedia).length,
            totalItems: items.length,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/files/download?path=... — download a file
router.get('/download', (req, res) => {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'Missing path parameter' });

    if (!isPathAllowed(filePath)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    const resolved = path.resolve(filePath);

    try {
        const stat = fs.statSync(resolved);
        if (!stat.isFile()) {
            return res.status(400).json({ error: 'Not a file' });
        }

        res.download(resolved, path.basename(resolved));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/files/serve?path=... — serve an image file inline in the browser (no forced download)
// Has wider access than /download: any file under the user home directory is allowed
router.get('/serve', (req, res) => {
    let filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'Missing path parameter' });

    // Decode URI-encoded path (handles double-encoding from filesearch)
    try { filePath = decodeURIComponent(filePath); } catch (e) { }

    const resolved = path.resolve(filePath);

    // Security: block obvious traversal, but allow any local absolute path
    if (resolved.includes('..') || !path.isAbsolute(resolved)) {
        return res.status(403).json({ error: 'Access denied: invalid path' });
    }

    const ext = path.extname(resolved).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) {
        return res.status(400).json({ error: 'Not an image file' });
    }

    const mimeTypes = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
        '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.avif': 'image/avif',
    };
    const mime = mimeTypes[ext] || 'image/jpeg';

    try {
        const stat = fs.statSync(resolved);
        if (!stat.isFile()) return res.status(400).json({ error: 'Not a file' });

        res.setHeader('Content-Type', mime);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Content-Disposition', 'inline');

        const stream = fs.createReadStream(resolved);
        stream.pipe(res);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/files/thumb?path=... — serve image thumbnail/preview
router.get('/thumb', (req, res) => {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'Missing path' });

    if (!isPathAllowed(filePath)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    const resolved = path.resolve(filePath);
    const ext = path.extname(resolved).toLowerCase();

    if (!IMAGE_EXTS.has(ext) && !VIDEO_EXTS.has(ext)) {
        return res.status(400).json({ error: 'Not a media file' });
    }

    try {
        // Serve the file directly (browser handles resize via CSS)
        const mimeTypes = {
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
            '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
            '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.avif': 'image/avif',
            '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
        };
        const mime = mimeTypes[ext] || 'application/octet-stream';

        // Set cache headers for thumbnails
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Content-Type', mime);

        const stream = fs.createReadStream(resolved);
        stream.pipe(res);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
