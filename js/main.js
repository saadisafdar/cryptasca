/* ============================================================
   main.js — App bootstrap, event wiring, auto-refresh
   Orchestrates: Portfolio, CryptoAPI, Charts, UI
   ============================================================ */

/* ── App State ──────────────────────────────────────────────── */

const State = {
  priceMap:        new Map(), // coinId → CoinGecko market object
  sortState:       { col: 'value', dir: 'desc' },
  activeCoinId:    null,       // coin open in detail panel
  activePanelDays: 1,          // current chart range
  deleteConfirm:   null,       // id of row pending confirm-delete
  previousTotal:   0,          // for count-up delta on refresh
  refreshTimer:    null,
};

/* ── Bootstrap ──────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', async () => {

  // ─ Demo seed ─
  const freshSeed = Portfolio.seedDemoData();
  if (Portfolio.isDemoSeeded()) UI.showDemoControls();

  // ─ Wire static event listeners ─
  wireNavigation();
  wireModal();
  wirePanel();
  wireErrorBanner();
  wireDemoControls();
  wireTableSort();
  wireWatchlistSearch();
  wireGlobalDismiss();

  // ─ Init reveal observer ─
  UI.initRevealObserver();

  // ─ Initial data load ─
  await refreshAll(true /* initial */);

  // ─ Auto-refresh every 60 seconds ─
  State.refreshTimer = setInterval(() => refreshAll(false), 60_000);
});

/* ── Core refresh cycle ─────────────────────────────────────── */

/**
 * Fetch fresh market data for all held + watched coins, then re-render.
 * @param {boolean} initial  true on first load (triggers full render)
 */
async function refreshAll(initial = false) {
  const holdings  = Portfolio.getHoldings();
  const watchlist = Portfolio.getWatchlist();

  // Collect all unique coin IDs
  const ids = [...new Set([
    ...holdings.map(h => h.coinId),
    ...watchlist.map(w => w.coinId),
  ])];

  if (ids.length > 0) {
    try {
      const markets = await CryptoAPI.getMarkets(ids);
      State.priceMap.clear();
      markets.forEach(m => State.priceMap.set(m.id, m));
    } catch (err) {
      console.error('[refreshAll] API error:', err);
      UI.showError('Unable to reach CoinGecko. Showing cached data.');
    }
  }

  // Render all sections
  renderOverview(holdings, initial);
  renderHoldings(holdings);
  renderWatchlist(watchlist, initial);

  UI.updateRefreshBadge();
}

/* ── SECTION: Overview ──────────────────────────────────────── */

let _prevTotal = 0;

