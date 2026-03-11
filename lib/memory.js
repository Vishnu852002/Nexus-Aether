const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const MEMORY_PATH = path.join(DATA_DIR, 'memory.json');

function loadMemories() {
    try {
        if (fs.existsSync(MEMORY_PATH)) {
            return JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf8'));
        }
    } catch (e) { console.error('Memory load error:', e.message); }
    return [];
}

function saveMemories(memories) {
    const dir = path.dirname(MEMORY_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(MEMORY_PATH, JSON.stringify(memories, null, 2));
}

function getMemories() {
    return loadMemories();
}

function addMemory(entry) {
    const memories = loadMemories();
    const mem = {
        id: crypto.randomBytes(8).toString('hex'),
        content: entry.content,
        category: entry.category || 'fact',
        tags: entry.tags || [],
        source: entry.source || 'auto',
        createdAt: new Date().toISOString()
    };
    // Deduplicate — skip if very similar content exists
    const isDupe = memories.some(m =>
        m.content.toLowerCase().trim() === mem.content.toLowerCase().trim()
    );
    if (isDupe) return null;

    memories.push(mem);
    saveMemories(memories);
    return mem;
}

function deleteMemory(id) {
    let memories = loadMemories();
    memories = memories.filter(m => m.id !== id);
    saveMemories(memories);
}

function clearMemories() {
    saveMemories([]);
}

/**
 * Build a graph for D3 visualization.
 * Nodes = memories. Edges = shared tags connect nodes.
 */
function getGraph() {
    const memories = loadMemories();

    const nodes = memories.map(m => ({
        id: m.id,
        label: m.content.length > 60 ? m.content.slice(0, 57) + '...' : m.content,
        content: m.content,
        category: m.category,
        tags: m.tags,
        source: m.source,
        createdAt: m.createdAt
    }));

    // Build tag → nodeIds index
    const tagIndex = {};
    memories.forEach(m => {
        (m.tags || []).forEach(tag => {
            if (!tagIndex[tag]) tagIndex[tag] = [];
            tagIndex[tag].push(m.id);
        });
    });

    // Create edges between nodes sharing tags
    const edgeSet = new Set();
    const edges = [];
    for (const [tag, nodeIds] of Object.entries(tagIndex)) {
        for (let i = 0; i < nodeIds.length; i++) {
            for (let j = i + 1; j < nodeIds.length; j++) {
                const key = [nodeIds[i], nodeIds[j]].sort().join('-');
                if (!edgeSet.has(key)) {
                    edgeSet.add(key);
                    edges.push({ source: nodeIds[i], target: nodeIds[j], tag });
                }
            }
        }
    }

    return { nodes, edges };
}

module.exports = { getMemories, addMemory, deleteMemory, clearMemories, getGraph };
