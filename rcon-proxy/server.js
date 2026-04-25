// MC Businesses — RCON proxy
// Tiny HTTPS-to-RCON bridge. Browsers can't speak TCP/RCON, so this sits in the middle.
//
// Endpoints:
//   GET  /health                 → { ok: true }
//   GET  /online                 → { players: ["Doggily147", ...] }   (uses /list)
//   POST /give                   → { buyer, item, qty } body, runs /give
//   POST /say                    → { message } body, broadcasts on server
//   POST /command                → { command } body, ADMIN ONLY (api key required)
//
// All write endpoints require header:  X-API-Key: <PROXY_API_KEY>
// (This is what the website sends; rotate it whenever, separate from the RCON password.)

import express from 'express';
import cors from 'cors';
import { Rcon } from 'rcon-client';
import 'dotenv/config';

const {
    RCON_HOST = '51.161.199.30',
    RCON_PORT = '26172',                 // try 26124 if 26172 doesn't work
    RCON_PASSWORD,                       // SET THIS via env var, NEVER hardcode
    PROXY_API_KEY,                       // SET THIS via env var
    PORT = '8080',
    ALLOWED_ORIGINS = '*'                // comma-separated origins, or *
} = process.env;

if (!RCON_PASSWORD) { console.error('FATAL: RCON_PASSWORD env var not set'); process.exit(1); }
if (!PROXY_API_KEY) { console.error('FATAL: PROXY_API_KEY env var not set'); process.exit(1); }

const app = express();
app.use(express.json({ limit: '8kb' }));
app.use(cors({
    origin: ALLOWED_ORIGINS === '*' ? true : ALLOWED_ORIGINS.split(',').map(s => s.trim())
}));

// ----- RCON connection (lazy + reused) -----
let rcon = null;
let connectPromise = null;

async function getRcon() {
    if (rcon && rcon.authenticated) return rcon;
    if (connectPromise) return connectPromise;
    connectPromise = (async () => {
        const c = new Rcon({
            host: RCON_HOST,
            port: parseInt(RCON_PORT, 10),
            password: RCON_PASSWORD,
            timeout: 5000
        });
        c.on('end', () => { rcon = null; });
        c.on('error', e => { console.error('[rcon error]', e.message); rcon = null; });
        await c.connect();
        rcon = c;
        connectPromise = null;
        return c;
    })().catch(e => { connectPromise = null; throw e; });
    return connectPromise;
}

async function send(cmd) {
    const c = await getRcon();
    return await c.send(cmd);
}

// ----- Auth middleware for write endpoints -----
function requireKey(req, res, next) {
    if (req.header('X-API-Key') !== PROXY_API_KEY) {
        return res.status(401).json({ error: 'invalid api key' });
    }
    next();
}

// ----- Sanitization -----
// Block command-injection by disallowing newlines + RCON metacharacters.
// Item/player names should be alphanumeric + _ + : (for namespaced item ids).
const NAME_RE = /^[A-Za-z0-9_]{1,16}$/;
const ITEM_RE = /^[A-Za-z0-9_:]{1,64}$/;

// ----- Routes -----
app.get('/health', (req, res) => res.json({ ok: true, host: RCON_HOST, port: RCON_PORT }));

app.get('/online', async (req, res) => {
    try {
        const out = await send('list');
        // Vanilla format: "There are 3 of a max of 20 players online: A, B, C"
        const m = out.match(/players online:?\s*(.*)$/i);
        const players = m && m[1] ? m[1].split(',').map(s => s.trim()).filter(Boolean) : [];
        res.json({ raw: out, players });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/give', requireKey, async (req, res) => {
    const { buyer, item, qty } = req.body || {};
    if (!NAME_RE.test(buyer || '')) return res.status(400).json({ error: 'invalid buyer name' });
    if (!ITEM_RE.test(item || '')) return res.status(400).json({ error: 'invalid item id' });
    const n = parseInt(qty, 10);
    if (!Number.isFinite(n) || n < 1 || n > 6400) return res.status(400).json({ error: 'qty 1-6400' });
    try {
        const out = await send(`give ${buyer} ${item} ${n}`);
        res.json({ ok: true, raw: out });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/say', requireKey, async (req, res) => {
    const { message } = req.body || {};
    if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required' });
    const safe = message.replace(/[\r\n]/g, ' ').slice(0, 200);
    try {
        const out = await send(`say ${safe}`);
        res.json({ ok: true, raw: out });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Admin-only raw command. Use with care.
app.post('/command', requireKey, async (req, res) => {
    const { command } = req.body || {};
    if (!command || typeof command !== 'string') return res.status(400).json({ error: 'command required' });
    const safe = command.replace(/[\r\n]/g, ' ').slice(0, 200);
    try {
        const out = await send(safe);
        res.json({ ok: true, raw: out });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(parseInt(PORT, 10), () => {
    console.log(`RCON proxy listening on :${PORT}, target ${RCON_HOST}:${RCON_PORT}`);
});
