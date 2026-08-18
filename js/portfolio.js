/* ============================================================
   portfolio.js — LocalStorage CRUD for holdings + watchlist
   Demo seed logic (BTC/ETH/SOL). Computed gain/loss helpers.
   ============================================================ */

const Portfolio = (() => {

  /* ── Storage keys ──────────────────────────────────────────── */
  const HOLDINGS_KEY = 'cryptasca_holdings';
  const WATCHLIST_KEY = 'cryptasca_watchlist';
  const DEMO_KEY = 'cryptasca_demo_seeded';

  /* ── Demo seed data ─────────────────────────────────────────── */
  // Uses real CoinGecko IDs. Amounts/prices are illustrative.
  const DEMO_HOLDINGS = [
    {
      coinId:  'bitcoin',
      name:    'Bitcoin',
      symbol:  'BTC',
      image:   'https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png',
      amount:  0.5,
      buyPrice: 42500,
      buyDate: '2024-01-15',
      isDemo:  true,
    },
    {
      coinId:  'ethereum',
      name:    'Ethereum',
      symbol:  'ETH',
      image:   'https://coin-images.coingecko.com/coins/images/279/large/ethereum.png',
      amount:  3.2,
      buyPrice: 2450,
      buyDate: '2024-02-01',
      isDemo:  true,
    },
    {
      coinId:  'solana',
      name:    'Solana',
      symbol:  'SOL',
      image:   'https://coin-images.coingecko.com/coins/images/4128/large/solana.png',
      amount:  25,
      buyPrice: 98,
      buyDate: '2024-03-10',
      isDemo:  true,
    },
  ];

  const DEMO_WATCHLIST = [
    {
      coinId: 'bitcoin',
      name:   'Bitcoin',
      symbol: 'BTC',
      image:  'https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png',
    },
    {
      coinId: 'ethereum',
      name:   'Ethereum',
      symbol: 'ETH',
      image:  'https://coin-images.coingecko.com/coins/images/279/large/ethereum.png',
    },
    {
      coinId: 'solana',
      name:   'Solana',
      symbol: 'SOL',
      image:  'https://coin-images.coingecko.com/coins/images/4128/large/solana.png',
    },
  ];

  /* ── ID generator ───────────────────────────────────────────── */
  function genId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
  }

  /* ── Safe JSON read from localStorage ──────────────────────── */
  function readLS(key, fallback = []) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  /* ── Holdings CRUD ──────────────────────────────────────────── */

  function getHoldings() {
    return readLS(HOLDINGS_KEY, []);
  }

  function _saveHoldings(holdings) {
    localStorage.setItem(HOLDINGS_KEY, JSON.stringify(holdings));
  }

  /**
   * Add a new holding.
   * @param {{ coinId, name, symbol, image, amount, buyPrice, buyDate }} data
   * @returns {object} The created holding with its generated id
   */
  function addHolding(data) {
    const holdings = getHoldings();
    const holding = { ...data, id: genId() };
    holdings.push(holding);
    _saveHoldings(holdings);
    return holding;
  }

  /**
   * Update a holding by id.
   * @param {string} id
   * @param {Partial<object>} patch
   * @returns {object|null}
   */
  function updateHolding(id, patch) {
    const holdings = getHoldings();
    const idx = holdings.findIndex(h => h.id === id);
    if (idx === -1) return null;
    holdings[idx] = { ...holdings[idx], ...patch };
    _saveHoldings(holdings);
    return holdings[idx];
  }

  /**
   * Delete a holding by id.
   * @param {string} id
   */
  function deleteHolding(id) {
    _saveHoldings(getHoldings().filter(h => h.id !== id));
  }

  /* ── Watchlist CRUD ─────────────────────────────────────────── */

  function getWatchlist() {
    return readLS(WATCHLIST_KEY, []);
  }

  function _saveWatchlist(list) {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
  }

  /**
   * Add a coin to the watchlist (no-op if already there).
   * @param {{ coinId, name, symbol, image }} coin
   */
  function addToWatchlist(coin) {
    const list = getWatchlist();
    if (list.find(w => w.coinId === coin.coinId)) return; // already in list
    list.push({ coinId: coin.coinId, name: coin.name, symbol: coin.symbol, image: coin.image || '' });
    _saveWatchlist(list);
  }

  /**
   * Remove a coin from the watchlist.
   * @param {string} coinId
   */
  function removeFromWatchlist(coinId) {
    _saveWatchlist(getWatchlist().filter(w => w.coinId !== coinId));
  }

  /**
   * Check if a coin is already in the watchlist.
   * @param {string} coinId
   */
  function isWatched(coinId) {
    return getWatchlist().some(w => w.coinId === coinId);
  }

  /* ── Computed helpers ───────────────────────────────────────── */

  /**
   * Calculate gain/loss for a single holding given its current market price.
   * @param {object} holding
   * @param {number} currentPrice
   * @returns {{ dollar, percent, value, costBasis }}
   */
  function calcGainLoss(holding, currentPrice) {
    const costBasis = holding.amount * holding.buyPrice;
    const value = holding.amount * currentPrice;
    const dollar = value - costBasis;
    const percent = costBasis > 0 ? (dollar / costBasis) * 100 : 0;
    return { dollar, percent, value, costBasis };
  }

  /**
   * Calculate the 24h portfolio change %.
   * Strategy: compare current value vs. value 24h ago (derived from
   * each coin's price_change_percentage_24h from the markets endpoint).
   * @param {object[]} holdings
   * @param {Map<string, object>} priceMap  coinId → market data object
   * @returns {{ dollar, percent }}
   */
  function calcPortfolio24h(holdings, priceMap) {
    let currentTotal = 0;
    let past24hTotal = 0;

    for (const h of holdings) {
      const market = priceMap.get(h.coinId);
      if (!market) continue;
      const currentPrice = market.current_price || 0;
      const changePct = market.price_change_percentage_24h || 0;
      const price24hAgo = currentPrice / (1 + changePct / 100);
      currentTotal += h.amount * currentPrice;
      past24hTotal += h.amount * price24hAgo;
    }

    const dollar = currentTotal - past24hTotal;
    const percent = past24hTotal > 0 ? (dollar / past24hTotal) * 100 : 0;
    return { dollar, percent };
  }

  /* ── Demo data management ───────────────────────────────────── */

  /**
   * Seed demo data on first run.
   * @returns {boolean} true if seeded now, false if already done
   */
  function seedDemoData() {
    if (localStorage.getItem(DEMO_KEY)) return false;

    const seededHoldings = DEMO_HOLDINGS.map(h => ({ ...h, id: genId() }));
    _saveHoldings(seededHoldings);
    _saveWatchlist([...DEMO_WATCHLIST]);
    localStorage.setItem(DEMO_KEY, '1');
    return true;
  }

  /**
   * Clear all portfolio data including demo flag.
   */
  function clearDemoData() {
    localStorage.removeItem(HOLDINGS_KEY);
    localStorage.removeItem(WATCHLIST_KEY);
    localStorage.removeItem(DEMO_KEY);
  }

  /**
   * Whether demo data was previously seeded.
   */
  function isDemoSeeded() {
    return !!localStorage.getItem(DEMO_KEY);
  }

  /* ── Public API ─────────────────────────────────────────────── */
  return {
    // Holdings
    getHoldings, addHolding, updateHolding, deleteHolding,
    // Watchlist
    getWatchlist, addToWatchlist, removeFromWatchlist, isWatched,
    // Computed
    calcGainLoss, calcPortfolio24h,
    // Demo
    seedDemoData, clearDemoData, isDemoSeeded,
  };

})();
