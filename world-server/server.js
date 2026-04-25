// MC Businesses — Live world server
// One Node.js process. Two jobs:
//   1) Joins your real MC server as a Mineflayer bot. Watches chunks + block changes + chat.
//   2) Runs a WebSocket server on :8080 for the browser game (play.html). Streams everything live.
//
// Run:   npm install && npm start
// Then open play.html in your browser. Done.

import mineflayer from 'mineflayer';
import { Vec3 } from 'vec3';
import { WebSocketServer } from 'ws';

// ----- CONFIG (edit me) -----
const HOST = '51.161.199.30';
const PORT = 26410;
const VERSION = '1.21.11';
const BOT_USERNAME = 'WorldSync';   // bot's name on the MC server
const WS_PORT = 8080;               // browser connects here
const Y_MIN = 50;                   // capture this vertical range only (saves bandwidth)
const Y_MAX = 180;
const CHUNK_RADIUS = 4;             // 4 = 9x9 chunk area = "8 chunks loaded"
// ----------------------------

console.log(`[boot] Mineflayer connecting to ${HOST}:${PORT} as ${BOT_USERNAME} (v${VERSION})...`);

const bot = mineflayer.createBot({
    host: HOST, port: PORT, username: BOT_USERNAME,
    version: VERSION, auth: 'offline'
});

// ===== State =====
const sentChunks = new Set();           // 'cx,cz' keys we've already broadcast
const clients = new Set();              // connected browser sockets
const wsBrowserPlayers = new Map();     // ws -> { name, x, y, z, yaw, pitch, lastSeen }

// ===== WebSocket server =====
const wss = new WebSocketServer({ port: WS_PORT });
console.log(`[ws] Listening on :${WS_PORT}`);

wss.on('connection', (ws) => {
    console.log(`[ws] Browser connected (${clients.size + 1} total)`);
    clients.add(ws);
    wsBrowserPlayers.set(ws, { name: '?', x: 0, y: 80, z: 0, yaw: 0, pitch: 0, lastSeen: Date.now() });

    ws.on('close', () => {
        clients.delete(ws);
        const p = wsBrowserPlayers.get(ws);
        wsBrowserPlayers.delete(ws);
        if (p && p.id) broadcast({ type: 'player_leave', id: p.id }, ws);
        console.log(`[ws] Browser disconnected (${clients.size} remaining)`);
    });

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        handleClientMessage(ws, msg);
    });

    // On connect: blast everything we have so the new browser can render
    ws.send(JSON.stringify({ type: 'hello', bot: { x: bot.entity?.position?.x ?? 0, y: bot.entity?.position?.y ?? 80, z: bot.entity?.position?.z ?? 0 } }));
    if (bot.entity) sendAllLoadedChunks(ws);
});

function broadcast(msg, except = null) {
    const s = JSON.stringify(msg);
    for (const c of clients) {
        if (c === except) continue;
        if (c.readyState === c.OPEN) c.send(s);
    }
}

function handleClientMessage(ws, msg) {
    const player = wsBrowserPlayers.get(ws);
    switch (msg.type) {
        case 'identify':
            player.name = (msg.name || 'guest').slice(0, 16);
            player.id = msg.id || ('p_' + Math.random().toString(36).slice(2, 9));
            console.log(`[ws] ${player.name} (${player.id}) identified`);
            break;
        case 'move':
            player.x = msg.x; player.y = msg.y; player.z = msg.z;
            player.yaw = msg.yaw; player.pitch = msg.pitch;
            player.lastSeen = Date.now();
            broadcast({ type: 'player_move', id: player.id, name: player.name,
                        x: msg.x, y: msg.y, z: msg.z, yaw: msg.yaw, pitch: msg.pitch }, ws);
            break;
        case 'block_change':
            // Browser placed/broke a block — relay to other browsers AND to the real server
            broadcast({ type: 'block_change', x: msg.x, y: msg.y, z: msg.z, blockId: msg.blockId }, ws);
            // Tell the real MC server (so it persists) — only if bot is op + has placeable item
            // For now just update our cached view; full server-write needs RCON or an op bot.
            if (bot.world && bot._wsBlockNames) {
                const name = bot._wsBlockNames[msg.blockId] || 'air';
                console.log(`[real-server] would set ${msg.x},${msg.y},${msg.z} → ${name} (need RCON)`);
            }
            break;
        case 'chat':
            const safe = String(msg.text || '').slice(0, 200);
            broadcast({ type: 'chat', name: player.name, text: safe }, null);
            // Also send to real MC server
            try { bot.chat(`<${player.name}> ${safe}`); } catch {}
            break;
    }
}