function renderOverview(holdings, initial) {
  const priceMap = State.priceMap;

  // ─ Portfolio total ─
  let total = 0;
  let costBasis = 0;

  holdings.forEach(h => {
    const market = priceMap.get(h.coinId);
    const price  = market?.current_price ?? h.buyPrice;
    const gl     = Portfolio.calcGainLoss(h, price);
    total     += gl.value;
    costBasis += gl.costBasis;
  });

  const heroEl = document.getElementById('portfolio-total');
  if (heroEl) {
    const from = initial ? 0 : _prevTotal;
    UI.countUp(
      heroEl, from, total, 1100,
      n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    );
  }
  _prevTotal = total;

  // ─ 24h change ─
  const change24h = Portfolio.calcPortfolio24h(holdings, priceMap);
  const badge     = document.getElementById('change-badge');
  const changeVal = document.getElementById('change-value');
  if (badge && changeVal) {
    const isPos = change24h.percent >= 0;
    badge.className = `change-badge ${isPos ? 'positive' : 'negative'}`;
    badge.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2.5" stroke-linecap="round">
        ${isPos ? '<polyline points="18 15 12 9 6 15"/>' : '<polyline points="6 9 12 15 18 9"/>'}
      </svg>
      <span id="change-value">${formatPct(change24h.percent)}</span>
    `;
  }

  // ─ Stat cards ─
  const pnl = total - costBasis;
  setEl('stat-holdings-count', holdings.length.toString());
  setEl('stat-cost-basis', formatUSD(costBasis, true));
  setEl('stat-total-pnl', formatUSD(pnl, true));
  colorEl('stat-total-pnl', pnl);

  // Best performer
  let bestHolder = null, bestPct = -Infinity;
  holdings.forEach(h => {
    const market = priceMap.get(h.coinId);
    if (!market) return;
    const gl = Portfolio.calcGainLoss(h, market.current_price);
    if (gl.percent > bestPct) { bestPct = gl.percent; bestHolder = h; }
  });
  if (bestHolder) {
    setEl('stat-best-performer', `${bestHolder.symbol?.toUpperCase()} ${formatPct(bestPct)}`);
    colorEl('stat-best-performer', bestPct);
  } else {
    setEl('stat-best-performer', '—');
  }

  // ─ Donut chart ─
  const allocationItems = holdings
    .map(h => {
      const market = priceMap.get(h.coinId);
      const price  = market?.current_price ?? h.buyPrice;
      return { label: h.symbol?.toUpperCase(), value: h.amount * price };
    })
    .filter(i => i.value > 0)
    .sort((a, b) => b.value - a.value);

  Charts.renderAllocationChart(allocationItems);

  // ─ Top movers ─
  renderMovers(holdings);
}

function renderMovers(holdings) {
  const list   = document.getElementById('movers-list');
  const empty  = document.getElementById('movers-empty');
  if (!list) return;

  const enriched = holdings
    .map(h => {
      const market = State.priceMap.get(h.coinId);
      if (!market) return null;
      return {
        ...h,
        changePct: market.price_change_percentage_24h || 0,
        image:     market.image || h.image,
      };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 6);

  if (enriched.length === 0) {
    empty.style.display = 'flex';
    list.querySelectorAll('.mover-row').forEach(r => r.remove());
    return;
  }

  empty.style.display = 'none';

  // Remove old rows, keep empty sentinel
  list.querySelectorAll('.mover-row').forEach(r => r.remove());

  enriched.forEach(item => {
    const isPos = item.changePct >= 0;
    const row = document.createElement('div');
    row.className = 'mover-row';
    row.dataset.coinId = item.coinId;
    row.innerHTML = `
      <img class="mover-icon" src="${item.image || ''}" alt="${UI.escapeHtml(item.symbol)}"
           width="28" height="28" onerror="this.style.display='none'" />
      <div style="flex:1;min-width:0;">
        <div class="mover-name">${UI.escapeHtml(item.name)}</div>
        <div class="mover-symbol">${UI.escapeHtml(item.symbol?.toUpperCase())}</div>
      </div>
      <span class="mover-change ${isPos ? 'positive' : 'negative'}">${formatPct(item.changePct)}</span>
    `;
    row.addEventListener('click', () => openCoinDetail(item.coinId));
    list.appendChild(row);
  });
}

/* ── SECTION: Holdings ──────────────────────────────────────── */

function renderHoldings(holdings) {
  const tableWrapper = document.getElementById('holdings-table-wrapper');
  const mobileList   = document.getElementById('mobile-holdings');
  const emptyState   = document.getElementById('holdings-empty');

  if (holdings.length === 0) {
    tableWrapper.style.display = 'none';
    mobileList.style.display   = 'none';
    emptyState.style.display   = 'flex';
    return;
  }

  tableWrapper.style.display = '';
  mobileList.style.display   = '';
  emptyState.style.display   = 'none';

  // Sort holdings
  const sorted = sortHoldings([...holdings]);

  UI.updateSortHeaders(State.sortState);

  // ─ Desktop table rows ─
  const tbody = document.getElementById('holdings-tbody');
  tbody.innerHTML = '';

  sorted.forEach(h => {
    const market = State.priceMap.get(h.coinId);
    const price  = market?.current_price ?? h.buyPrice;
    const gl     = Portfolio.calcGainLoss(h, price);

    const tr = document.createElement('tr');
    tr.dataset.holdingId = h.id;
    if (State.deleteConfirm === h.id) tr.classList.add('confirm-delete');

    tr.innerHTML = `
      <td>${UI.coinCellHTML(h, market)}</td>
      <td class="num-col mono">${formatAmount(h.amount, 6)}</td>
      <td class="num-col mono">${formatUSD(h.buyPrice)}</td>
      <td class="num-col mono">${market ? formatUSD(price) : '<span class="dim">—</span>'}</td>
      <td class="num-col mono">${formatUSD(gl.value)}</td>
      <td class="num-col">${UI.gainCellHTML(gl)}</td>
      <td>
        <div class="actions-cell">
          ${State.deleteConfirm === h.id ? `
            <button class="btn btn-danger btn-xs action-btn confirm-btn" data-id="${h.id}" title="Confirm delete">Delete?</button>
            <button class="btn btn-ghost btn-xs action-btn cancel-btn" data-id="${h.id}" title="Cancel">Cancel</button>
          ` : `
            <button class="btn-icon action-btn edit-btn" data-id="${h.id}" title="Edit holding" aria-label="Edit ${h.name}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn-icon action-btn delete-btn" data-id="${h.id}" title="Delete holding" aria-label="Delete ${h.name}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          `}
        </div>
      </td>
    `;

    // Row click → open detail panel (not on action buttons)
    tr.addEventListener('click', (e) => {
      if (e.target.closest('.actions-cell')) return;
      openCoinDetail(h.coinId);
    });

    tbody.appendChild(tr);
  });

  // Bind action buttons
  bindTableActions(tbody);

  // ─ Mobile cards ─
  mobileList.innerHTML = '';
  sorted.forEach(h => {
    const market = State.priceMap.get(h.coinId);
    const price  = market?.current_price ?? h.buyPrice;
    const gl     = Portfolio.calcGainLoss(h, price);
    const glCls  = gl.dollar >= 0 ? 'positive' : 'negative';

    const card = document.createElement('div');
    card.className = 'mobile-holding-card';
    card.innerHTML = `
      <div class="mobile-holding-row">
        ${UI.coinCellHTML(h, market)}
        <span class="mono" style="font-size:16px;font-weight:600;">${formatUSD(gl.value)}</span>
      </div>
      <div class="mobile-holding-stats">
        <div>
          <div class="mobile-stat-label">Amount</div>
          <div class="mobile-stat-value">${formatAmount(h.amount, 4)}</div>
        </div>
        <div>
          <div class="mobile-stat-label">Avg Buy</div>
          <div class="mobile-stat-value">${formatUSD(h.buyPrice)}</div>
        </div>
        <div>
          <div class="mobile-stat-label">Current</div>
          <div class="mobile-stat-value">${market ? formatUSD(price) : '—'}</div>
        </div>
      </div>
      <div style="margin-top:10px;display:flex;align-items:center;justify-content:space-between;">
        <span class="mono ${glCls}" style="font-size:13px;">${formatUSD(gl.dollar)} (${formatPct(gl.percent)})</span>
        <div class="mobile-holding-actions">
          <button class="btn btn-ghost btn-xs edit-btn" data-id="${h.id}">Edit</button>
          <button class="btn btn-danger btn-xs delete-btn" data-id="${h.id}">Delete</button>
        </div>
      </div>
    `;

    card.querySelector('.coin-cell').addEventListener('click', () => openCoinDetail(h.coinId));
    mobileList.appendChild(card);
  });

  // Bind mobile action buttons
  bindTableActions(mobileList);
}

function sortHoldings(holdings) {
  const { col, dir } = State.sortState;
  return holdings.sort((a, b) => {
    let aVal, bVal;
    const mA = State.priceMap.get(a.coinId);
    const mB = State.priceMap.get(b.coinId);
    const prA = mA?.current_price ?? a.buyPrice;
    const prB = mB?.current_price ?? b.buyPrice;

    switch (col) {
      case 'name':         aVal = a.name?.toLowerCase();         bVal = b.name?.toLowerCase(); break;
      case 'amount':       aVal = a.amount;                      bVal = b.amount;               break;
      case 'buyPrice':     aVal = a.buyPrice;                    bVal = b.buyPrice;             break;
      case 'currentPrice': aVal = prA;                           bVal = prB;                    break;
      case 'value':        aVal = a.amount * prA;                bVal = b.amount * prB;         break;
      case 'gainLoss': {
        const glA = Portfolio.calcGainLoss(a, prA);
        const glB = Portfolio.calcGainLoss(b, prB);
        aVal = glA.dollar; bVal = glB.dollar; break;
      }
      default:             aVal = a.amount * prA;                bVal = b.amount * prB;
    }

    if (aVal < bVal) return dir === 'asc' ? -1 : 1;
    if (aVal > bVal) return dir === 'asc' ? 1  : -1;
    return 0;
  });
}

function bindTableActions(container) {
  container.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(btn.dataset.id);
    });
  });

  container.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      State.deleteConfirm = id;
      renderHoldings(Portfolio.getHoldings());
    });
  });

  container.querySelectorAll('.confirm-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      Portfolio.deleteHolding(btn.dataset.id);
      State.deleteConfirm = null;
      const holdings = Portfolio.getHoldings();
      renderHoldings(holdings);
      renderOverview(holdings, false);
    });
  });

  container.querySelectorAll('.cancel-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      State.deleteConfirm = null;
      renderHoldings(Portfolio.getHoldings());
    });
  });
}

/* ── SECTION: Watchlist ─────────────────────────────────────── */

function renderWatchlist(watchlist, initial) {
  const grid    = document.getElementById('watchlist-grid');
  const empty   = document.getElementById('watchlist-empty');
  if (!grid) return;

  // Destroy old sparklines before re-render
  Charts.destroyAllSparklines();
  grid.innerHTML = '';

  if (watchlist.length === 0) {
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  watchlist.forEach((w, idx) => {
    const market = State.priceMap.get(w.coinId);
    const price  = market?.current_price;
    const chg24  = market?.price_change_percentage_24h;
    const isPos  = (chg24 ?? 0) >= 0;
    const sparklineId = `sparkline-${w.coinId}`;

    const card = document.createElement('div');
    card.className = 'watchlist-card reveal';
    card.style.setProperty('--index', idx);
    card.dataset.coinId = w.coinId;

    card.innerHTML = `
      <div class="wc-header">
        <div class="wc-coin-info">
          <img class="wc-icon" src="${w.image || ''}" alt="${UI.escapeHtml(w.symbol)}"
               width="32" height="32" onerror="this.style.display='none'" />
          <div>
            <div class="wc-name">${UI.escapeHtml(w.name)}</div>
            <div class="wc-symbol">${UI.escapeHtml(w.symbol?.toUpperCase())}</div>
          </div>
        </div>
        <button class="wc-remove btn-icon" data-coin-id="${w.coinId}" aria-label="Remove ${UI.escapeHtml(w.name)} from watchlist" title="Remove from watchlist">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="wc-price mono">${price != null ? formatUSD(price) : '—'}</div>
      <div class="wc-change ${isPos ? 'positive' : 'negative'}">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          ${isPos ? '<polyline points="18 15 12 9 6 15"/>' : '<polyline points="6 9 12 15 18 9"/>'}
        </svg>
        ${chg24 != null ? formatPct(chg24) : '—'}
      </div>
      <canvas class="wc-sparkline" id="${sparklineId}" height="48"></canvas>
    `;

    // Remove button
    card.querySelector('.wc-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      Portfolio.removeFromWatchlist(w.coinId);
      Charts.destroySparkline(w.coinId);
      renderWatchlist(Portfolio.getWatchlist(), false);
    });

    // Card click → coin detail
    card.addEventListener('click', (e) => {
      if (e.target.closest('.wc-remove')) return;
      openCoinDetail(w.coinId);
    });

    grid.appendChild(card);

    // Render sparkline from market sparkline data
    if (market?.sparkline_in_7d?.price?.length) {
      // Defer slightly so DOM is ready
      setTimeout(() => {
        Charts.renderSparkline(sparklineId, market.sparkline_in_7d.price, w.coinId);
      }, 30);
    }
  });

  UI.observeNewRevealEls();
}

/* ── Coin Detail Panel ──────────────────────────────────────── */

async function openCoinDetail(coinId) {
  State.activeCoinId    = coinId;
  State.activePanelDays = 1;

  const market = State.priceMap.get(coinId);

  // Populate header immediately from cached market data
  if (market) {
    setEl('panel-coin-name',   market.name);
    setEl('panel-coin-symbol', market.symbol?.toUpperCase());
    setEl('panel-price',       formatUSD(market.current_price));
    const chg = market.price_change_percentage_24h || 0;
    const chgEl = document.getElementById('panel-price-change');
    chgEl.textContent  = formatPct(chg);
    chgEl.className    = `panel-price-change ${chg >= 0 ? 'positive' : 'negative'}`;

    const icon = document.getElementById('panel-coin-icon');
    if (icon) { icon.src = market.image || ''; icon.alt = market.symbol || ''; }

    setEl('stat-market-cap', formatBig(market.market_cap));
    setEl('stat-volume',     formatBig(market.total_volume));
    setEl('stat-ath',        formatUSD(market.ath));
    setEl('stat-supply',     formatSupply(market.circulating_supply) + ' ' + (market.symbol?.toUpperCase() || ''));
  }

  // Reset range tabs
  document.querySelectorAll('.range-tab').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.range) === 1);
    btn.setAttribute('aria-selected', parseInt(btn.dataset.range) === 1 ? 'true' : 'false');
  });

  UI.openPanel();

  // Load chart
  await loadDetailChart(coinId, 1);
}

async function loadDetailChart(coinId, days) {
  const loading = document.getElementById('chart-loading');
  if (loading) loading.style.display = 'flex';
  Charts.destroyDetailChart();

  try {
    const data = await CryptoAPI.getMarketChart(coinId, days);
    Charts.renderDetailChart(data, days);
  } catch (err) {
    console.error('[loadDetailChart] Error:', err);
    UI.showError('Failed to load chart data.', 4000);
  } finally {
    if (loading) loading.style.display = 'none';
  }
}

/* ── Modal: Add/Edit Holding ────────────────────────────────── */

let _editingId = null;

function openAddModal() {
  _editingId = null;
  resetModalForm();
  document.getElementById('modal-submit').textContent = 'Add Holding';
  UI.openModal('Add Holding');
}

function openEditModal(holdingId) {
  const holdings = Portfolio.getHoldings();
  const h = holdings.find(h => h.id === holdingId);
  if (!h) return;

  _editingId = holdingId;
  resetModalForm();

  // Pre-fill form
  document.getElementById('selected-coin-id').value     = h.coinId;
  document.getElementById('selected-coin-name').value   = h.name;
  document.getElementById('selected-coin-symbol').value = h.symbol;
  document.getElementById('coin-search-input').value    = `${h.name} (${h.symbol?.toUpperCase()})`;
  document.getElementById('coin-search-input').disabled = true;

  const display = document.getElementById('selected-coin-display');
  const iconEl  = document.getElementById('selected-coin-icon');
  const labelEl = document.getElementById('selected-coin-label');
  const market  = State.priceMap.get(h.coinId);
  const img     = market?.image || h.image || '';

  iconEl.src     = img;
  iconEl.alt     = h.symbol;
  labelEl.textContent = `${h.name} (${h.symbol?.toUpperCase()})`;
  display.style.display = 'flex';

  document.getElementById('holding-amount').value    = h.amount;
  document.getElementById('holding-buy-price').value = h.buyPrice;
  document.getElementById('holding-buy-date').value  = h.buyDate || '';

  document.getElementById('modal-submit').textContent = 'Save Changes';
  UI.openModal('Edit Holding');
}

function resetModalForm() {
  document.getElementById('holding-form').reset();
  document.getElementById('selected-coin-id').value     = '';
  document.getElementById('selected-coin-name').value   = '';
  document.getElementById('selected-coin-symbol').value = '';
  document.getElementById('coin-search-input').disabled = false;
  document.getElementById('selected-coin-display').style.display = 'none';
  UI.hideDropdown('modal-coin-dropdown');
}

/* ── Event wiring ───────────────────────────────────────────── */

function wireNavigation() {
  UI.initTabs((tabName) => {
    // Re-render active section when switched
    const holdings  = Portfolio.getHoldings();
    const watchlist = Portfolio.getWatchlist();
    if (tabName === 'overview')  renderOverview(holdings, false);
    if (tabName === 'holdings')  renderHoldings(holdings);
    if (tabName === 'watchlist') renderWatchlist(watchlist, false);
  });
}

function wireModal() {
  // Open buttons
  document.getElementById('btn-add-holding')?.addEventListener('click', openAddModal);
  document.getElementById('btn-add-holding-empty')?.addEventListener('click', openAddModal);

  // Close
  document.getElementById('modal-close')?.addEventListener('click', UI.closeModal);
  document.getElementById('modal-cancel')?.addEventListener('click', UI.closeModal);
  document.getElementById('modal-backdrop')?.addEventListener('click', UI.closeModal);

  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      UI.closeModal();
      UI.closePanel();
    }
  });

  // Form submission
  document.getElementById('holding-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleHoldingSubmit();
  });

  // Coin search inside modal
  const coinSearchInput = document.getElementById('coin-search-input');
  const modalDropdown   = document.getElementById('modal-coin-dropdown');
  const modalSpinner    = document.getElementById('modal-search-spinner');

  coinSearchInput?.addEventListener('input', async () => {
    const q = coinSearchInput.value.trim();
    if (q.length < 2) { UI.hideDropdown('modal-coin-dropdown'); return; }

    modalSpinner.style.display = 'flex';
    try {
      const results = await CryptoAPI.searchCoins(q);
      const existingIds = Portfolio.getHoldings().map(h => h.coinId);
      UI.renderDropdown(modalDropdown, results, existingIds, (coin) => {
        document.getElementById('selected-coin-id').value     = coin.id;
        document.getElementById('selected-coin-name').value   = coin.name;
        document.getElementById('selected-coin-symbol').value = coin.symbol;
        coinSearchInput.value = '';

        const display = document.getElementById('selected-coin-display');
        document.getElementById('selected-coin-icon').src     = coin.thumb || '';
        document.getElementById('selected-coin-icon').alt     = coin.symbol;
        document.getElementById('selected-coin-label').textContent = `${coin.name} (${coin.symbol?.toUpperCase()})`;
        display.style.display = 'flex';
      });
    } catch {
      UI.showError('Search failed. Check your connection.', 3000);
    } finally {
      modalSpinner.style.display = 'none';
    }
  });

  // Clear coin selection
  document.getElementById('clear-coin-selection')?.addEventListener('click', () => {
    document.getElementById('selected-coin-id').value     = '';
    document.getElementById('selected-coin-name').value   = '';
    document.getElementById('selected-coin-symbol').value = '';
    document.getElementById('coin-search-input').value    = '';
    document.getElementById('coin-search-input').disabled = false;
    document.getElementById('selected-coin-display').style.display = 'none';
    coinSearchInput.focus();
  });
}

async function handleHoldingSubmit() {
  const coinId   = document.getElementById('selected-coin-id').value.trim();
  const coinName = document.getElementById('selected-coin-name').value.trim();
  const symbol   = document.getElementById('selected-coin-symbol').value.trim();
  const amount   = parseFloat(document.getElementById('holding-amount').value);
  const buyPrice = parseFloat(document.getElementById('holding-buy-price').value);
  const buyDate  = document.getElementById('holding-buy-date').value;

  if (!coinId)      return UI.showError('Please select a coin.', 3000);
  if (isNaN(amount) || amount <= 0) return UI.showError('Enter a valid amount.', 3000);
  if (isNaN(buyPrice) || buyPrice <= 0) return UI.showError('Enter a valid buy price.', 3000);

  const market = State.priceMap.get(coinId);
  const image  = market?.image || '';

  const data = { coinId, name: coinName, symbol, image, amount, buyPrice, buyDate };

  if (_editingId) {
    Portfolio.updateHolding(_editingId, data);
  } else {
    Portfolio.addHolding(data);
  }

  UI.closeModal();

  // Refresh to get fresh price for new coin if not already in map
  await refreshAll(false);
}

function wirePanel() {
  document.getElementById('panel-close')?.addEventListener('click', UI.closePanel);
  document.getElementById('coin-detail-backdrop')?.addEventListener('click', UI.closePanel);

  // Range tabs
  document.querySelectorAll('.range-tab').forEach(btn => {
    btn.addEventListener('click', async () => {
      const days = parseInt(btn.dataset.range);
      if (days === State.activePanelDays) return;

      State.activePanelDays = days;
      document.querySelectorAll('.range-tab').forEach(b => {
        const active = parseInt(b.dataset.range) === days;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active);
      });

      if (State.activeCoinId) await loadDetailChart(State.activeCoinId, days);
    });
  });
}

function wireErrorBanner() {
  document.getElementById('error-close')?.addEventListener('click', UI.hideError);
}

function wireDemoControls() {
  document.getElementById('btn-clear-demo')?.addEventListener('click', async () => {
    const confirmed = window.confirm('Clear all demo data and start fresh?');
    if (!confirmed) return;

    Portfolio.clearDemoData();
    CryptoAPI.clearCache();
    Charts.destroyAllSparklines();

    UI.hideDemoControls();
    await refreshAll(true);
  });
}

function wireTableSort() {
  document.querySelectorAll('.data-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (State.sortState.col === col) {
        State.sortState.dir = State.sortState.dir === 'asc' ? 'desc' : 'asc';
      } else {
        State.sortState.col = col;
        State.sortState.dir = 'desc';
      }
      renderHoldings(Portfolio.getHoldings());
    });
  });
}

function wireWatchlistSearch() {
  const input    = document.getElementById('watchlist-search');
  const dropdown = document.getElementById('watchlist-dropdown');
  const spinner  = document.getElementById('search-spinner');

  input?.addEventListener('input', async () => {
    const q = input.value.trim();
    if (q.length < 2) { UI.hideDropdown('watchlist-dropdown'); return; }

    spinner.style.display = 'flex';
    try {
      const results = await CryptoAPI.searchCoins(q);
      const existingIds = Portfolio.getWatchlist().map(w => w.coinId);
      UI.renderDropdown(dropdown, results, existingIds, (coin) => {
        Portfolio.addToWatchlist({
          coinId: coin.id,
          name:   coin.name,
          symbol: coin.symbol,
          image:  coin.thumb || '',
        });
        input.value = '';
        UI.hideDropdown('watchlist-dropdown');
        refreshAll(false);
      });
    } catch {
      UI.showError('Search failed.', 3000);
    } finally {
      spinner.style.display = 'none';
    }
  });
}

function wireGlobalDismiss() {
  // Click outside a dropdown hides it
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrapper') && !e.target.closest('.form-group')) {
      UI.hideDropdown('watchlist-dropdown');
      UI.hideDropdown('modal-coin-dropdown');
    }
    // Click outside confirm-delete resets it
    if (!e.target.closest('[data-holding-id]') && !e.target.closest('.confirm-btn') && !e.target.closest('.cancel-btn')) {
      if (State.deleteConfirm) {
        State.deleteConfirm = null;
        renderHoldings(Portfolio.getHoldings());
      }
    }
  });
}

/* ── DOM helpers ─────────────────────────────────────────────── */

function setEl(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function colorEl(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('positive', 'negative');
  if (value > 0)  el.classList.add('positive');
  if (value < 0)  el.classList.add('negative');
}
