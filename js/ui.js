/* ============================================================
   ui.js — DOM helpers, tab routing, modal system,
           skeleton loaders, IntersectionObserver reveals,
           search dropdowns, count-up animation
   ============================================================ */

const UI = (() => {

  /* ── Count-up animation ──────────────────────────────────────── */

  let _countUpRaf = null;

  /**
   * Animate a numeric element from `from` to `to`.
   * @param {HTMLElement} el
   * @param {number} from
   * @param {number} to
   * @param {number} duration  ms
   * @param {function} formatter
   */
  function countUp(el, from, to, duration = 1100, formatter = (n) => n.toFixed(2)) {
    if (_countUpRaf) cancelAnimationFrame(_countUpRaf);
    const start = performance.now();

    function update(now) {
      const elapsed  = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Cubic ease-out
      const eased    = 1 - Math.pow(1 - progress, 3);
      el.textContent = formatter(from + (to - from) * eased);
      if (progress < 1) _countUpRaf = requestAnimationFrame(update);
    }

    _countUpRaf = requestAnimationFrame(update);
  }

  /* ── IntersectionObserver for .reveal elements ───────────────── */

  let _revealObserver = null;

  function initRevealObserver() {
    if ('IntersectionObserver' in window) {
      _revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            _revealObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.05, rootMargin: '0px 0px -24px 0px' });

      document.querySelectorAll('.reveal').forEach(el => _revealObserver.observe(el));
    } else {
      // Fallback: show everything
      document.querySelectorAll('.reveal').forEach(el => el.classList.add('revealed'));
    }
  }

  /**
   * Observe any newly added .reveal elements (after dynamic renders).
   */
  function observeNewRevealEls() {
    if (!_revealObserver) return;
    document.querySelectorAll('.reveal:not(.revealed)').forEach(el => {
      _revealObserver.observe(el);
    });
  }

  /* ── Tab navigation ──────────────────────────────────────────── */

  let _activeTab = 'overview';
  let _onTabChange = null; // callback(tabName)

  function initTabs(onChangeCallback) {
    _onTabChange = onChangeCallback;
    document.querySelectorAll('.nav-tab').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
  }

  function switchTab(tabName) {
    if (tabName === _activeTab) return;
    _activeTab = tabName;

    // Update nav tab states
    document.querySelectorAll('.nav-tab').forEach(btn => {
      const active = btn.dataset.tab === tabName;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active);
    });

    // Show/hide sections
    document.querySelectorAll('.tab-section').forEach(sec => {
      sec.classList.toggle('active', sec.id === `section-${tabName}`);
    });

    // Trigger reveal observer on newly visible section
    setTimeout(observeNewRevealEls, 50);

    if (_onTabChange) _onTabChange(tabName);
  }

  function getActiveTab() { return _activeTab; }

  /* ── Error banner ────────────────────────────────────────────── */

  let _errorTimer = null;

  function showError(message, autoDismissMs = 5000) {
    const banner = document.getElementById('error-banner');
    const msgEl  = document.getElementById('error-message');
    if (!banner) return;
    msgEl.textContent = message;
    banner.style.display = 'flex';
    clearTimeout(_errorTimer);
    if (autoDismissMs > 0) {
      _errorTimer = setTimeout(() => hideError(), autoDismissMs);
    }
  }

  function hideError() {
    const banner = document.getElementById('error-banner');
    if (banner) banner.style.display = 'none';
    clearTimeout(_errorTimer);
  }

  /* ── Refresh time badge ──────────────────────────────────────── */

  function updateRefreshBadge() {
    const el = document.getElementById('refresh-time');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  /* ── Modal ───────────────────────────────────────────────────── */

  function openModal(titleText) {
    const modal    = document.getElementById('holding-modal');
    const backdrop = document.getElementById('modal-backdrop');
    if (!modal) return;

    document.getElementById('modal-title').textContent = titleText || 'Add Holding';
    modal.style.display    = 'block';
    backdrop.style.display = 'block';
    // Trigger transition
    requestAnimationFrame(() => {
      modal.classList.add('open');
      backdrop.classList.add('open');
    });

    // Trap focus
    setTimeout(() => modal.querySelector('input, button')?.focus(), 100);
  }

  function closeModal() {
    const modal    = document.getElementById('holding-modal');
    const backdrop = document.getElementById('modal-backdrop');
    if (!modal) return;

    modal.classList.remove('open');
    backdrop.classList.remove('open');
    setTimeout(() => {
      modal.style.display    = 'none';
      backdrop.style.display = 'none';
    }, 280);
  }

  /* ── Coin Detail Slide Panel ─────────────────────────────────── */

  function openPanel() {
    const panel    = document.getElementById('coin-detail-panel');
    const backdrop = document.getElementById('coin-detail-backdrop');
    if (!panel) return;

    panel.style.display = 'flex';
    requestAnimationFrame(() => {
      panel.classList.add('open');
      backdrop.classList.add('open');
    });
  }

  function closePanel() {
    const panel    = document.getElementById('coin-detail-panel');
    const backdrop = document.getElementById('coin-detail-backdrop');
    if (!panel) return;

    panel.classList.remove('open');
    backdrop.classList.remove('open');
    setTimeout(() => {
      panel.style.display = 'none';
    }, 380);
  }

  /* ── Skeleton helpers ────────────────────────────────────────── */

  /**
   * Show skeleton placeholder text on an element.
   * @param {string} id
   * @param {string} skeletonClass  CSS class to apply
   */
  function showSkeleton(id, width = '80px', height = '16px') {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = `<span class="skeleton" style="display:inline-block;width:${width};height:${height};border-radius:4px;"></span>`;
  }

  /* ── Search dropdown ─────────────────────────────────────────── */

  /**
   * Render a search dropdown from CoinGecko search results.
   * @param {HTMLElement} dropdown   The dropdown container
   * @param {object[]} coins         Results from /search
   * @param {string[]} excludeIds    Coin IDs already in holdings/watchlist
   * @param {function} onSelect      Called with the selected coin object
   */
  function renderDropdown(dropdown, coins, excludeIds = [], onSelect) {
    if (!coins.length) {
      dropdown.innerHTML = '<div class="dropdown-empty">No coins found</div>';
      dropdown.style.display = 'block';
      return;
    }

    dropdown.innerHTML = coins.slice(0, 10).map(coin => {
      const alreadyAdded = excludeIds.includes(coin.id);
      return `
        <div class="dropdown-item${alreadyAdded ? ' already-added' : ''}"
             role="option"
             data-id="${coin.id}"
             data-name="${escapeHtml(coin.name)}"
             data-symbol="${escapeHtml(coin.symbol)}"
             data-thumb="${coin.thumb || ''}">
          <img class="dropdown-coin-icon"
               src="${coin.thumb || ''}"
               alt="${escapeHtml(coin.symbol)}"
               width="24" height="24"
               onerror="this.style.display='none'" />
          <span class="dropdown-coin-name">${escapeHtml(coin.name)}</span>
          <span class="dropdown-coin-symbol">${escapeHtml(coin.symbol?.toUpperCase())}</span>
          ${coin.market_cap_rank ? `<span class="dropdown-coin-rank">#${coin.market_cap_rank}</span>` : ''}
          ${alreadyAdded ? '<span style="font-size:11px;color:var(--text-tertiary)">Added</span>' : ''}
        </div>
      `;
    }).join('');

    dropdown.style.display = 'block';

    // Bind click events
    dropdown.querySelectorAll('.dropdown-item:not(.already-added)').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const coin = {
          id:     item.dataset.id,
          name:   item.dataset.name,
          symbol: item.dataset.symbol,
          thumb:  item.dataset.thumb,
        };
        onSelect(coin);
        dropdown.style.display = 'none';
      });
    });
  }

  function hideDropdown(dropdownId) {
    const el = document.getElementById(dropdownId);
    if (el) el.style.display = 'none';
  }

  /* ── Holdings table + mobile cards rendering ────────────────── */

  /**
   * Render a sort icon for a table header.
   * @param {string} col         Column key
   * @param {object} sortState   { col, dir }
   */
  function renderSortIcon(col, sortState) {
    if (sortState.col !== col) return '↕';
    return sortState.dir === 'asc' ? '↑' : '↓';
  }

  /**
   * Mark active sort column headers.
   * @param {object} sortState
   */
  function updateSortHeaders(sortState) {
    document.querySelectorAll('.data-table th.sortable').forEach(th => {
      const isActive = th.dataset.col === sortState.col;
      th.classList.toggle('sort-active', isActive);
      const icon = th.querySelector('.sort-icon');
      if (icon) icon.textContent = isActive
        ? (sortState.dir === 'asc' ? '↑' : '↓')
        : '↕';
    });
  }

  /**
   * Build a coin cell HTML fragment.
   * @param {object} h        Holding
   * @param {object} market   Market data (may be null)
   */
  function coinCellHTML(h, market) {
    const img = market?.image || h.image || '';
    return `
      <div class="coin-cell">
        <img class="coin-icon" src="${img}" alt="${escapeHtml(h.symbol)}" width="28" height="28"
             onerror="this.style.display='none'" />
        <div>
          <div class="coin-name">${escapeHtml(h.name)}</div>
          <div class="coin-symbol">${escapeHtml(h.symbol?.toUpperCase())}</div>
        </div>
      </div>
    `;
  }

  /**
   * Build a gain/loss cell HTML.
   * @param {{ dollar, percent }} gl
   */
  function gainCellHTML(gl) {
    const cls = gl.dollar >= 0 ? 'positive' : 'negative';
    return `
      <span class="gain-cell ${cls}">
        ${formatUSD(Math.abs(gl.dollar))}
        <span class="gain-pct">${formatPct(gl.percent)}</span>
      </span>
    `;
  }

  /* ── Utility: escape HTML ────────────────────────────────────── */

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /* ── Demo controls visibility ────────────────────────────────── */

  function showDemoControls() {
    const ctrl = document.getElementById('demo-controls');
    if (ctrl) ctrl.style.display = 'flex';
  }

  function hideDemoControls() {
    const ctrl = document.getElementById('demo-controls');
    if (ctrl) ctrl.style.display = 'none';
  }

  /* ── Public API ─────────────────────────────────────────────── */
  return {
    // Animations
    countUp,
    // Observer
    initRevealObserver,
    observeNewRevealEls,
    // Tabs
    initTabs,
    switchTab,
    getActiveTab,
    // Error
    showError,
    hideError,
    // Refresh badge
    updateRefreshBadge,
    // Modal
    openModal,
    closeModal,
    // Panel
    openPanel,
    closePanel,
    // Skeleton
    showSkeleton,
    // Dropdown
    renderDropdown,
    hideDropdown,
    // Table helpers
    renderSortIcon,
    updateSortHeaders,
    coinCellHTML,
    gainCellHTML,
    // Util
    escapeHtml,
    // Demo
    showDemoControls,
    hideDemoControls,
  };

})();
