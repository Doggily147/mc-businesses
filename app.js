// MC Businesses — shared logic for login + business loading
// Storage keys:
//   mcb.users           = { username: { passHash } }
//   mcb.session         = currently logged-in username (string)
//   mcb.businesses      = local overrides/additions to businesses.json

(function () {
    const STORE_USERS = 'mcb.users';
    const STORE_SESSION = 'mcb.session';
    const STORE_OVERRIDES = 'mcb.businesses';

    // ===== Auth (localStorage based; not real security) =====
    function getUsers() {
        try { return JSON.parse(localStorage.getItem(STORE_USERS) || '{}'); } catch { return {}; }
    }
    function saveUsers(u) { localStorage.setItem(STORE_USERS, JSON.stringify(u)); }

    function hashPassword(pw) {
        // Simple non-cryptographic hash. Good enough for "is this the same password they typed before?"
        // Real auth requires a backend. For free-static-site this is the best we can do.
        let h = 5381;
        for (let i = 0; i < pw.length; i++) h = ((h << 5) + h) ^ pw.charCodeAt(i);
        return (h >>> 0).toString(36);
    }

    // "Remember me" determines storage:
    //   - true  -> localStorage (persists forever)
    //   - false -> sessionStorage (clears when browser closes)
    function getSession() {
        return localStorage.getItem(STORE_SESSION) || sessionStorage.getItem(STORE_SESSION);
    }
    function setSession(name, remember) {
        if (remember) {
            localStorage.setItem(STORE_SESSION, name);
            sessionStorage.removeItem(STORE_SESSION);
        } else {
            sessionStorage.setItem(STORE_SESSION, name);
            localStorage.removeItem(STORE_SESSION);
        }
    }
    function clearSession() {
        localStorage.removeItem(STORE_SESSION);
        sessionStorage.removeItem(STORE_SESSION);
    }
    function getLastUsername() {
        return localStorage.getItem('mcb.lastUser') || '';
    }
    function setLastUsername(name) {
        localStorage.setItem('mcb.lastUser', name);
    }

    // Find a user by username OR email (login accepts either)
    function findUserKey(users, identifier) {
        identifier = (identifier || '').trim().toLowerCase();
        if (!identifier) return null;
        for (const key of Object.keys(users)) {
            if (key.toLowerCase() === identifier) return key;
            if ((users[key].email || '').toLowerCase() === identifier) return key;
        }
        return null;
    }

    function loginOnly(identifier, password, remember) {
        if (!identifier || !password) return 'Enter username/email and password.';
        const users = getUsers();
        const key = findUserKey(users, identifier);
        if (!key) return 'No account with that username/email. Sign up first.';
        if (users[key].passHash !== hashPassword(password)) return 'Wrong password.';
        users[key].lastLogin = new Date().toISOString();
        saveUsers(users);
        setSession(key, remember !== false);
        setLastUsername(key);
        return null;
    }

    function registerOnly(username, email, password, password2, remember) {
        username = (username || '').trim();
        email = (email || '').trim();
        if (!username || username.length < 2 || username.length > 32) return 'Username must be 2-32 chars.';
        if (!/^[A-Za-z0-9_.-]+$/.test(username)) return 'Username: letters, digits, _ . - only.';
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Valid email required.';
        if (!password || password.length < 4) return 'Password must be 4+ characters.';
        if (password !== password2) return 'Passwords do not match.';

        const users = getUsers();
        if (findUserKey(users, username)) return 'Username already taken.';
        if (findUserKey(users, email)) return 'Email already registered.';

        users[username] = {
            email,
            passHash: hashPassword(password),
            registeredAt: new Date().toISOString(),
            lastLogin: new Date().toISOString()
        };
        saveUsers(users);
        setSession(username, remember !== false);
        setLastUsername(username);
        return null;
    }

    function forgotPassword(identifier) {
        identifier = (identifier || '').trim();
        const users = getUsers();
        const key = identifier ? findUserKey(users, identifier) : null;
        const knownEmail = key ? (users[key].email || '') : '';
        const subject = encodeURIComponent('MC Businesses — Password reset request');
        const body = encodeURIComponent(
            'Hi Isaac,\n\n' +
            'I forgot my password for MC Server Businesses and need a reset.\n\n' +
            'Username / email I tried: ' + (identifier || '(not entered)') + '\n' +
            (knownEmail ? 'Email on file: ' + knownEmail + '\n' : '') +
            'Browser: ' + navigator.userAgent + '\n' +
            'Time: ' + new Date().toISOString() + '\n\n' +
            'Thanks!'
        );
        window.location.href = 'mailto:isaac.huq@gmail.com?subject=' + subject + '&body=' + body;
    }

    // ===== Business data =====
    let cachedAll = null;
    async function loadAllBusinesses() {
        if (cachedAll) return cachedAll;
        const res = await fetch('businesses.json');
        const data = await res.json();
        const base = data.businesses || [];

        // Merge with localStorage overrides (new businesses or new purchases by users)
        const overrides = getOverrides();
        const map = new Map();
        for (const b of base) map.set(b.id, JSON.parse(JSON.stringify(b)));
        for (const ov of overrides) {
            if (map.has(ov.id)) {
                // Merge purchases
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

    function getOverrides() {
        try { return JSON.parse(localStorage.getItem(STORE_OVERRIDES) || '[]'); } catch { return []; }
    }
    function saveOverrides(arr) {
        localStorage.setItem(STORE_OVERRIDES, JSON.stringify(arr));
        cachedAll = null;
    }

    function upsertOverride(business) {
        const arr = getOverrides();
        const idx = arr.findIndex(b => b.id === business.id);
        if (idx >= 0) arr[idx] = business; else arr.push(business);
        saveOverrides(arr);
    }

    function logPurchase(businessId, purchase) {
        const arr = getOverrides();
        let entry = arr.find(b => b.id === businessId);
        if (!entry) {
            entry = { id: businessId, purchases: [] };
            arr.push(entry);
        }
        entry.purchases = entry.purchases || [];
        entry.purchases.push(purchase);
        saveOverrides(arr);
    }

    // ===== UI: Auth area =====
    function renderAuthArea() {
        const el = document.getElementById('authArea');
        if (!el) return;
        const session = getSession();
        if (session) {
            el.innerHTML = `
                <span class="auth-name">@${escape(session)}</span>
                <button id="logoutBtn">Log out</button>
            `;
            document.getElementById('logoutBtn').onclick = () => { clearSession(); location.reload(); };
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

    // Wire login modal buttons (if present on this page)
    function wireLoginModal() {
        const loginBtn = document.getElementById('loginBtn');
        if (loginBtn) {
            loginBtn.onclick = () => {
                const user = document.getElementById('loginUser').value;
                const pass = document.getElementById('loginPass').value;
                const err = loginOnly(user, pass, true);
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
    // ===== Login gate (full-page) =====
    function applyLoginGate() {
        const gate = document.getElementById('loginGate');
        const main = document.getElementById('appMain');
        if (!gate || !main) return;
        const session = getSession();
        if (session) {
            gate.style.display = 'none';
            main.hidden = false;
        } else {
            gate.style.display = 'flex';
            main.hidden = true;
        }
    }

    function wireLoginGate() {
        const gate = document.getElementById('loginGate');
        if (!gate) return;

        // ----- Tab switching -----
        const tabs = gate.querySelectorAll('.tab');
        const panes = gate.querySelectorAll('.tab-pane');
        tabs.forEach(t => {
            t.onclick = () => {
                tabs.forEach(x => x.classList.toggle('active', x === t));
                const which = t.dataset.tab;
                panes.forEach(p => p.hidden = (p.dataset.pane !== which));
            };
        });

        // ----- LOGIN -----
        const userInput = document.getElementById('gateUser');
        const passInput = document.getElementById('gatePass');
        const rememberCb = document.getElementById('gateRemember');
        const errEl = document.getElementById('gateError');
        const loginBtn = document.getElementById('gateLoginBtn');

        const last = getLastUsername();
        if (last) { userInput.value = last; passInput.focus(); } else { userInput.focus(); }

        const doLogin = () => {
            errEl.textContent = '';
            const err = loginOnly(userInput.value, passInput.value, rememberCb.checked);
            if (err) { errEl.textContent = err; return; }
            applyLoginGate();
            renderAuthArea();
            location.reload();
        };
        loginBtn.onclick = doLogin;
        [userInput, passInput].forEach(el =>
            el.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); }));

        // ----- Forgot password -----
        const forgot = document.getElementById('forgotLink');
        if (forgot) {
            forgot.onclick = (e) => {
                e.preventDefault();
                forgotPassword(userInput.value);
            };
        }

        // ----- SIGNUP -----
        const suUser = document.getElementById('suUser');
        const suEmail = document.getElementById('suEmail');
        const suPass = document.getElementById('suPass');
        const suPass2 = document.getElementById('suPass2');
        const suRemember = document.getElementById('suRemember');
        const suError = document.getElementById('suError');
        const signupBtn = document.getElementById('gateSignupBtn');
        if (signupBtn) {
            const doSignup = () => {
                suError.textContent = '';
                const err = registerOnly(suUser.value, suEmail.value, suPass.value, suPass2.value, suRemember.checked);
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

    // Run gate immediately (script is at end of body, so DOM is ready).
    // Using addEventListener is unreliable here because DOMContentLoaded may
    // have already fired by the time the listener is registered.
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

    // Expose globally for other scripts
    window.MCB = {
        loadAllBusinesses,
        getSession,
        upsertOverride,
        logPurchase,
        getOverrides,
        renderAuthArea,
        openLogin,
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
            return (b.name + ' ' + b.owner + ' ' + (b.category || '') + ' ' + (b.description || '')).toLowerCase().includes(q);
        });
        grid.innerHTML = filtered.length === 0
            ? `<p class="muted">No businesses match.</p>`
            : filtered.map(b => bizCard(b)).join('');
    }

    function bizCard(b) {
        const totalSales = (b.purchases || []).reduce((s, p) => s + (p.totalPrice || 0), 0);
        const totalItems = (b.purchases || []).reduce((s, p) => s + (p.quantity || 0), 0);
        const unit = b.baseCurrency || 'iron';
        return `
            <a href="business.html?id=${encodeURIComponent(b.id)}" class="biz-card-link">
              <h3>${escape(b.name)}</h3>
              <div class="biz-owner">@${escape(b.owner)}</div>
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
        const session = getSession();
        const panel = document.getElementById('ownerPanel');
        if (!panel) return;
        if (!session) { panel.hidden = true; return; }
        const myBiz = businesses.filter(b => b.owner === session);
        panel.hidden = false;
        const list = document.getElementById('ownerBusinesses');
        if (myBiz.length === 0) {
            list.innerHTML = `<p class="muted">You haven't registered any businesses yet. Click below to start one!</p>`;
        } else {
            list.innerHTML = myBiz.map(b => `
                <div class="owner-biz">
                    <div><strong>${escape(b.name)}</strong> · ${escape(b.category)} · ${(b.purchases || []).length} purchases</div>
                    <a href="business.html?id=${encodeURIComponent(b.id)}" class="button">Manage</a>
                </div>
            `).join('');
        }
    }

    function wireNewBusinessModal() {
        const newBtn = document.getElementById('newBusinessBtn');
        if (!newBtn) return;
        newBtn.onclick = () => {
            const session = getSession();
            if (!session) { openLogin(); return; }
            document.getElementById('newBusinessModal').hidden = false;
        };
        document.getElementById('bizCancel').onclick = () =>
            document.getElementById('newBusinessModal').hidden = true;
        document.getElementById('bizSave').onclick = () => {
            const name = document.getElementById('bizName').value.trim();
            const category = document.getElementById('bizCategory').value;
            const baseCurrency = document.getElementById('bizCurrency').value;
            const description = document.getElementById('bizDescription').value.trim();
            const investmentRate = parseFloat(document.getElementById('bizRate').value) || 0.03;
            const errEl = document.getElementById('bizError');
            if (!name) { errEl.textContent = 'Name required.'; return; }
            const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            const owner = getSession();
            const newBiz = {
                id, name, owner, category, baseCurrency, description,
                investmentRate, founded: new Date().toISOString().slice(0, 10), purchases: []
            };
            upsertOverride(newBiz);
            location.href = `business.html?id=${encodeURIComponent(id)}`;
        };
    }
})();
