// MC Businesses — 3D voxel client. Connects to world-server via WebSocket.
// Render: Three.js + per-chunk meshing (only emit faces between solid + non-solid neighbors).
// Physics: AABB collision against the voxel grid.
// Live-sync: receives chunks + block updates from world-server; broadcasts your moves + builds.

import * as THREE from 'three';

// ===== Config =====
const WS_URL   = 'ws://localhost:8080';
const CHUNK_W  = 16;
const SAVE_MS  = 5000;
const PLAYER_W = 0.6, PLAYER_H = 1.8;
const GRAVITY  = 28, JUMP_VEL = 9, MOVE_SPEED = 5.6, SPRINT_MULT = 1.4;

// ===== Block palette (id → { name, color, solid }) =====
// Bot sends MC's block id→name palette on connect. Colors derived from name.
let BLOCKS = { 0: { name: 'air', color: null, solid: false } };
let HOTBAR = [1, 4, 5, 13, 9, 12, 46]; // safe defaults; replaced with real ids when palette arrives
let currentSlot = 0;

function colorFor(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('grass_block')) return 0x5cb04a;
    if (n.includes('dirt') || n.includes('podzol') || n.includes('mycelium')) return 0x7a4a2b;
    if (n.includes('cobblestone')) return 0x7d7d7d;
    if (n.includes('stone') || n.includes('andesite') || n.includes('diorite') || n.includes('granite')) return 0x888888;
    if (n.includes('deepslate')) return 0x404048;
    if (n.includes('sand')) return 0xe6d28a;
    if (n.includes('gravel')) return 0xa0a0a0;
    if (n.includes('log') || n.includes('wood')) return 0x7a5230;
    if (n.includes('planks')) return 0xb18a52;
    if (n.includes('leaves')) return 0x3d8a3a;
    if (n.includes('water')) return 0x4080ff;
    if (n.includes('lava')) return 0xff7a1a;
    if (n.includes('iron_ore')) return 0xc8b59a;
    if (n.includes('gold_ore')) return 0xe8c95a;
    if (n.includes('diamond_ore')) return 0x7ee2e2;
    if (n.includes('coal_ore')) return 0x1a1a1a;
    if (n.includes('redstone_ore')) return 0xc23030;
    if (n.includes('netherrack')) return 0x7a2828;
    if (n.includes('snow')) return 0xf0f6ff;
    if (n.includes('ice')) return 0x9fd8ff;
    if (n.includes('glass')) return 0xddeeff;
    if (n.includes('wool')) return 0xdddddd;
    if (n.includes('bedrock')) return 0x222222;
    if (n.includes('tnt')) return 0xd83a3a;
    if (n.includes('flower') || n.includes('rose') || n.includes('dandelion')) return 0xff5577;
    if (n.includes('grass') || n.includes('fern')) return 0x5cb04a;
    if (n) return 0xaa66cc;
    return 0;
}

const NON_SOLID_NAMES = /air|water|lava|grass$|fern|flower|sapling|torch|rail|sign|door|carpet|button|pressure|tall_grass|seagrass|kelp|vine/;

// ===== Three.js scene =====
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(window.devicePixelRatio);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 30, 200);

