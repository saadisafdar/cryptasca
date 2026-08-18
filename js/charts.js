/* ============================================================
   charts.js — Chart.js v4 wrappers for Cryptasca
   Donut (allocation), Line (price history), Sparkline (watchlist)
   ============================================================ */

const Charts = (() => {

  /* ── Chart instances (kept for destroy/re-render) ───────────── */
  let _allocationChart = null;
  let _detailChart = null;
  const _sparklineCharts = new Map(); // coinId → Chart instance

  /* ── Design tokens mirrored from CSS ───────────────────────── */
  const COLORS = {
    accent:      '#D4FF61',
    loss:        '#E05252',
    surface:     '#1C2B27',
    base:        '#0B1210',
    textPrimary: '#E8F2E9',
    textSecond:  '#8FA89A',
    textTert:    '#4D6560',
    border:      'rgba(255,255,255,0.06)',
    borderStr:   'rgba(255,255,255,0.11)',
    tooltipBg:   '#1C2B27',
    fontMono:    "'DM Mono', 'SF Mono', monospace",
  };

  /* ── Allocation palette — graduated greens + accent ─────────── */
  const ALLOC_PALETTE = [
    'rgba(212, 255,  97, 0.90)', // bright accent
    'rgba(212, 255,  97, 0.55)', // dimmed accent
    'rgba( 80, 200, 140, 0.80)', // teal-green
    'rgba( 55, 160, 110, 0.75)',
    'rgba( 40, 130,  90, 0.70)',
    'rgba( 30, 100,  75, 0.65)',
    'rgba( 22,  78,  60, 0.60)',
    'rgba( 16,  60,  48, 0.55)',
  ];

  /* ── Shared tooltip config ───────────────────────────────────── */
  const TOOLTIP_BASE = {
    backgroundColor:  COLORS.tooltipBg,
    titleColor:       COLORS.textSecond,
    bodyColor:        COLORS.textPrimary,
    borderColor:      COLORS.borderStr,
    borderWidth:      1,
    padding:          { x: 12, y: 9 },
    cornerRadius:     8,
    displayColors:    false,
  };

  /* ── Label formatter for time axis (no date adapter needed) ─── */
  function fmtAxisLabel(timestamp, days) {
    const d = new Date(timestamp);
    if (days <= 1)   return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    if (days <= 7)   return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    if (days <= 30)  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }

  /* ── Allocation Donut ────────────────────────────────────────── */

  /**
   * Render the portfolio allocation donut chart.
   * @param {{ label: string, value: number, color?: string }[]} items
   */
  function renderAllocationChart(items) {
    const canvas = document.getElementById('allocation-chart');
    if (!canvas) return;

    if (_allocationChart) {
      _allocationChart.destroy();
      _allocationChart = null;
    }

    if (!items || items.length === 0) {
      document.getElementById('donut-wrapper').style.display = 'none';
      document.getElementById('donut-empty').style.display = 'flex';
      return;
    }

    document.getElementById('donut-wrapper').style.display = 'flex';
    document.getElementById('donut-empty').style.display = 'none';

    const total = items.reduce((s, i) => s + i.value, 0);
    const colors = items.map((_, idx) => ALLOC_PALETTE[idx % ALLOC_PALETTE.length]);

    _allocationChart = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: items.map(i => i.label),
        datasets: [{
          data:                 items.map(i => i.value),
          backgroundColor:      colors,
          borderWidth:          2,
          borderColor:          COLORS.base,
          hoverBorderColor:     COLORS.base,
          hoverBorderWidth:     3,
          hoverOffset:          6,
        }],
      },
      options: {
        cutout: '72%',
        responsive: true,
        maintainAspectRatio: true,
        animation: { duration: 700, easing: 'easeInOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TOOLTIP_BASE,
            callbacks: {
              label: (ctx) => {
                const pct = ((ctx.raw / total) * 100).toFixed(1);
                return `  ${ctx.label}: ${pct}% (${formatUSD(ctx.raw, true)})`;
              },
            },
          },
        },
      },
    });

    // Render custom legend
    _renderDonutLegend(items, total, colors);
    return _allocationChart;
  }

  function _renderDonutLegend(items, total, colors) {
    const legend = document.getElementById('donut-legend');
    if (!legend) return;
    legend.innerHTML = items.map((item, i) => `
      <div class="legend-item">
        <span class="legend-dot" style="background:${colors[i]}"></span>
        <span class="legend-label">${item.label}</span>
        <span class="legend-pct">${((item.value / total) * 100).toFixed(1)}%</span>
      </div>
    `).join('');
  }

  /* ── Price History Line Chart ────────────────────────────────── */

  /**
   * Render the coin detail price history chart.
   * @param {{ prices: [number, number][] }} marketChartData
   * @param {number} days
   */
  function renderDetailChart(marketChartData, days) {
    const canvas = document.getElementById('detail-chart');
    if (!canvas) return;

    if (_detailChart) {
      _detailChart.destroy();
      _detailChart = null;
    }

    const prices = marketChartData.prices || [];
    if (prices.length === 0) return;

    const timestamps = prices.map(([ts]) => ts);
    const values     = prices.map(([, v]) => v);
    const isPositive = values[values.length - 1] >= values[0];
    const lineColor  = isPositive ? COLORS.accent : COLORS.loss;

    // Gradient fill
    const createGradient = (ctx, chartArea) => {
      const grad = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
      if (isPositive) {
        grad.addColorStop(0, 'rgba(212,255,97,0.18)');
        grad.addColorStop(1, 'rgba(212,255,97,0)');
      } else {
        grad.addColorStop(0, 'rgba(224,82,82,0.18)');
        grad.addColorStop(1, 'rgba(224,82,82,0)');
      }
      return grad;
    };

    // Formatted axis labels (avoids needing a date adapter)
    const axisLabels = timestamps.map(ts => fmtAxisLabel(ts, days));

    // Thin out data for performance on large ranges (1y can have 365+ points)
    const MAX_POINTS = 200;
    let sampledLabels = axisLabels;
    let sampledValues = values;
    let sampledTs     = timestamps;
    if (values.length > MAX_POINTS) {
      const step = Math.ceil(values.length / MAX_POINTS);
      sampledLabels = axisLabels.filter((_, i) => i % step === 0 || i === values.length - 1);
      sampledValues = values.filter((_, i) => i % step === 0 || i === values.length - 1);
      sampledTs     = timestamps.filter((_, i) => i % step === 0 || i === values.length - 1);
    }

    _detailChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: sampledLabels,
        datasets: [{
          data: sampledValues,
          borderColor: lineColor,
          borderWidth: 2,
          backgroundColor: (ctx) => {
            const { chart } = ctx;
            const { chartArea } = chart;
            if (!chartArea) return 'transparent';
            return createGradient(chart.ctx, chartArea);
          },
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: lineColor,
          pointHoverBorderColor: COLORS.base,
          pointHoverBorderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 500, easing: 'easeInOutQuart' },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TOOLTIP_BASE,
            callbacks: {
              title: (items) => items[0]?.label || '',
              label: (ctx) => `  Price: ${formatUSD(ctx.raw)}`,
            },
          },
        },
        scales: {
          x: {
            grid:  { display: false },
            border: { display: false },
            ticks: {
              color:        COLORS.textTert,
              font:         { family: COLORS.fontMono, size: 10 },
              maxTicksLimit: 5,
              maxRotation:  0,
            },
          },
          y: {
            position: 'right',
            grid: {
              color:       'rgba(255,255,255,0.04)',
              drawBorder:  false,
            },
            border: { display: false },
            ticks: {
              color:        COLORS.textTert,
              font:         { family: COLORS.fontMono, size: 10 },
              callback:     (v) => '$' + formatCompact(v),
              maxTicksLimit: 5,
            },
          },
        },
      },
    });
  }

  /* ── Sparkline (watchlist cards) ─────────────────────────────── */

  /**
   * Render a sparkline on a canvas element.
   * @param {string} canvasId    The <canvas> element ID
   * @param {number[]} values    7-day hourly price array
   * @param {string} coinId      Used for instance registry
   */
  function renderSparkline(canvasId, values, coinId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    // Destroy existing instance
    if (_sparklineCharts.has(coinId)) {
      _sparklineCharts.get(coinId).destroy();
      _sparklineCharts.delete(coinId);
    }

    if (!values || values.length === 0) return;

    const isPositive = values[values.length - 1] >= values[0];

    const chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: values.map((_, i) => i),
        datasets: [{
          data: values,
          borderColor: isPositive ? COLORS.accent : COLORS.loss,
          borderWidth: 1.5,
          fill: false,
          tension: 0.4,
          pointRadius: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 350 },
        plugins: {
          legend:  { display: false },
          tooltip: { enabled: false },
        },
        scales: {
          x: { display: false },
          y: { display: false },
        },
      },
    });

    _sparklineCharts.set(coinId, chart);
  }

  /**
   * Destroy a specific sparkline instance.
   * @param {string} coinId
   */
  function destroySparkline(coinId) {
    if (_sparklineCharts.has(coinId)) {
      _sparklineCharts.get(coinId).destroy();
      _sparklineCharts.delete(coinId);
    }
  }

  /**
   * Destroy all sparklines (on full re-render).
   */
  function destroyAllSparklines() {
    _sparklineCharts.forEach(c => c.destroy());
    _sparklineCharts.clear();
  }

  /**
   * Destroy the detail chart if open.
   */
  function destroyDetailChart() {
    if (_detailChart) {
      _detailChart.destroy();
      _detailChart = null;
    }
  }

  /* ── Public API ─────────────────────────────────────────────── */
  return {
    renderAllocationChart,
    renderDetailChart,
    renderSparkline,
    destroySparkline,
    destroyAllSparklines,
    destroyDetailChart,
  };

})();
