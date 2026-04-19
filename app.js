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

    function getSession() { return localStorage.getItem(STORE_SESSION); }
    function setSession(name) { localStorage.setItem(STORE_SESSION, name); }
    function clearSession() { localStorage.removeItem(STORE_SESSION); }

    function loginOrRegister(username, password) {
        username = username.trim();
        if (!username || username.length < 2 || username.length > 16) return 'Username must be 2-16 chars.';
        if (!/^[A-Za-z0-9_]+$/.test(username)) return 'Username: letters, digits, underscore only.';
        if (!password || password.length < 4) return 'Password must be 4+ characters.';

        const users = getUsers();
        const hash = hashPassword(password);

        if (users[username]) {
            if (users[username].passHash !== hash) return 'Wrong password.';
        } else {
            users[username] = { passHash: hash, registeredAt: new Date().toISOString() };
            saveUsers(users);
        }
        setSession(username);
        return null; // success
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
                const err = loginOrRegister(user, pass);
                if (err) document.getElementById('loginError').textContent = err;
                else { closeLogin(); location.reload(); }
            };
            document.getElementById('loginCancel').onclick = closeLogin;
            // Enter key
            ['loginUser', 'loginPass'].forEach(id => {
                document.getElementById(id).addEventListener('keydown', e => {
                    if (e.key === 'Enter') loginBtn.click();
                });
            });
        }
    }
    // Auto-wire on every page load
    document.addEventListener('DOMContentLoaded', wireLoginModal);

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