const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 500);
camera.position.set(0, 100, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(50, 100, 30);
scene.add(sun);

function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ===== Chunk storage + meshing =====
// chunks: Map<"cx,cz", { yMin, yMax, w, data: Uint16Array, mesh: THREE.Mesh|null }>
const chunks = new Map();
const CHUNK_KEY = (cx, cz) => `${cx},${cz}`;

function isSolidId(id) {
    if (id === 0) return false;
    const def = BLOCKS[id];
    if (!def) return true;        // unknown → assume solid
    return def.solid !== false;
}

function getBlockId(wx, wy, wz) {
    const cx = Math.floor(wx / 16), cz = Math.floor(wz / 16);
    const c = chunks.get(CHUNK_KEY(cx, cz));
    if (!c) return 0;
    if (wy < c.yMin || wy >= c.yMax) return 0;
    const lx = ((wx % 16) + 16) % 16;
    const lz = ((wz % 16) + 16) % 16;
    const ly = wy - c.yMin;
    return c.data[(ly * 16 + lz) * 16 + lx];
}

function setBlockId(wx, wy, wz, id) {
    const cx = Math.floor(wx / 16), cz = Math.floor(wz / 16);
    const c = chunks.get(CHUNK_KEY(cx, cz));
    if (!c) return;
    if (wy < c.yMin || wy >= c.yMax) return;
    const lx = ((wx % 16) + 16) % 16;
    const lz = ((wz % 16) + 16) % 16;
    const ly = wy - c.yMin;
    c.data[(ly * 16 + lz) * 16 + lx] = id;
    c.dirty = true;
    // Also flag neighbor chunks if we touched the edge
    if (lx === 0)  markDirty(cx - 1, cz);
    if (lx === 15) markDirty(cx + 1, cz);
    if (lz === 0)  markDirty(cx, cz - 1);
    if (lz === 15) markDirty(cx, cz + 1);
}

function markDirty(cx, cz) {
    const c = chunks.get(CHUNK_KEY(cx, cz));
    if (c) c.dirty = true;
}

// Build a BufferGeometry by emitting only faces between solid + non-solid neighbors.
function buildChunkMesh(c) {
    const positions = [], normals = [], colors = [];
    const cx = c.cx, cz = c.cz;

    const FACES = [
        { n: [ 1,0,0], v: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]] }, // +X
        { n: [-1,0,0], v: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]] }, // -X
        { n: [0, 1,0], v: [[0,1,0],[0,1,1],[1,1,1],[1,1,0]] }, // +Y
        { n: [0,-1,0], v: [[1,0,0],[1,0,1],[0,0,1],[0,0,0]] }, // -Y
        { n: [0,0, 1], v: [[1,0,1],[1,1,1],[0,1,1],[0,0,1]] }, // +Z
        { n: [0,0,-1], v: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]] }, // -Z
    ];

    for (let ly = 0; ly < c.data.length / (16 * 16); ly++) {
        const wy = c.yMin + ly;
        for (let lz = 0; lz < 16; lz++) {
            for (let lx = 0; lx < 16; lx++) {
                const id = c.data[(ly * 16 + lz) * 16 + lx];
                if (!isSolidId(id)) continue;
                const def = BLOCKS[id];
                const colorHex = (def && def.color != null) ? def.color : 0xaa66cc;
                const r = ((colorHex >> 16) & 0xff) / 255;
                const g = ((colorHex >> 8) & 0xff) / 255;
                const b = (colorHex & 0xff) / 255;

                const wx = cx * 16 + lx, wz = cz * 16 + lz;
                for (const face of FACES) {
                    const nx = wx + face.n[0], ny = wy + face.n[1], nz = wz + face.n[2];
                    if (isSolidId(getBlockId(nx, ny, nz))) continue; // hidden
                    const baseIdx = positions.length / 3;
                    for (const v of face.v) {
                        positions.push(wx + v[0], wy + v[1], wz + v[2]);
                        normals.push(face.n[0], face.n[1], face.n[2]);
                        colors.push(r, g, b);
                    }
                    // 2 triangles: 0,1,2  0,2,3 — but we're using non-indexed. Repeat differently:
                    // The above pushed 4 verts; we need to emit them as 6 (two triangles).
                    // Fix: pop the 4 and emit 6 directly.
                    for (let i = 0; i < 12; i++) positions.pop();
                    for (let i = 0; i < 12; i++) normals.pop();
                    for (let i = 0; i < 12; i++) colors.pop();
                    const tris = [face.v[0], face.v[1], face.v[2], face.v[0], face.v[2], face.v[3]];
                    for (const v of tris) {
                        positions.push(wx + v[0], wy + v[1], wz + v[2]);
                        normals.push(face.n[0], face.n[1], face.n[2]);
                        colors.push(r, g, b);
                    }
                }
            }
        }
    }

    if (c.mesh) {
        scene.remove(c.mesh);
        c.mesh.geometry.dispose();
    }
    if (positions.length === 0) { c.mesh = null; c.dirty = false; return; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal',   new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('color',    new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    c.mesh = new THREE.Mesh(geo, mat);
    scene.add(c.mesh);
    c.dirty = false;
}

