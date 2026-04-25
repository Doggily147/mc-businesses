// MC Businesses — Minimal 2D Minecraft-like clone with multiplayer.
// - Canvas-based block world
// - WASD/Space movement, mouse to break/place
// - Multiplayer via Firebase Realtime Database (shared world + chat + player positions)
// - Auto-saves your local snapshot every 5s as encrypted .enc files

(function () {
    // ===== Constants =====
    const TILE = 32;
    const WORLD_W = 256;          // tiles wide
    const WORLD_H = 96;           // tiles tall
    const GROUND_Y = 60;
    const GRAVITY = 0.5;
    const JUMP_VEL = -10;
    const MOVE_SPEED = 4;

    const BLOCKS = {
        0: { name: 'air', color: null, solid: false },
        1: { name: 'grass', color: '#5cb04a', solid: true },
        2: { name: 'dirt', color: '#7a4a2b', solid: true },
        3: { name: 'stone', color: '#888888', solid: true },
        4: { name: 'wood', color: '#7a5230', solid: true },
        5: { name: 'leaves', color: '#3d8a3a', solid: true },
        6: { name: 'sand', color: '#e6d28a', solid: true },
        7: { name: 'water', color: 'rgba(64,128,255,0.6)', solid: false },
        8: { name: 'tnt', color: '#d83a3a', solid: true }
    };
    const HOTBAR = [1, 2, 3, 4, 5, 6, 8]; // selectable block ids
    let currentSlot = 0;

    // ===== State =====
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');
    let cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    function resize() {
        cssW = canvas.clientWidth; cssH = canvas.clientHeight;
        canvas.width = cssW * window.devicePixelRatio;
        canvas.height = cssH * window.devicePixelRatio;
        ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    }
    window.addEventListener('resize', resize);
    setTimeout(resize, 0);

    const world = new Uint8Array(WORLD_W * WORLD_H);
    function idx(x, y) { return y * WORLD_W + x; }
    function getBlock(x, y) {
        if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return 3; // stone wall outside
        return world[idx(x, y)];
    }
    function setBlock(x, y, b) {
        if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return;
        world[idx(x, y)] = b;
        // Sync to multiplayer
        if (mpDb) mpDb.ref('world/' + idx(x, y)).set(b);
    }

    // ===== World gen (procedural, deterministic from seed) =====
    function genWorld() {
        let h = GROUND_Y;
        for (let x = 0; x < WORLD_W; x++) {
            // Soft hill noise
            h += (Math.random() - 0.5) * 1.5;
            h = Math.max(GROUND_Y - 8, Math.min(GROUND_Y + 6, h));
            const surface = Math.floor(h);
            for (let y = 0; y < WORLD_H; y++) {
                if (y < surface) world[idx(x, y)] = 0;
                else if (y === surface) world[idx(x, y)] = 1; // grass
                else if (y < surface + 4) world[idx(x, y)] = 2; // dirt
                else world[idx(x, y)] = 3; // stone
            }
            // Random tree
            if (Math.random() < 0.04 && surface > 5) {
                const th = 4 + Math.floor(Math.random() * 2);
                for (let t = 1; t <= th; t++) world[idx(x, surface - t)] = 4;
                for (let dx = -2; dx <= 2; dx++)
                    for (let dy = -2; dy <= 0; dy++)
                        if (Math.abs(dx) + Math.abs(dy) < 4) {
                            const lx = x + dx, ly = surface - th + dy;
                            if (lx >= 0 && lx < WORLD_W && ly >= 0) world[idx(lx, ly)] = 5;
                        }
            }
        }
    }
    genWorld();

    // ===== Player =====
    const player = {
        x: WORLD_W * TILE / 2, y: (GROUND_Y - 5) * TILE,
        vx: 0, vy: 0, w: TILE * 0.8, h: TILE * 1.7,
        onGround: false, facing: 1
    };
    let camX = 0, camY = 0;

    // ===== Input =====
    const keys = {};
    window.addEventListener('keydown', e => {
        if (chatOpen) return;
        keys[e.key.toLowerCase()] = true;
        if (e.key === 't' || e.key === 'T') { e.preventDefault(); openChat(); }
        if (e.key === 'Escape') closeChat();
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= HOTBAR.length) selectSlot(n - 1);
    });
    window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

    // Mouse: left = break, right = place
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('mousedown', e => {
        const rect = canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left);
        const my = (e.clientY - rect.top);
        const wx = Math.floor((mx + camX) / TILE);
        const wy = Math.floor((my + camY) / TILE);
        const dist = Math.hypot(wx * TILE + TILE / 2 - (player.x + player.w / 2),
            wy * TILE + TILE / 2 - (player.y + player.h / 2));
        if (dist > TILE * 5) return; // reach limit
        if (e.button === 0) {
            if (getBlock(wx, wy) !== 0) setBlock(wx, wy, 0);
        } else if (e.button === 2) {
            if (getBlock(wx, wy) === 0) setBlock(wx, wy, HOTBAR[currentSlot]);
        }
    });

    // ===== Hotbar UI =====
    const hotbarEl = document.getElementById('hotbar');
    function renderHotbar() {
        hotbarEl.innerHTML = HOTBAR.map((id, i) => {
            const b = BLOCKS[id];
            return `<div class="slot ${i === currentSlot ? 'active' : ''}" style="background:${b.color || '#222'}">${i + 1}</div>`;
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
            const msg = chatInput.value.trim();
            if (msg) sendChat(msg);
            closeChat();
        }
        if (e.key === 'Escape') closeChat();
    });
    function appendChat(name, msg, isMe) {
        const div = document.createElement('div');
        div.className = 'msg' + (isMe ? ' me' : '');
        div.textContent = `<${name}> ${msg}`;
        chatLog.appendChild(div);
        chatLog.scrollTop = chatLog.scrollHeight;
        // also push into MC_CHAT for the encrypted save
        window.MC_CHAT = window.MC_CHAT || [];
        window.MC_CHAT.push({ ts: Date.now(), name, msg });
    }
    function sendChat(msg) {
        const name = document.getElementById('playUser').value || 'bubbu';
        appendChat(name, msg, true);
        if (mpDb) mpDb.ref('chat').push({ name, msg, ts: Date.now() });
    }

    // ===== Multiplayer (Firebase Realtime DB) =====
    let mpDb = null;
    let myId = 'p_' + Math.random().toString(36).slice(2, 9);
    const otherPlayers = {}; // id -> { x, y, name, lastSeen }

    function initMultiplayer() {
        if (!window.FIREBASE_READY || !window.firebase || !firebase.database) {
            console.warn('[mp] Firebase Realtime DB not configured — single-player only.');
            return;
        }
        try {
            mpDb = firebase.database();

            // Subscribe to world updates
            mpDb.ref('world').on('child_changed', snap => {
                world[parseInt(snap.key, 10)] = snap.val();
            });
            mpDb.ref('world').on('child_added', snap => {
                world[parseInt(snap.key, 10)] = snap.val();
            });

            // Subscribe to other players
            mpDb.ref('players').on('value', snap => {
                const all = snap.val() || {};
                for (const id of Object.keys(all)) {
                    if (id === myId) continue;
                    otherPlayers[id] = all[id];
                }
                // Drop ones that didn't update recently
                const now = Date.now();
                for (const id of Object.keys(otherPlayers)) {
                    if (!all[id] || now - (all[id].lastSeen || 0) > 8000) delete otherPlayers[id];
                }
                document.getElementById('playerCount').textContent = '👥 ' + (Object.keys(otherPlayers).length + 1);
            });

            // Subscribe to chat
            const chatStart = Date.now();
            mpDb.ref('chat').limitToLast(50).on('child_added', snap => {
                const m = snap.val();
                if (!m || m.ts < chatStart - 60000) return; // skip old backlog
                if (m.name === document.getElementById('playUser').value) return; // don't echo my own
                appendChat(m.name, m.msg, false);
            });

            // Disconnect cleanup
            mpDb.ref('players/' + myId).onDisconnect().remove();
        } catch (e) {
            console.error('[mp] init failed:', e);
        }
    }
    initMultiplayer();

    let lastBroadcast = 0;
    function broadcastSelf() {
        if (!mpDb) return;
        const now = performance.now();
        if (now - lastBroadcast < 100) return; // 10x/sec
        lastBroadcast = now;
        mpDb.ref('players/' + myId).set({
            name: document.getElementById('playUser').value || 'bubbu',
            x: player.x, y: player.y, facing: player.facing,
            lastSeen: Date.now()
        });
    }

    // ===== Physics + game loop =====
    function collide(px, py, pw, ph) {
        const x0 = Math.floor(px / TILE), x1 = Math.floor((px + pw - 1) / TILE);
        const y0 = Math.floor(py / TILE), y1 = Math.floor((py + ph - 1) / TILE);
        for (let yy = y0; yy <= y1; yy++)
            for (let xx = x0; xx <= x1; xx++) {
                const b = getBlock(xx, yy);
                if (BLOCKS[b] && BLOCKS[b].solid) return true;
            }
        return false;
    }

    function step() {
        // Input → velocity
        if (!chatOpen) {
            if (keys['a'] || keys['arrowleft']) { player.vx = -MOVE_SPEED; player.facing = -1; }
            else if (keys['d'] || keys['arrowright']) { player.vx = MOVE_SPEED; player.facing = 1; }
            else player.vx = 0;
            if ((keys[' '] || keys['w'] || keys['arrowup']) && player.onGround) {
                player.vy = JUMP_VEL; player.onGround = false;
            }
        } else { player.vx = 0; }

        // Gravity
        player.vy += GRAVITY;
        if (player.vy > 18) player.vy = 18;

        // Move + collide axes separately
        let nx = player.x + player.vx;
        if (!collide(nx, player.y, player.w, player.h)) player.x = nx;
        let ny = player.y + player.vy;
        if (!collide(player.x, ny, player.w, player.h)) {
            player.y = ny; player.onGround = false;
        } else {
            if (player.vy > 0) player.onGround = true;
            player.vy = 0;
        }

        // Camera follows player
        camX = player.x + player.w / 2 - cssW / 2;
        camY = player.y + player.h / 2 - cssH / 2;
        camX = Math.max(0, Math.min(WORLD_W * TILE - cssW, camX));
        camY = Math.max(0, Math.min(WORLD_H * TILE - cssH, camY));

        // Position snapshot for autosave module
        window.MC_POS = { x: player.x, y: player.y, facing: player.facing };

        broadcastSelf();
    }

    // ===== Render =====
    function draw() {
        // Sky gradient
        ctx.fillStyle = '#6db0ff';
        ctx.fillRect(0, 0, cssW, cssH);

        // Tiles in view
        const x0 = Math.floor(camX / TILE) - 1;
        const x1 = x0 + Math.ceil(cssW / TILE) + 2;
        const y0 = Math.floor(camY / TILE) - 1;
        const y1 = y0 + Math.ceil(cssH / TILE) + 2;
        for (let yy = y0; yy <= y1; yy++) {
            for (let xx = x0; xx <= x1; xx++) {
                const b = getBlock(xx, yy);
                const def = BLOCKS[b];
                if (!def || !def.color) continue;
                const sx = xx * TILE - camX, sy = yy * TILE - camY;
                ctx.fillStyle = def.color;
                ctx.fillRect(sx, sy, TILE, TILE);
                ctx.strokeStyle = 'rgba(0,0,0,0.12)';
                ctx.strokeRect(sx + 0.5, sy + 0.5, TILE - 1, TILE - 1);
            }
        }

        // Other players
        ctx.font = 'bold 13px system-ui';
        for (const id of Object.keys(otherPlayers)) {
            const p = otherPlayers[id];
            const sx = p.x - camX, sy = p.y - camY;
            ctx.fillStyle = '#3a3aff';
            ctx.fillRect(sx, sy, player.w, player.h);
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.fillText('@' + (p.name || '?'), sx + player.w / 2, sy - 4);
        }

        // Self
        const psx = player.x - camX, psy = player.y - camY;
        ctx.fillStyle = '#e25c5c';
        ctx.fillRect(psx, psy, player.w, player.h);
        // Eyes (facing)
        ctx.fillStyle = '#fff';
        const ex = psx + (player.facing > 0 ? player.w * 0.55 : player.w * 0.15);
        ctx.fillRect(ex, psy + 6, 6, 6);
        // Name
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText('@' + (document.getElementById('playUser').value || 'bubbu'), psx + player.w / 2, psy - 4);

        // Hover highlight
        const m = lastMouse;
        if (m) {
            const wx = Math.floor((m.x + camX) / TILE);
            const wy = Math.floor((m.y + camY) / TILE);
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.strokeRect(wx * TILE - camX, wy * TILE - camY, TILE, TILE);
            ctx.lineWidth = 1;
        }
    }

    let lastMouse = null;
    canvas.addEventListener('mousemove', e => {
        const r = canvas.getBoundingClientRect();
        lastMouse = { x: e.clientX - r.left, y: e.clientY - r.top };
    });

    function loop() { step(); draw(); requestAnimationFrame(loop); }
    requestAnimationFrame(loop);

    // ===== Encrypted autosave (every 5s) =====
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    async function deriveKey(passphrase, salt) {
        const baseKey = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
            baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }
    async function encryptJSON(obj, passphrase) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const key = await deriveKey(passphrase, salt);
        const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
        const out = new Uint8Array(iv.length + salt.length + ct.length);
        out.set(iv, 0); out.set(salt, iv.length); out.set(ct, iv.length + salt.length);
        return out;
    }
    async function decryptJSON(bytes, passphrase) {
        const iv = bytes.slice(0, 12), salt = bytes.slice(12, 28), ct = bytes.slice(28);
        const key = await deriveKey(passphrase, salt);
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
        return JSON.parse(dec.decode(pt));
    }
    window.MCB_DECRYPT = decryptJSON;

    let dirHandle = null;
    let saveCounter = 0;
    const status = (msg, cls = '') => {
        const el = document.getElementById('saveStatus');
        const t = new Date().toLocaleTimeString();
        el.innerHTML = `<span class="${cls}">[${t}] ${msg}</span>`;
    };

    document.getElementById('pickFolderBtn').onclick = async () => {
        if (!window.showDirectoryPicker) { status('Browser does not support folder access. Use Chrome/Edge.', 'err'); return; }
        try {
            dirHandle = await window.showDirectoryPicker({ id: 'mc-saves', mode: 'readwrite', startIn: 'documents' });
            status('Folder ✓ — autosave running every 5s', 'ok');
            startAutosave();
        } catch (e) { status('Pick cancelled: ' + e.message, 'err'); }
    };

    async function tickSave() {
        if (!dirHandle) return;
        const passphrase = document.getElementById('playPass').value;
        if (!passphrase) { status('No passphrase — skipping save', 'err'); return; }
        try {
            const state = {
                ts: Date.now(),
                username: document.getElementById('playUser').value,
                position: window.MC_POS,
                chat: (window.MC_CHAT || []).slice(-200),
                world: Array.from(world)  // full world snapshot
            };
            const bytes = await encryptJSON(state, passphrase);
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const writeFile = async (name) => {
                const fh = await dirHandle.getFileHandle(name, { create: true });
                const w = await fh.createWritable(); await w.write(bytes); await w.close();
            };
            await writeFile('latest.enc');
            await writeFile(`save-${stamp}.enc`);
            saveCounter++;
            status(`✓ Saved ${saveCounter} (latest.enc + save-${stamp}.enc)`, 'ok');
        } catch (e) { status('Save failed: ' + e.message, 'err'); }
    }
    function startAutosave() { setInterval(tickSave, 5000); tickSave(); }
})();