// ===== Mineflayer side =====
bot.once('spawn', () => {
    console.log(`[bot] Spawned at ${bot.entity.position.floored()}.`);
    // Build a quick id→name palette so the browser can render colors
    bot._wsBlockNames = {};
    if (bot.registry && bot.registry.blocks) {
        for (const id of Object.keys(bot.registry.blocks)) {
            bot._wsBlockNames[id] = bot.registry.blocks[id].name;
        }
    }
    broadcast({ type: 'palette', palette: bot._wsBlockNames });
    // Initial chunk sweep every 2s for the first 30s, then on-demand
    let n = 0;
    const sweep = setInterval(() => { sweepChunks(); if (++n > 15) clearInterval(sweep); }, 2000);
});

bot.on('chunkColumnLoad', (pos) => {
    setTimeout(() => sendChunk(pos.x >> 4, pos.z >> 4), 200);
});

bot.on('blockUpdate', (oldB, newB) => {
    if (!newB) return;
    if (newB.position.y < Y_MIN || newB.position.y >= Y_MAX) return;
    broadcast({
        type: 'block_change',
        x: newB.position.x, y: newB.position.y, z: newB.position.z,
        blockId: newB.type, name: newB.name
    });
});

bot.on('chat', (username, message) => {
    if (username === BOT_USERNAME) return;
    broadcast({ type: 'chat', name: username, text: message });
});

bot.on('error', e => console.error('[bot error]', e.message));
bot.on('kicked', r => console.error('[bot kicked]', r));
bot.on('end', r => console.error('[bot end]', r));

function sweepChunks() {
    if (!bot.entity) return;
    const cx0 = Math.floor(bot.entity.position.x / 16);
    const cz0 = Math.floor(bot.entity.position.z / 16);
    for (let dz = -CHUNK_RADIUS; dz <= CHUNK_RADIUS; dz++) {
        for (let dx = -CHUNK_RADIUS; dx <= CHUNK_RADIUS; dx++) {
            sendChunk(cx0 + dx, cz0 + dz);
        }
    }
}

function sendChunk(cx, cz) {
    const key = `${cx},${cz}`;
    if (sentChunks.has(key)) return;
    if (!bot.world) return;

    // Build chunk: 16x16x(Y_MAX-Y_MIN) array of block ids
    const w = 16, h = Y_MAX - Y_MIN;
    const data = new Uint16Array(w * w * h);
    let any = false;
    for (let y = Y_MIN; y < Y_MAX; y++) {
        for (let z = 0; z < 16; z++) {
            for (let x = 0; x < 16; x++) {
                const wx = cx * 16 + x, wz = cz * 16 + z;
                const block = bot.world.getBlock(new Vec3(wx, y, wz));
                if (!block) continue;
                if (block.type === 0) continue; // air
                data[((y - Y_MIN) * w + z) * w + x] = block.type;
                any = true;
            }
        }
    }
    if (!any) return;
    sentChunks.add(key);
    // base64-encode the Uint16 buffer for transport
    const b64 = Buffer.from(data.buffer).toString('base64');
    const msg = JSON.stringify({
        type: 'chunk', cx, cz, yMin: Y_MIN, yMax: Y_MAX, w: 16, data: b64
    });
    for (const c of clients) if (c.readyState === c.OPEN) c.send(msg);
    console.log(`[chunk] sent ${cx},${cz} (${data.byteLength} bytes raw)`);
}

function sendAllLoadedChunks(ws) {
    // Re-send everything we've already broadcast, so a new client catches up
    if (!bot.world || !bot.entity) return;
    const cx0 = Math.floor(bot.entity.position.x / 16);
    const cz0 = Math.floor(bot.entity.position.z / 16);
    for (const key of sentChunks) {
        const [cx, cz] = key.split(',').map(Number);
        // Re-emit by clearing + resending (cheap enough at 9 chunks)
        sentChunks.delete(key);
        sendChunk(cx, cz);
    }
}
