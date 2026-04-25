// Connects to your MC server as a bot, loads chunks, exports a 2D side slice as world.json.
// Run:  npm install && node capture.js
// Output: ../world.json (sibling of play.html so the browser can fetch it)

import mineflayer from 'mineflayer';
import { Vec3 } from 'vec3';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ----- CONFIG (edit me) -----
const HOST = '51.161.199.30';
const PORT = 26410;
const VERSION = '1.21.11';         // your actual MC version
const USERNAME = 'bubbu';
const CHUNK_RADIUS = 4;            // 4 = 8 chunks across × 8 chunks tall area
const SETTLE_MS = 15_000;          // how long to wait for chunks to load before exporting
const Y_MIN = 50;                  // vertical slice bounds (1.21 world is -64..320)
const Y_MAX = 180;
// ----------------------------

console.log(`Connecting to ${HOST}:${PORT} as ${USERNAME} (v${VERSION})...`);

const bot = mineflayer.createBot({
    host: HOST,
    port: PORT,
    username: USERNAME,
    version: VERSION,
    auth: 'offline'
});

bot.once('spawn', () => {
    console.log(`Spawned at ${bot.entity.position.floored()}. Waiting ${SETTLE_MS / 1000}s for chunks to load...`);
    setTimeout(exportWorld, SETTLE_MS);
});

bot.on('error', err => console.error('[bot error]', err));
bot.on('kicked', reason => console.error('[kicked]', reason));
bot.on('end', reason => console.log('[disconnected]', reason));

function exportWorld() {
    const px = Math.floor(bot.entity.position.x);
    const py = Math.floor(bot.entity.position.y);
    const pz = Math.floor(bot.entity.position.z);
    console.log(`Capturing ${CHUNK_RADIUS * 16 * 2}×${Y_MAX - Y_MIN} slice at z=${pz} centered on (${px}, ${pz})...`);

    const blocks = [];           // [y][x] grid
    const palette = {};          // name → id
    const paletteById = {};      // id → name+color
    let nextId = 1;
    palette['air'] = 0;
    paletteById[0] = { name: 'air', color: null };

    // Pick colors heuristically based on block name
    function colorFor(name) {
        const n = name.toLowerCase();
        if (n.includes('grass_block')) return '#5cb04a';
        if (n.includes('dirt')) return '#7a4a2b';
        if (n.includes('stone')) return '#888888';
        if (n.includes('cobblestone')) return '#7d7d7d';
        if (n.includes('log') || n.includes('wood') || n === 'planks') return '#7a5230';
        if (n.includes('leaves')) return '#3d8a3a';
        if (n.includes('sand')) return '#e6d28a';
        if (n.includes('water')) return 'rgba(64,128,255,0.6)';
        if (n.includes('lava')) return '#ff7a1a';
        if (n.includes('iron_ore')) return '#c8b59a';
        if (n.includes('gold_ore')) return '#e8c95a';
        if (n.includes('diamond_ore')) return '#7ee2e2';
        if (n.includes('coal_ore')) return '#1a1a1a';
        if (n.includes('netherrack')) return '#7a2828';
        if (n.includes('snow')) return '#f0f6ff';
        if (n.includes('ice')) return '#9fd8ff';
        if (n.includes('glass')) return 'rgba(220,240,255,0.4)';
        if (n.includes('wool')) return '#dddddd';
        if (n.includes('bedrock')) return '#222';
        return '#aa66cc';        // fallback magenta-ish for "unknown"
    }

    const xMin = px - CHUNK_RADIUS * 16;
    const xMax = px + CHUNK_RADIUS * 16;

    for (let y = Y_MAX - 1; y >= Y_MIN; y--) {
        const row = [];
        for (let x = xMin; x < xMax; x++) {
            const block = bot.blockAt(new Vec3(x, y, pz));
            if (!block) { row.push(0); continue; }
            const name = block.name;
            if (name === 'air' || name === 'cave_air' || name === 'void_air') { row.push(0); continue; }
            if (palette[name] == null) {
                palette[name] = nextId;
                paletteById[nextId] = { name, color: colorFor(name) };
                nextId++;
            }
            row.push(palette[name]);
        }
        blocks.push(row);
    }

    const out = {
        capturedAt: new Date().toISOString(),
        server: `${HOST}:${PORT}`,
        version: VERSION,
        spawn: { x: px, y: py, z: pz },
        bounds: { xMin, xMax, yMin: Y_MIN, yMax: Y_MAX, z: pz },
        width: xMax - xMin,
        height: Y_MAX - Y_MIN,
        palette: paletteById,
        blocks            // blocks[0] is the TOP row (y = Y_MAX-1)
    };

    const outPath = resolve(__dirname, '..', 'world.json');
    writeFileSync(outPath, JSON.stringify(out));
    console.log(`✓ Wrote ${outPath} (${out.width}×${out.height} blocks, palette of ${nextId})`);
    bot.quit();
    process.exit(0);
}
