// Single-business detail page
(async function () {
    MCB.renderAuthArea();
    wireLogin();

    const id = new URLSearchParams(location.search).get('id');
    if (!id) { document.body.innerHTML = '<p style="padding:24px">Missing business id.</p>'; return; }

    const businesses = await MCB.loadAllBusinesses();
    const biz = businesses.find(b => b.id === id);
    if (!biz) { document.body.innerHTML = '<p style="padding:24px">Business not found.</p>'; return; }

    document.title = biz.name + ' — MC Businesses';
    document.getElementById('bizName').textContent = biz.name;
    document.getElementById('bizMeta').innerHTML =
        `Founded ${biz.founded || 'recently'} · Owner: <span class="auth-name">@${MCB.escape(biz.owner)}</span> · ${MCB.escape(biz.category || '')}`;
    document.getElementById('bizDescription').textContent = biz.description || '';

    // Stats
    const purchases = biz.purchases || [];
    const totalRevenue = purchases.reduce((s, p) => s + (p.totalPrice || 0), 0);
    const totalItems = purchases.reduce((s, p) => s + (p.quantity || 0), 0);
    const customers = new Set(purchases.map(p => p.buyer)).size;
    const rate = biz.investmentRate || 0.03;
    const baseCurrency = biz.baseCurrency || 'iron';

    document.getElementById('totalRevenue').textContent = totalRevenue + ' ' + baseCurrency;
    document.getElementById('totalRevenueSub').textContent =
        purchases.length + ' transactions';
    document.getElementById('totalItems').textContent = totalItems;
    document.getElementById('totalCustomers').textContent = customers;
    document.getElementById('growthRate').textContent = (rate * 100).toFixed(1) + '%';

    // Purchase ledger
    renderLedger(purchases);

    // Investment calculator + chart
    document.getElementById('investRateLabel').textContent = (rate * 100).toFixed(1) + '%';
    document.getElementById('investUnit').value = baseCurrency;
    const updateGrowth = () => renderGrowth(rate);
    document.getElementById('investAmount').addEventListener('input', updateGrowth);
    document.getElementById('investUnit').addEventListener('change', updateGrowth);
    updateGrowth();

    // Owner controls
    if (MCB.getSession() === biz.owner) {
        document.getElementById('purchaseControls').hidden = false;
        document.getElementById('addPurchaseBtn').onclick = openPurchaseModal;
    }
    wirePurchaseModal();

    function renderLedger(purchases) {
        const tbody = document.querySelector('#purchasesTable tbody');
        const sorted = [...purchases].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        if (sorted.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="muted" style="padding:24px;text-align:center">No purchases logged yet.</td></tr>`;
            return;
        }
        tbody.innerHTML = sorted.map(p => `
            <tr>
                <td>${MCB.escape(p.date || '?')}</td>
                <td>@${MCB.escape(p.buyer || '?')}</td>
                <td>${MCB.escape(p.item || '?')}</td>
                <td>${p.quantity || 1}</td>
                <td class="price">${p.totalPrice || 0} ${MCB.escape(p.priceUnit || baseCurrency)}</td>
            </tr>
        `).join('');
    }

    let chart;
    function renderGrowth(rate) {
        const amount = parseFloat(document.getElementById('investAmount').value) || 0;
        const unit = document.getElementById('investUnit').value;
        // 52 weeks of compound growth
        const weeks = 52;
        const labels = [];
        const data = [];
        for (let w = 0; w <= weeks; w++) {
            labels.push('w' + w);
            data.push(amount * Math.pow(1 + rate, w));
        }
        // Snapshot table
        const milestones = [
            { wk: 1, label: '1 week' },
            { wk: 4, label: '1 month' },
            { wk: 13, label: '3 months' },
            { wk: 26, label: '6 months' },
            { wk: 52, label: '1 year' },
        ];
        document.getElementById('growthTable').innerHTML = milestones.map(m => `
            <div class="growth-cell">
                <div class="gc-label">${m.label}</div>
                <div class="gc-val">${(amount * Math.pow(1 + rate, m.wk)).toFixed(2)}</div>
                <div class="muted" style="font-size:11px">${unit}</div>
            </div>
        `).join('');

        const ctx = document.getElementById('growthChart');
        if (chart) chart.destroy();
        chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: amount + ' ' + unit + ' invested',
                    data,
                    borderColor: '#5fc97c',
                    backgroundColor: 'rgba(95,201,124,0.15)',
                    fill: true,
                    tension: 0.25,
                    pointRadius: 0,
                }]
            },
            options: {
                plugins: { legend: { labels: { color: '#e8eaed' } } },
                scales: {
                    x: { ticks: { color: '#98a4b3', maxTicksLimit: 13 }, grid: { color: '#2d3540' } },
                    y: { ticks: { color: '#98a4b3' }, grid: { color: '#2d3540' } }
                }
            }
        });
    }

    function openPurchaseModal() {
        const m = document.getElementById('purchaseModal');
        m.hidden = false;
        document.getElementById('pBuyer').value = '';
        document.getElementById('pItem').value = '';
        document.getElementById('pQty').value = 1;
        document.getElementById('pPrice').value = '';
        document.getElementById('pUnit').value = baseCurrency;
        document.getElementById('pError').textContent = '';
        document.getElementById('pBuyer').focus();
    }

    function wirePurchaseModal() {
        const m = document.getElementById('purchaseModal');
        if (!m) return;
        document.getElementById('pCancel').onclick = () => m.hidden = true;
        document.getElementById('pSave').onclick = () => {
            const buyer = document.getElementById('pBuyer').value.trim();
            const item = document.getElementById('pItem').value.trim();
            const quantity = parseInt(document.getElementById('pQty').value, 10);
            const totalPrice = parseFloat(document.getElementById('pPrice').value);
            const priceUnit = document.getElementById('pUnit').value;
            const errEl = document.getElementById('pError');
            if (!buyer || !item) { errEl.textContent = 'Buyer and item are required.'; return; }
            if (!quantity || quantity < 1) { errEl.textContent = 'Quantity must be ≥1.'; return; }
            if (totalPrice == null || isNaN(totalPrice) || totalPrice < 0) { errEl.textContent = 'Price required.'; return; }
            const purchase = {
                date: new Date().toISOString().slice(0, 10),
                buyer, item, quantity, totalPrice, priceUnit
            };
            MCB.logPurchase(biz.id, purchase);
            location.reload();
        };
    }

    function wireLogin() {
        const loginBtn = document.getElementById('loginBtn');
        if (loginBtn) {
            // Reuse same pattern from app.js
            loginBtn.onclick = () => {
                const user = document.getElementById('loginUser').value.trim();
                const pass = document.getElementById('loginPass').value;
                // We don't have direct access to the loginOrRegister fn here; rely on app.js wiring
            };
        }
    }
})();