function rebuildDirty() {
    for (const c of chunks.values()) if (c.dirty) buildChunkMesh(c);
}

// ===== Networking =====
let ws = null;
let myId = 'p_' + Math.random().toString(36).slice(2, 9);
const otherPlayers = new Map(); // id -> { name, x,y,z,yaw, mesh }

function setStatus(msg) {
    const ln = document.getElementById('lockNotice');
    if (ln) {
        const last = ln.querySelector('.muted');
        if (last) last.textContent = msg;
    }
}

function connectWS() {
    setStatus(`Connecting to ${WS_URL} ...`);
    ws = new WebSocket(WS_URL);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
        setStatus('Connected ✓ Click to play');
        ws.send(JSON.stringify({ type: 'identify',
            name: document.getElementById('playUser').value || 'bubbu',
            id: myId }));
    };
    ws.onerror = () => setStatus('WebSocket error — is world-server running?');
    ws.onclose = () => { setStatus('Disconnected. Reconnecting in 3s...'); setTimeout(connectWS, 3000); };
    ws.onmessage = (e) => onWsMessage(JSON.parse(e.data));
}

function onWsMessage(m) {
    switch (m.type) {
        case 'hello':
            if (m.bot) camera.position.set(m.bot.x, m.bot.y + 2, m.bot.z);
            break;
        case 'palette':
            BLOCKS = { 0: { name: 'air', color: null, solid: false } };
            for (const id of Object.keys(m.palette)) {
                const name = m.palette[id];
                const solid = !NON_SOLID_NAMES.test(name);
                BLOCKS[+id] = { name, color: colorFor(name), solid };
            }
            // Pick hotbar items: grass_block, dirt, stone, oak_log, oak_planks, sand, glass
            const wanted = ['grass_block','dirt','stone','oak_log','oak_planks','sand','glass','tnt'];
            const found = [];
            for (const w of wanted) {
                const id = Object.keys(BLOCKS).find(k => BLOCKS[k].name === w);
                if (id) found.push(+id);
            }
            if (found.length) HOTBAR = found.slice(0, 7);
            renderHotbar();
            break;
        case 'chunk': {
            const data = new Uint16Array(b64ToArrayBuffer(m.data));
            const c = { cx: m.cx, cz: m.cz, yMin: m.yMin, yMax: m.yMax, data, dirty: true, mesh: null };
            chunks.set(CHUNK_KEY(m.cx, m.cz), c);
            // Mark neighbors dirty too so seam faces fix up
            markDirty(m.cx - 1, m.cz); markDirty(m.cx + 1, m.cz);
            markDirty(m.cx, m.cz - 1); markDirty(m.cx, m.cz + 1);
            document.getElementById('chunkCount').textContent = `🗺️ ${chunks.size} chunks`;
            break;
        }
        case 'block_change':
            setBlockId(m.x, m.y, m.z, m.blockId || 0);
            break;
        case 'chat':
            appendChat(m.name, m.text, false);
            break;
        case 'player_move': {
            if (m.id === myId) return;
            let p = otherPlayers.get(m.id);
            if (!p) {
                const geo = new THREE.BoxGeometry(PLAYER_W, PLAYER_H, PLAYER_W);
                const mat = new THREE.MeshLambertMaterial({ color: 0x3a6dff });
                const mesh = new THREE.Mesh(geo, mat);
                scene.add(mesh);
                p = { mesh };
                otherPlayers.set(m.id, p);
            }
            p.mesh.position.set(m.x, m.y, m.z);
            p.name = m.name;
            updatePlayerCount();
            break;
        }
        case 'player_leave': {
            const p = otherPlayers.get(m.id);
            if (p) { scene.remove(p.mesh); p.mesh.geometry.dispose(); otherPlayers.delete(m.id); }
            updatePlayerCount();
            break;
        }
    }
}

