// MC Businesses — Firebase-backed auth + cloud data
// Falls back to localStorage-only mode if firebase-config.js isn't filled in yet.
//
// Firestore layout:
//   /businesses/{id}        { name, owner (uid), ownerName, category, baseCurrency,
//                             description, investmentRate, founded, purchases: [...] }
//
// Auth: Firebase Email/Password. Username is stored in displayName.

(function () {
    const FB_READY = !!window.FIREBASE_READY;
    const auth = window.fbAuth || null;
    const db = window.fbDb || null;

    // ===== LocalStorage fallback (used if Firebase not configured) =====
    const STORE_USERS = 'mcb.users';
    const STORE_SESSION = 'mcb.session';
    const STORE_OVERRIDES = 'mcb.businesses';

    function getUsers() { try { return JSON.parse(localStorage.getItem(STORE_USERS) || '{}'); } catch { return {}; } }
    function saveUsers(u) { localStorage.setItem(STORE_USERS, JSON.stringify(u)); }
    function hashPassword(pw) {
        let h = 5381;
        for (let i = 0; i < pw.length; i++) h = ((h << 5) + h) ^ pw.charCodeAt(i);
        return (h >>> 0).toString(36);
    }

    // ===== Session =====
    // With Firebase: tracks auth.currentUser. With fallback: tracks localStorage/sessionStorage.
    let currentUser = null; // { uid, email, name } when logged in
    const authListeners = [];

    function onAuthChange(cb) { authListeners.push(cb); cb(currentUser); }
    function fireAuthChange() { authListeners.forEach(cb => { try { cb(currentUser); } catch {} }); }

    function getSession() {
        if (currentUser) return currentUser.name || currentUser.email || null;
        if (FB_READY) return null; // not logged in
        // Fallback mode
        return localStorage.getItem(STORE_SESSION) || sessionStorage.getItem(STORE_SESSION);
    }
    function getSessionUid() { return currentUser ? currentUser.uid : (getSession() || null); }
    function setSessionFallback(name, remember) {
        if (remember) { localStorage.setItem(STORE_SESSION, name); sessionStorage.removeItem(STORE_SESSION); }
        else { sessionStorage.setItem(STORE_SESSION, name); localStorage.removeItem(STORE_SESSION); }
    }
    function clearSessionFallback() {
        localStorage.removeItem(STORE_SESSION); sessionStorage.removeItem(STORE_SESSION);
    }
    function getLastUsername() { return localStorage.getItem('mcb.lastUser') || ''; }
    function setLastUsername(name) { localStorage.setItem('mcb.lastUser', name); }

    // Subscribe to Firebase auth state
    if (FB_READY) {
        auth.onAuthStateChanged(user => {
            if (user) {
                currentUser = { uid: user.uid, email: user.email, name: user.displayName || user.email };
                setLastUsername(user.email);
            } else {
                currentUser = null;
            }
            fireAuthChange();
            applyLoginGate();
            renderAuthArea();
        });
    }

    // ===== Login / Signup / Logout / Forgot =====
    async function loginOnly(identifier, password, remember) {
        if (!identifier || !password) return 'Enter email and password.';
        identifier = identifier.trim();

        if (FB_READY) {
            try {
                // Remember = local persistence; otherwise session-only
                await auth.setPersistence(remember
                    ? firebase.auth.Auth.Persistence.LOCAL
                    : firebase.auth.Auth.Persistence.SESSION);
                await auth.signInWithEmailAndPassword(identifier, password);
                return null;
            } catch (e) {
                return prettyAuthError(e);
            }
        }
        // Fallback
        const users = getUsers();
        const key = Object.keys(users).find(k => k.toLowerCase() === identifier.toLowerCase()
            || (users[k].email || '').toLowerCase() === identifier.toLowerCase());
        if (!key) return 'No account with that username/email. Sign up first.';
        if (users[key].passHash !== hashPassword(password)) return 'Wrong password.';
        setSessionFallback(key, remember !== false);
        setLastUsername(key);
        return null;
    }

    async function registerOnly(username, email, password, password2, remember) {
        username = (username || '').trim();
        email = (email || '').trim();
        if (!username || username.length < 2 || username.length > 32) return 'Username must be 2-32 chars.';
        if (!/^[A-Za-z0-9_.-]+$/.test(username)) return 'Username: letters, digits, _ . - only.';
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Valid email required.';
        if (!password || password.length < 6) return 'Password must be 6+ characters.';
        if (password !== password2) return 'Passwords do not match.';

        if (FB_READY) {
            try {
                await auth.setPersistence(remember
                    ? firebase.auth.Auth.Persistence.LOCAL
                    : firebase.auth.Auth.Persistence.SESSION);
                const cred = await auth.createUserWithEmailAndPassword(email, password);
                await cred.user.updateProfile({ displayName: username });
                // Save username→uid lookup so usernames are unique-ish + queryable
                await db.collection('usernames').doc(username.toLowerCase()).set({
                    uid: cred.user.uid, username, createdAt: new Date().toISOString()
                });
                // Force currentUser refresh
                currentUser = { uid: cred.user.uid, email: cred.user.email, name: username };
                fireAuthChange();
                return null;
            } catch (e) {
                return prettyAuthError(e);
            }
        }
        // Fallback
        const users = getUsers();
        if (users[username]) return 'Username already taken.';
        users[username] = {
            email, passHash: hashPassword(password),
            registeredAt: new Date().toISOString(),
            lastLogin: new Date().toISOString()
        };
        saveUsers(users);
        setSessionFallback(username, remember !== false);
        setLastUsername(username);
        return null;
    }

    async function logout() {
        if (FB_READY) { try { await auth.signOut(); } catch {} }
        clearSessionFallback();
        location.reload();
    }

    // Forgot password — uses Firebase's built-in email sender (auto, no EmailJS).
    // Returns null on success, error string on failure.
    async function forgotPassword(email) {
        email = (email || '').trim();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return 'Enter your email address above first, then click "Forgot my password".';
        }
        if (!FB_READY) return 'Password reset requires Firebase setup. See README.';
        try {
            await auth.sendPasswordResetEmail(email);
            return null;
        } catch (e) {
            return prettyAuthError(e);
        }
    }

    function prettyAuthError(e) {
        const code = e && e.code || '';
        const map = {
            'auth/email-already-in-use': 'An account already exists with that email.',
            'auth/invalid-email': 'That email looks invalid.',
            'auth/weak-password': 'Password too weak (6+ characters).',
            'auth/user-not-found': 'No account with that email.',
            'auth/wrong-password': 'Wrong password.',
            'auth/invalid-credential': 'Wrong email or password.',
            'auth/too-many-requests': 'Too many attempts. Try again in a minute.',
            'auth/network-request-failed': 'Network error — check your connection.'
        };
        return map[code] || (e && e.message) || 'Something went wrong.';
    }

    // ===== Business data (Firestore + JSON seed fallback) =====
    let cachedAll = null;
    async function loadAllBusinesses() {
        if (cachedAll) return cachedAll;

        if (FB_READY) {
            try {
                const snap = await db.collection('businesses').get();
                const cloud = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                if (cloud.length > 0) { cachedAll = cloud; return cloud; }
                // Empty Firestore → seed it from businesses.json
                const seed = await loadSeed();
                await Promise.all(seed.map(b => db.collection('businesses').doc(b.id).set(b)));
                cachedAll = seed;
                return seed;
            } catch (e) {
                console.error('Firestore load failed, falling back to local:', e);
            }
        }

        // Fallback: JSON + localStorage overrides (legacy mode)
        const seed = await loadSeed();
        const overrides = getOverrides();
        const map = new Map();
        for (const b of seed) map.set(b.id, JSON.parse(JSON.stringify(b)));
        for (const ov of overrides) {
            if (map.has(ov.id)) {
                const existing = map.get(ov.id);
                const seen = new Set(existing.purchases.map(p => p.date + p.buyer + p.item));
                for (const p of (ov.purchases || [])) {
                    const k = p.date + p.buyer + p.item;
                    if (!seen.has(k)) existing.purchases.push(p);
                }
                if (ov.description) existing.description = ov.description;
                if (ov.investmentRate != null) existing.investmentRate = ov.investmentRate;
            } else {
                map.set(ov.id, ov);
            }
        }
        cachedAll = Array.from(map.values());
        return cachedAll;
    }

    async function loadSeed() {
        try {
            const res = await fetch('businesses.json');
            const data = await res.json();
            return data.businesses || [];
        } catch { return []; }
    }

    function getOverrides() { try { return JSON.parse(localStorage.getItem(STORE_OVERRIDES) || '[]'); } catch { return []; } }
    function saveOverrides(arr) { localStorage.setItem(STORE_OVERRIDES, JSON.stringify(arr)); cachedAll = null; }

    async function upsertOverride(business) {
        if (FB_READY) {
            try {
                await db.collection('businesses').doc(business.id).set(business, { merge: true });
                cachedAll = null;
                return;
            } catch (e) { console.error('Firestore write failed:', e); }
        }
        const arr = getOverrides();
        const idx = arr.findIndex(b => b.id === business.id);
        if (idx >= 0) arr[idx] = business; else arr.push(business);
        saveOverrides(arr);
    }

    async function logPurchase(businessId, purchase) {
        if (FB_READY) {
            try {
                await db.collection('businesses').doc(businessId).update({
                    purchases: firebase.firestore.FieldValue.arrayUnion(purchase)
                });
                cachedAll = null;
                return;
            } catch (e) { console.error('Firestore purchase write failed:', e); }
        }
        const arr = getOverrides();
        let entry = arr.find(b => b.id === businessId);
        if (!entry) { entry = { id: businessId, purchases: [] }; arr.push(entry); }
        entry.purchases = entry.purchases || [];
        entry.purchases.push(purchase);
        saveOverrides(arr);
    }

    // ===== UI =====
    function renderAuthArea() {
        const el = document.getElementById('authArea');
        if (!el) return;
        const session = getSession();
        if (session) {
            el.innerHTML = `
                <span class="auth-name">@${escape(session)}</span>
                <button id="logoutBtn">Log out</button>`;
            document.getElementById('logoutBtn').onclick = logout;
        } else {
            el.innerHTML = `<button id="loginOpenBtn" class="primary">Log in / Sign up</button>`;
            document.getElementById('loginOpenBtn').onclick = openLogin;
        }
    }

    function openLogin() {
        const m = document.getElementById('loginModal');
        if (!m) return;
        m.hidden = false;
        document.getElementById('loginUser').value = '';
        document.getElementById('loginPass').value = '';
        document.getElementById('loginError').textContent = '';
        document.getElementById('loginUser').focus();
    }
    function closeLogin() {
        const m = document.getElementById('loginModal');
        if (m) m.hidden = true;
    }

    function escape(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    function wireLoginModal() {
        const loginBtn = document.getElementById('loginBtn');
        if (loginBtn) {
            loginBtn.onclick = async () => {
                const user = document.getElementById('loginUser').value;
                const pass = document.getElementById('loginPass').value;
                const err = await loginOnly(user, pass, true);
                if (err) document.getElementById('loginError').textContent = err;
                else { closeLogin(); location.reload(); }
            };
            document.getElementById('loginCancel').onclick = closeLogin;
            ['loginUser', 'loginPass'].forEach(id => {
                document.getElementById(id).addEventListener('keydown', e => {
                    if (e.key === 'Enter') loginBtn.click();
                });
            });
        }
    }

    function applyLoginGate() {
        const gate = document.getElementById('loginGate');
        const main = document.getElementById('appMain');
        if (!gate || !main) return;
        if (getSession()) { gate.style.display = 'none'; main.hidden = false; }
        else { gate.style.display = 'flex'; main.hidden = true; }
    }

    function wireLoginGate() {
        const gate = document.getElementById('loginGate');
        if (!gate) return;

        // Tabs
        const tabs = gate.querySelectorAll('.tab');
        const panes = gate.querySelectorAll('.tab-pane');
        tabs.forEach(t => {
            t.onclick = () => {
                tabs.forEach(x => x.classList.toggle('active', x === t));
                const which = t.dataset.tab;
                panes.forEach(p => p.hidden = (p.dataset.pane !== which));
            };
        });

        // LOGIN
        const userInput = document.getElementById('gateUser');
        const passInput = document.getElementById('gatePass');
        const rememberCb = document.getElementById('gateRemember');
        const errEl = document.getElementById('gateError');
        const loginBtn = document.getElementById('gateLoginBtn');

        const last = getLastUsername();
        if (last) { userInput.value = last; passInput.focus(); } else { userInput.focus(); }

        const doLogin = async () => {
            errEl.textContent = '';
            loginBtn.disabled = true;
            const err = await loginOnly(userInput.value, passInput.value, rememberCb.checked);
            loginBtn.disabled = false;
            if (err) { errEl.textContent = err; return; }
            applyLoginGate();
            renderAuthArea();
            location.reload();
        };
        loginBtn.onclick = doLogin;
        [userInput, passInput].forEach(el =>
            el.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); }));

        // FORGOT PASSWORD
        const forgot = document.getElementById('forgotLink');
        if (forgot) {
            forgot.onclick = async (e) => {
                e.preventDefault();
                errEl.textContent = 'Sending reset email...';
                const err = await forgotPassword(userInput.value);
                errEl.textContent = err
                    ? err
                    : '✓ Reset email sent! Check your inbox (and spam folder).';
            };
        }

        // SIGNUP
        const suUser = document.getElementById('suUser');
        const suEmail = document.getElementById('suEmail');
        const suPass = document.getElementById('suPass');
        const suPass2 = document.getElementById('suPass2');
        const suRemember = document.getElementById('suRemember');
        const suError = document.getElementById('suError');
        const signupBtn = document.getElementById('gateSignupBtn');
        if (signupBtn) {
            const doSignup = async () => {
                suError.textContent = '';
                signupBtn.disabled = true;
                const err = await registerOnly(suUser.value, suEmail.value, suPass.value, suPass2.value, suRemember.checked);
                signupBtn.disabled = false;
                if (err) { suError.textContent = err; return; }
                applyLoginGate();
                renderAuthArea();
                location.reload();
            };
            signupBtn.onclick = doSignup;
            [suUser, suEmail, suPass, suPass2].forEach(el =>
                el.addEventListener('keydown', e => { if (e.key === 'Enter') doSignup(); }));
        }
    }

    function bootGate() {
        applyLoginGate();
        wireLoginGate();
        wireLoginModal();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootGate);
    } else {
        bootGate();
    }

    // Public API
    window.MCB = {
        loadAllBusinesses,
        getSession,
        getSessionUid,
        upsertOverride,
        logPurchase,
        getOverrides,
        renderAuthArea,
        openLogin,
        onAuthChange,
        escape,
    };

    // ===== Index page logic =====
    if (document.getElementById('businessGrid')) {
        renderAuthArea();
        wireLoginModal();
        loadAllBusinesses().then(businesses => {
            populateCategoryFilter(businesses);
            renderGrid(businesses);
            renderOwnerPanel(businesses);
            wireSearch(businesses);
            wireNewBusinessModal();
        });
    }

    function populateCategoryFilter(businesses) {
        const sel = document.getElementById('categoryFilter');
        const cats = Array.from(new Set(businesses.map(b => b.category).filter(Boolean))).sort();
        for (const c of cats) {
            const o = document.createElement('option');
            o.value = c; o.textContent = c;
            sel.appendChild(o);
        }
    }

    function renderGrid(businesses) {
        const grid = document.getElementById('businessGrid');
        const q = (document.getElementById('searchInput').value || '').toLowerCase().trim();
        const cat = document.getElementById('categoryFilter').value;
        const filtered = businesses.filter(b => {
            if (cat && b.category !== cat) return false;
            if (!q) return true;
            return (b.name + ' ' + b.owner + ' ' + (b.ownerName || '') + ' ' + (b.category || '') + ' ' + (b.description || '')).toLowerCase().includes(q);
        });
        grid.innerHTML = filtered.length === 0
            ? `<p class="muted">No businesses match.</p>`
            : filtered.map(b => bizCard(b)).join('');
    }

    function bizCard(b) {
        const totalSales = (b.purchases || []).reduce((s, p) => s + (p.totalPrice || 0), 0);
        const totalItems = (b.purchases || []).reduce((s, p) => s + (p.quantity || 0), 0);
        const unit = b.baseCurrency || 'iron';
        const ownerLabel = b.ownerName || b.owner || '?';
        return `
            <a href="business.html?id=${encodeURIComponent(b.id)}" class="biz-card-link">
              <h3>${escape(b.name)}</h3>
              <div class="biz-owner">@${escape(ownerLabel)}</div>
              <div class="biz-cat">${escape(b.category || 'Other')}</div>
              <div style="margin-top:10px">${escape(b.description || '')}</div>
              <div class="biz-stats">📦 ${totalItems} items sold · 💰 ${totalSales} ${unit}</div>
            </a>`;
    }

    function wireSearch(businesses) {
        document.getElementById('searchInput').addEventListener('input', () => renderGrid(businesses));
        document.getElementById('categoryFilter').addEventListener('change', () => renderGrid(businesses));
    }

    function renderOwnerPanel(businesses) {
        const panel = document.getElementById('ownerPanel');
        if (!panel) return;
        const uid = getSessionUid();
        const name = getSession();
        if (!uid && !name) { panel.hidden = true; return; }
        const myBiz = businesses.filter(b =>
            (uid && b.owner === uid) || (name && (b.owner === name || b.ownerName === name)));
        panel.hidden = false;
        const list = document.getElementById('ownerBusinesses');
        if (myBiz.length === 0) {
            list.innerHTML = `<p class="muted">You haven't registered any businesses yet. Click below to start one!</p>`;
        } else {
            list.innerHTML = myBiz.map(b => `
                <div class="owner-biz">
                    <div><strong>${escape(b.name)}</strong> · ${escape(b.category)} · ${(b.purchases || []).length} purchases</div>
                    <a href="business.html?id=${encodeURIComponent(b.id)}" class="button">Manage</a>
                </div>`).join('');
        }
    }

    function wireNewBusinessModal() {
        const newBtn = document.getElementById('newBusinessBtn');
        if (!newBtn) return;
        newBtn.onclick = () => {
            if (!getSession()) { openLogin(); return; }
            document.getElementById('newBusinessModal').hidden = false;
        };
        document.getElementById('bizCancel').onclick = () =>
            document.getElementById('newBusinessModal').hidden = true;
        document.getElementById('bizSave').onclick = async () => {
            const name = document.getElementById('bizName').value.trim();
            const category = document.getElementById('bizCategory').value;
            const baseCurrency = document.getElementById('bizCurrency').value;
            const description = document.getElementById('bizDescription').value.trim();
            const investmentRate = parseFloat(document.getElementById('bizRate').value) || 0.03;
            const errEl = document.getElementById('bizError');
            if (!name) { errEl.textContent = 'Name required.'; return; }
            const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            const ownerUid = getSessionUid();
            const ownerName = getSession();
            const newBiz = {
                id, name,
                owner: ownerUid || ownerName,
                ownerName,
                category, baseCurrency, description,
                investmentRate, founded: new Date().toISOString().slice(0, 10), purchases: []
            };
            await upsertOverride(newBiz);
            location.href = `business.html?id=${encodeURIComponent(id)}`;
        };
    }
})();
