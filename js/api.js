/* ============================================================
   api.js — CoinGecko API wrappers + in-memory cache
   Global formatters defined here (loaded first).
   ============================================================ */

/* ── Global Formatters ──────────────────────────────────────── */

/**
 * Format a number as USD. Adapts precision to magnitude.
 * @param {number} n
 * @param {boolean} compact  Use B/M shorthand for large numbers
 */
function formatUSD(n, compact = false) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';

  if (compact) {
    if (abs >= 1e12) return sign + '$' + (abs / 1e12).toFixed(2) + 'T';
    if (abs >= 1e9)  return sign + '$' + (abs / 1e9).toFixed(2)  + 'B';
    if (abs >= 1e6)  return sign + '$' + (abs / 1e6).toFixed(2)  + 'M';
    if (abs >= 1e3)  return sign + '$' + (abs / 1e3).toFixed(1)  + 'K';
  }

  if (abs >= 1000) return sign + '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (abs >= 1)    return sign + '$' + abs.toFixed(2);
  if (abs >= 0.01) return sign + '$' + abs.toFixed(4);
  if (abs >= 0.0001) return sign + '$' + abs.toFixed(6);
  return sign + '$' + abs.toFixed(8);
}

/**
 * Format a percentage with leading + for positive values.
 * @param {number} n
 */
function formatPct(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

/**
 * Format a token amount — strips unnecessary trailing zeros.
 * @param {number} n
 * @param {number} maxDecimals
 */
function formatAmount(n, maxDecimals = 8) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const formatted = parseFloat(n.toFixed(maxDecimals)).toString();
  return formatted;
}

/**
 * Compact number without currency symbol (for axis ticks).
 * @param {number} n
 */
function formatCompact(n) {
  const abs = Math.abs(n);
  if (abs >= 1e9)  return (n / 1e9).toFixed(1) + 'B';
  if (abs >= 1e6)  return (n / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3)  return (n / 1e3).toFixed(0) + 'K';
  if (abs >= 1)    return n.toFixed(2);
  if (abs >= 0.01) return n.toFixed(4);
  return n.toFixed(6);
}

/**
 * Format a large number (market cap, volume, supply) compactly.
 * @param {number} n
 */
function formatBig(n) {
  if (!n) return '—';
  if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return '$' + (n / 1e9).toFixed(2)  + 'B';
  if (n >= 1e6)  return '$' + (n / 1e6).toFixed(2)  + 'M';
  return '$' + n.toLocaleString('en-US');
}

/**
 * Format supply (no $ symbol).
 * @param {number} n
 */
function formatSupply(n) {
  if (!n) return '—';
  if (n >= 1e9)  return (n / 1e9).toFixed(2)  + 'B';
  if (n >= 1e6)  return (n / 1e6).toFixed(2)  + 'M';
  if (n >= 1e3)  return (n / 1e3).toFixed(2)  + 'K';
  return n.toLocaleString('en-US');
}

/* ── CryptoAPI Module ───────────────────────────────────────── */

const CryptoAPI = (() => {
  const BASE = 'https://api.coingecko.com/api/v3';
  const cache = new Map(); // key → { data, timestamp }
  const CACHE_TTL = 55_000; // 55 seconds — slightly under 60s refresh

  /**
   * Check if a cached entry is still valid.
   */
  function isValid(key) {
    if (!cache.has(key)) return false;
    return (Date.now() - cache.get(key).timestamp) < CACHE_TTL;
  }

  /**
   * Fetch with cache. Serves stale on error.
   */
  async function fetchCached(url, key) {
    if (isValid(key)) return cache.get(key).data;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
      const data = await res.json();
      cache.set(key, { data, timestamp: Date.now() });
      return data;
    } catch (err) {
      // Serve stale if available, otherwise re-throw
      if (cache.has(key)) {
        console.warn('[CryptoAPI] Serving stale cache for', key);
        return cache.get(key).data;
      }
      throw err;
    }
  }

  /**
   * Get market data for a batch of coin IDs.
   * Uses /coins/markets — the rate-limit-friendly batch endpoint.
   * @param {string[]} ids
   */
  async function getMarkets(ids) {
    if (!ids || ids.length === 0) return [];
    const key = 'markets:' + ids.slice().sort().join(',');
    const url = `${BASE}/coins/markets`
      + `?vs_currency=usd`
      + `&ids=${ids.join(',')}`
      + `&order=market_cap_desc`
      + `&per_page=250`
      + `&page=1`
      + `&sparkline=true`
      + `&price_change_percentage=24h`;
    return fetchCached(url, key);
  }

  /**
   * Get historical price data for a coin.
   * @param {string} id   CoinGecko coin ID
   * @param {number} days  1 | 7 | 30 | 365
   */
  async function getMarketChart(id, days) {
    const key = `chart:${id}:${days}`;
    // Force daily data for ranges > 90 days
    const interval = days > 90 ? '&interval=daily' : '';
    const url = `${BASE}/coins/${id}/market_chart?vs_currency=usd&days=${days}${interval}`;
    return fetchCached(url, key);
  }

  let _searchTimer = null;

  /**
   * Search coins by query (debounced 380ms).
   * @param {string} query
   * @returns {Promise<Array>}
   */
  function searchCoins(query) {
    return new Promise((resolve, reject) => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(async () => {
        try {
          const url = `${BASE}/search?query=${encodeURIComponent(query)}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`Search HTTP ${res.status}`);
          const data = await res.json();
          resolve(data.coins || []);
        } catch (err) {
          reject(err);
        }
      }, 380);
    });
  }

  /**
   * Force-invalidate all cache entries (used after clearing demo data).
   */
  function clearCache() {
    cache.clear();
  }

  return { getMarkets, getMarketChart, searchCoins, clearCache };
})();