function b64ToArrayBuffer(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
}

function updatePlayerCount() {
    document.getElementById('playerCount').textContent = `👥 ${otherPlayers.size + 1}`;
}

// ===== Player + controls =====
const player = {
    x: 0, y: 100, z: 0,
    vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0,
    onGround: false
};

let mouseLocked = false;
const lockNotice = document.getElementById('lockNotice');
const crosshair = document.getElementById('crosshair');

canvas.addEventListener('click', () => {
    if (chatOpen) return;
    canvas.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
    mouseLocked = document.pointerLockElement === canvas;
    lockNotice.hidden = mouseLocked;
    crosshair.hidden = !mouseLocked;
});
document.addEventListener('mousemove', e => {
    if (!mouseLocked) return;
    player.yaw   -= e.movementX * 0.0025;
    player.pitch -= e.movementY * 0.0025;
    player.pitch = Math.max(-Math.PI/2 + 0.01, Math.min(Math.PI/2 - 0.01, player.pitch));
});

// Keyboard
const keys = {};
window.addEventListener('keydown', e => {
    if (chatOpen) return;
    keys[e.code] = true;
    if (e.code === 'KeyT') { e.preventDefault(); openChat(); }
    if (e.code === 'Escape') document.exitPointerLock();
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= HOTBAR.length) selectSlot(n - 1);
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

// Mouse buttons (break / place)
canvas.addEventListener('mousedown', e => {
    if (!mouseLocked) return;
    e.preventDefault();
    const hit = raycast(8);
    if (!hit) return;
    if (e.button === 0) {
        // Break
        setBlockId(hit.x, hit.y, hit.z, 0);
        ws && ws.send(JSON.stringify({ type: 'block_change', x: hit.x, y: hit.y, z: hit.z, blockId: 0 }));
    } else if (e.button === 2) {
        // Place adjacent to face we hit
        const px = hit.x + hit.normal[0], py = hit.y + hit.normal[1], pz = hit.z + hit.normal[2];
        const id = HOTBAR[currentSlot];
        // Don't place inside the player
        const min = [Math.floor(player.x - PLAYER_W/2), Math.floor(player.y - PLAYER_H + 0.01), Math.floor(player.z - PLAYER_W/2)];
        const max = [Math.floor(player.x + PLAYER_W/2), Math.floor(player.y), Math.floor(player.z + PLAYER_W/2)];
        if (px >= min[0] && px <= max[0] && py >= min[1] && py <= max[1] && pz >= min[2] && pz <= max[2]) return;
        setBlockId(px, py, pz, id);
        ws && ws.send(JSON.stringify({ type: 'block_change', x: px, y: py, z: pz, blockId: id }));
    }
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ===== Raycast: DDA voxel traversal =====
function raycast(maxDist) {
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'));
    let x = Math.floor(camera.position.x), y = Math.floor(camera.position.y), z = Math.floor(camera.position.z);
    const stepX = Math.sign(dir.x) || 1, stepY = Math.sign(dir.y) || 1, stepZ = Math.sign(dir.z) || 1;
    const tDeltaX = Math.abs(1 / dir.x), tDeltaY = Math.abs(1 / dir.y), tDeltaZ = Math.abs(1 / dir.z);
    let tMaxX = ((stepX > 0 ? Math.floor(camera.position.x) + 1 : Math.floor(camera.position.x)) - camera.position.x) / dir.x;
    let tMaxY = ((stepY > 0 ? Math.floor(camera.position.y) + 1 : Math.floor(camera.position.y)) - camera.position.y) / dir.y;
    let tMaxZ = ((stepZ > 0 ? Math.floor(camera.position.z) + 1 : Math.floor(camera.position.z)) - camera.position.z) / dir.z;
    if (!isFinite(tMaxX)) tMaxX = Infinity;
    if (!isFinite(tMaxY)) tMaxY = Infinity;
    if (!isFinite(tMaxZ)) tMaxZ = Infinity;
    let lastNormal = [0, 0, 0];
    let dist = 0;
    while (dist < maxDist) {
        if (tMaxX < tMaxY && tMaxX < tMaxZ) {
            x += stepX; dist = tMaxX; tMaxX += tDeltaX; lastNormal = [-stepX, 0, 0];
        } else if (tMaxY < tMaxZ) {
            y += stepY; dist = tMaxY; tMaxY += tDeltaY; lastNormal = [0, -stepY, 0];
        } else {
            z += stepZ; dist = tMaxZ; tMaxZ += tDeltaZ; lastNormal = [0, 0, -stepZ];
        }
        if (isSolidId(getBlockId(x, y, z))) return { x, y, z, normal: lastNormal };
    }
    return null;
}

// ===== Physics: AABB voxel collision =====
function collides(px, py, pz) {
    const minX = Math.floor(px - PLAYER_W/2), maxX = Math.floor(px + PLAYER_W/2 - 0.001);
    const minY = Math.floor(py - PLAYER_H + 0.001), maxY = Math.floor(py - 0.001);
    const minZ = Math.floor(pz - PLAYER_W/2), maxZ = Math.floor(pz + PLAYER_W/2 - 0.001);
    for (let yy = minY; yy <= maxY; yy++)
        for (let zz = minZ; zz <= maxZ; zz++)
            for (let xx = minX; xx <= maxX; xx++)
                if (isSolidId(getBlockId(xx, yy, zz))) return true;
    return false;
}

let lastT = performance.now();
function step(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    // Movement input → world-space velocity
    const fwd = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    const right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
    let mx = 0, mz = 0;
    if (!chatOpen) {
        if (keys['KeyW']) { mx += fwd.x; mz += fwd.z; }
        if (keys['KeyS']) { mx -= fwd.x; mz -= fwd.z; }
        if (keys['KeyA']) { mx -= right.x; mz -= right.z; }
        if (keys['KeyD']) { mx += right.x; mz += right.z; }
    }
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }
    const speed = (keys['ControlLeft'] ? MOVE_SPEED * SPRINT_MULT : MOVE_SPEED);
    player.vx = mx * speed;
    player.vz = mz * speed;

    if ((keys['Space']) && player.onGround && !chatOpen) {
        player.vy = JUMP_VEL;
        player.onGround = false;
    }

    player.vy -= GRAVITY * dt;
    if (player.vy < -50) player.vy = -50;

    // Move + collide axis by axis
    let nx = player.x + player.vx * dt;
    if (!collides(nx, player.y, player.z)) player.x = nx; else player.vx = 0;

    let nz = player.z + player.vz * dt;
    if (!collides(player.x, player.y, nz)) player.z = nz; else player.vz = 0;

    let ny = player.y + player.vy * dt;
    if (!collides(player.x, ny, player.z)) {
        player.y = ny; player.onGround = false;
    } else {
        if (player.vy < 0) player.onGround = true;
        player.vy = 0;
    }

    // Camera
    camera.position.set(player.x, player.y, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');

    // Broadcast position (10 Hz)
    if (ws && ws.readyState === ws.OPEN && now - lastBroadcast > 100) {
        lastBroadcast = now;
        ws.send(JSON.stringify({
            type: 'move', x: player.x, y: player.y, z: player.z,
            yaw: player.yaw, pitch: player.pitch
        }));
    }

    rebuildDirty();
    renderer.render(scene, camera);
    requestAnimationFrame(step);
}
let lastBroadcast = 0;

// ===== Hotbar UI =====
function renderHotbar() {
    const el = document.getElementById('hotbar');
    el.innerHTML = HOTBAR.map((id, i) => {
        const def = BLOCKS[id];
        const c = def && def.color != null
            ? '#' + def.color.toString(16).padStart(6, '0')
            : '#222';
        const label = def ? def.name.replace('_', ' ').slice(0, 6) : '?';
        return `<div class="slot ${i === currentSlot ? 'active' : ''}" style="background:${c}" title="${def ? def.name : ''}">${i + 1}</div>`;
    }).join('');
}
function selectSlot(i) { currentSlot = i; renderHotbar(); }
renderHotbar();

// ===== Chat =====
const chatLog = document.getElementById('chatLog');
const chatInput = document.getElementById('chatInput');
let chatOpen = false;
function openChat() { chatOpen = true; chatInput.focus(); }
function closeChat() { chatOpen = false; chatInput.blur(); chatInput.value = ''; }
chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        const t = chatInput.value.trim();
        if (t && ws && ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'chat', text: t }));
            appendChat(document.getElementById('playUser').value || 'bubbu', t, true);
        }
        closeChat();
    }
    if (e.key === 'Escape') closeChat();
});
function appendChat(name, text, isMe) {
    const div = document.createElement('div');
    div.className = 'msg' + (isMe ? ' me' : '');
    div.textContent = `<${name}> ${text}`;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
    window.MC_CHAT = window.MC_CHAT || [];
    window.MC_CHAT.push({ ts: Date.now(), name, text });
}

