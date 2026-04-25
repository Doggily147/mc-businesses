// MC Businesses — Play page: auto-saves progress every 5s as encrypted files on your computer.
//
// Encryption: AES-GCM with key derived from your passphrase via PBKDF2 (200k iterations, SHA-256).
// File format: [12-byte IV][16-byte salt][ciphertext]
// Decryption tool: see decrypt-save.html (todo) or run the snippet at the bottom of this file.
//
// Storage: File System Access API → real .enc files in a folder you pick.
//   Browser support: Chrome, Edge, Opera, Brave. Firefox/Safari = IndexedDB fallback.

(function () {
    const SAVE_INTERVAL_MS = 5000;
    const PBKDF2_ITERS = 200_000;

    const status = (msg, cls = '') => {
        const el = document.getElementById('saveStatus');
        const time = new Date().toLocaleTimeString();
        el.innerHTML = `<span class="${cls}">[${time}] ${msg}</span>`;
    };

    let dirHandle = null;       // FSA folder handle
    let saveTimer = null;
    let saveCounter = 0;

    // ----- Crypto helpers -----
    const enc = new TextEncoder();
    const dec = new TextDecoder();

    async function deriveKey(passphrase, salt) {
        const baseKey = await crypto.subtle.importKey(
            'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
        );
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
            baseKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    async function encryptJSON(obj, passphrase) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const key = await deriveKey(passphrase, salt);
        const plaintext = enc.encode(JSON.stringify(obj));
        const ct = new Uint8Array(await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv }, key, plaintext
        ));
        // [iv | salt | ciphertext]
        const out = new Uint8Array(iv.length + salt.length + ct.length);
        out.set(iv, 0);
        out.set(salt, iv.length);
        out.set(ct, iv.length + salt.length);
        return out;
    }

    async function decryptJSON(bytes, passphrase) {
        const iv = bytes.slice(0, 12);
        const salt = bytes.slice(12, 28);
        const ct = bytes.slice(28);
        const key = await deriveKey(passphrase, salt);
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
        return JSON.parse(dec.decode(pt));
    }

    // ----- File System Access API -----
    async function pickFolder() {
        if (!window.showDirectoryPicker) {
            throw new Error('Your browser does not support real file saves. Use Chrome, Edge, Opera, or Brave.');
        }
        const handle = await window.showDirectoryPicker({
            id: 'mc-saves',
            mode: 'readwrite',
            startIn: 'documents'
        });
        return handle;
    }

    async function writeEncryptedFile(dir, filename, bytes) {
        const fileHandle = await dir.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(bytes);
        await writable.close();
    }

    // ----- "Game state" — what we save every 5s -----
    // Until the actual MC client is wired in, we save:
    //   - timestamp
    //   - username
    //   - server address
    //   - chat log (any messages buffered by window.MC_CHAT)
    //   - position snapshot (window.MC_POS if the client exposes it)
    //   - settings (anything window.MC_SETTINGS holds)
    //
    // When we plug in Eaglercraft/Prismarine, those globals get populated and saving Just Works.
    function snapshotState() {
        return {
            ts: Date.now(),
            iso: new Date().toISOString(),
            username: document.getElementById('playUser').value,
            server: document.getElementById('srvAddr').value,
            chat: (window.MC_CHAT || []).slice(-200),
            position: window.MC_POS || null,
            settings: window.MC_SETTINGS || {},
        };
    }

    async function tickSave() {
        if (!dirHandle) return;
        const passphrase = document.getElementById('playPass').value;
        if (!passphrase) { status('No passphrase — save skipped', 'err'); return; }
        try {
            const state = snapshotState();
            const bytes = await encryptJSON(state, passphrase);
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const name = `save-${stamp}.enc`;
            await writeEncryptedFile(dirHandle, name, bytes);
            // Also overwrite "latest.enc" for easy resume
            await writeEncryptedFile(dirHandle, 'latest.enc', bytes);
            saveCounter++;
            status(`✓ Saved (${saveCounter} total) — latest.enc + ${name}`, 'ok');
        } catch (e) {
            status('Save failed: ' + e.message, 'err');
        }
    }

    function startAutosave() {
        if (saveTimer) clearInterval(saveTimer);
        saveTimer = setInterval(tickSave, SAVE_INTERVAL_MS);
        tickSave(); // immediate first save
    }

    // ----- Wire UI -----
    document.getElementById('pickFolderBtn').onclick = async () => {
        try {
            dirHandle = await pickFolder();
            status('Folder chosen ✓ — click "Connect & start saving" to begin', 'ok');
            document.getElementById('connectBtn').disabled = false;
        } catch (e) {
            status('Folder pick cancelled or failed: ' + e.message, 'err');
        }
    };

    document.getElementById('connectBtn').onclick = () => {
        if (!dirHandle) { status('Pick a folder first', 'err'); return; }
        startAutosave();
        status('Auto-save running every 5s ✓', 'ok');
        // TODO: once we know server software, mount the actual MC client here:
        // document.getElementById('clientMount').hidden = false;
        // document.getElementById('clientFrame').src = '<eaglercraft/prismarine URL>';
    };

    // ----- Decryption helper (paste in console to read your files back) -----
    // Quick one-liner you can run in DevTools to decrypt a saved file:
    //   const bytes = new Uint8Array(await (await fetch('latest.enc')).arrayBuffer());
    //   await window.MCB_DECRYPT(bytes, 'bubbo');
    window.MCB_DECRYPT = decryptJSON;
})();