// ===== Encrypted autosave (every 5s) =====
const enc = new TextEncoder(), dec = new TextDecoder();
async function deriveKey(passphrase, salt) {
    const baseKey = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
        baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encryptJSON(obj, pass) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(pass, salt);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
    const out = new Uint8Array(iv.length + salt.length + ct.length);
    out.set(iv, 0); out.set(salt, iv.length); out.set(ct, iv.length + salt.length);
    return out;
}
window.MCB_DECRYPT = async function(bytes, pass) {
    const iv = bytes.slice(0,12), salt = bytes.slice(12,28), ct = bytes.slice(28);
    const key = await deriveKey(pass, salt);
    return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)));
};

let dirHandle = null;
let saveCount = 0;
const setSaveStatus = (msg, cls = '') => {
    const el = document.getElementById('saveStatus');
    el.innerHTML = `<span class="${cls}">${msg}</span>`;
};
document.getElementById('pickFolderBtn').onclick = async () => {
    if (!window.showDirectoryPicker) { setSaveStatus('Need Chrome/Edge', 'err'); return; }
    try {
        dirHandle = await window.showDirectoryPicker({ id: 'mc-saves', mode: 'readwrite', startIn: 'documents' });
        setSaveStatus('Folder ✓ saving every 5s', 'ok');
        setInterval(saveTick, SAVE_MS);
        saveTick();
    } catch (e) { setSaveStatus('Cancelled', 'err'); }
};
async function saveTick() {
    if (!dirHandle) return;
    const pass = document.getElementById('playPass').value;
    if (!pass) { setSaveStatus('No passphrase', 'err'); return; }
    try {
        const state = {
            ts: Date.now(),
            username: document.getElementById('playUser').value,
            position: { x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch },
            chat: (window.MC_CHAT || []).slice(-200),
            chunkCount: chunks.size
        };
        const bytes = await encryptJSON(state, pass);
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const writeFile = async (name) => {
            const fh = await dirHandle.getFileHandle(name, { create: true });
            const w = await fh.createWritable(); await w.write(bytes); await w.close();
        };
        await writeFile('latest.enc');
        await writeFile(`save-${stamp}.enc`);
        saveCount++;
        setSaveStatus(`✓ Saved ${saveCount}`, 'ok');
    } catch (e) { setSaveStatus('Save failed: ' + e.message, 'err'); }
}

// ===== Boot =====
connectWS();
requestAnimationFrame((t) => { lastT = t; step(t); });
