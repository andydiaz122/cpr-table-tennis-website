/* ══════════════════════════════════════════════════════════════
   TradingView Lightweight Charts — Equity Curve
   APOLLO V9.0
   Data source: Supabase (real-time) with static JSON fallback.
   ══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var BASE_BANKROLL = 20000;
  var chartInstance = null;
  var seriesInstance = null;
  var pnlEl = null; // lazily queried in updatePnlDisplay

  function initChart(bets) {
    var container = document.getElementById('equity-chart');
    if (!container || typeof LightweightCharts === 'undefined') return;

    // Destroy previous chart if re-initializing
    if (chartInstance) {
      chartInstance.remove();
    }

    chartInstance = LightweightCharts.createChart(container, {
      width: container.clientWidth,
      height: 250,
      layout: {
        background: { color: '#0a0a0f' },
        textColor: '#8a8a96',
        fontSize: 11,
        fontFamily: "'Geist Mono', 'JetBrains Mono', monospace"
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false }
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(0, 212, 255, 0.15)',
          width: 1,
          style: LightweightCharts.LineStyle.Dashed,
          labelBackgroundColor: '#0a0a0f'
        },
        horzLine: {
          color: 'rgba(0, 212, 255, 0.15)',
          width: 1,
          style: LightweightCharts.LineStyle.Dashed,
          labelBackgroundColor: '#0a0a0f'
        }
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.06)',
        scaleMargins: { top: 0.1, bottom: 0.1 }
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.06)',
        timeVisible: true,
        secondsVisible: false
      },
      handleScroll: false,
      handleScale: false
    });

    seriesInstance = chartInstance.addSeries(
      LightweightCharts.AreaSeries,
      {
        lineColor: '#00d4ff',
        lineWidth: 2,
        topColor: 'rgba(0, 212, 255, 0.15)',
        bottomColor: 'rgba(0, 212, 255, 0.01)',
        crosshairMarkerBackgroundColor: '#00d4ff',
        crosshairMarkerBorderColor: '#00d4ff',
        crosshairMarkerRadius: 3,
        priceFormat: {
          type: 'custom',
          formatter: function (price) { return '$' + price.toFixed(2); }
        }
      }
    );

    setChartData(bets);

    // Resize handler
    var resizeObserver = new ResizeObserver(function (entries) {
      var entry = entries[0];
      if (entry && chartInstance) {
        chartInstance.applyOptions({ width: entry.contentRect.width });
      }
    });
    resizeObserver.observe(container);

    // Update header PnL on crosshair move
    chartInstance.subscribeCrosshairMove(function (param) {
      if (!param || !param.seriesData || !param.seriesData.size) {
        updatePnlDisplay(null);
        return;
      }
      var data = param.seriesData.get(seriesInstance);
      if (data) {
        updatePnlDisplay(data.value);
      }
    });
  }

  /**
   * Build chart data points from bets array.
   * Works with both Supabase bets (match_date, profit_loss) and
   * static JSON trades (date, cum_pnl).
   */
  function setChartData(bets) {
    if (!seriesInstance) return;

    var dataPoints = [];
    var seen = {};

    // Determine if this is Supabase data or static JSON
    var isSupabase = bets.length > 0 && ('match_date' in bets[0]);

    // Filter to ALL resolved bets (wins, losses, cashouts, voids — NOT pending)
    var resolved = bets.filter(function (b) {
      if (isSupabase) {
        return (b.is_win !== null && b.is_win !== undefined)
          || b.actual_winner === 'CASHOUT'
          || b.actual_winner === 'VOID';
      }
      return true; // Static JSON is already resolved
    });

    // Sort by date, then by id for stable ordering within same timestamp
    resolved.sort(function (a, b) {
      var dateA = isSupabase ? a.match_date : a.date;
      var dateB = isSupabase ? b.match_date : b.date;
      var timeDiff = new Date(dateA).getTime() - new Date(dateB).getTime();
      if (timeDiff !== 0) return timeDiff;
      // Stable sort by id within same timestamp
      return (a.id || 0) - (b.id || 0);
    });

    if (resolved.length === 0) {
      seriesInstance.setData([]);
      updatePnlDisplay(0);
      return;
    }

    // Baseline point (one day before first bet)
    var firstDate = isSupabase ? resolved[0].match_date : resolved[0].date;
    var baseTime = Math.floor(new Date(firstDate).getTime() / 1000) - 86400;
    dataPoints.push({ time: baseTime, value: 0 });

    // Build cumulative P&L series
    var cumPnl = 0;
    resolved.forEach(function (bet) {
      var dateStr = isSupabase ? bet.match_date : bet.date;
      var ts = Math.floor(new Date(dateStr).getTime() / 1000);

      if (isSupabase) {
        cumPnl += (Number(bet.profit_loss) || 0);
        dataPoints.push({ time: ts, value: cumPnl });
      } else {
        dataPoints.push({ time: ts, value: bet.cum_pnl });
      }
    });

    // Sort all points by time, then enforce strictly ascending timestamps.
    // TradingView Lightweight Charts silently drops points with duplicate
    // or non-ascending timestamps. Many BetOnline bets share the same
    // date-only timestamp (16:00:00 UTC), so we must separate them.
    dataPoints.sort(function (a, b) { return a.time - b.time; });
    for (var i = 1; i < dataPoints.length; i++) {
      if (dataPoints[i].time <= dataPoints[i - 1].time) {
        dataPoints[i].time = dataPoints[i - 1].time + 1;
      }
    }

    seriesInstance.setData(dataPoints);

    // ── Event Row Badges (TradingView earnings-style) ──────
    renderEventBadges(dataPoints);

    chartInstance.timeScale().fitContent();

    // Update header with latest value
    var lastVal = dataPoints[dataPoints.length - 1].value;
    updatePnlDisplay(lastVal);
  }

  /**
   * Append a single new data point (for real-time updates).
   */
  function appendDataPoint(bet) {
    if (!seriesInstance) return;

    var ts = Math.floor(new Date(bet.match_date || bet.date).getTime() / 1000);
    // Note: for real-time, we need the cumulative PnL which requires
    // re-fetching. For now, trigger a full refresh.
    // This is called from the real-time subscription handler.
  }

  function updatePnlDisplay(value) {
    if (!pnlEl) pnlEl = document.getElementById('chart-pnl');
    if (!pnlEl) return;
    if (value === null || value === undefined) {
      // Reset to default — show nothing or last known
      return;
    }
    var sign = value >= 0 ? '+$' : '-$';
    pnlEl.textContent = sign + Math.abs(value).toFixed(2);
    pnlEl.className = 'chart-value ' + (value >= 0 ? 'stat-value--win' : 'stat-value--loss');
  }

  // ── Event Badge Rendering ───────────────────────────────
  // TradingView earnings-style badges in a row below the chart.
  var CHART_EVENTS = [
    {
      date: '2026-04-03',
      badge: 'K',
      label: 'Kelly Size Increased',
      detail: 'Bet sizing increased after model recalibration confirmed edge stability.',
      cssClass: 'event-badge--kelly'
    }
  ];

  function renderEventBadges(dataPoints) {
    var eventsRow = document.getElementById('chart-events');
    var chartBody = document.querySelector('.chart-body');
    if (!eventsRow || !chartBody || !chartInstance || dataPoints.length < 2) return;

    // Clear existing
    while (eventsRow.firstChild) eventsRow.removeChild(eventsRow.firstChild);
    chartBody.querySelectorAll('.event-vline, .event-panel').forEach(function (el) { el.remove(); });

    var timeScale = chartInstance.timeScale();

    CHART_EVENTS.forEach(function (evt) {
      var evtTs = Math.floor(new Date(evt.date + 'T16:00:00Z').getTime() / 1000);
      var closest = null;
      for (var i = 0; i < dataPoints.length; i++) {
        if (dataPoints[i].time >= evtTs) { closest = dataPoints[i].time; break; }
      }
      if (!closest) return;

      var x = timeScale.timeToCoordinate(closest);
      if (x === null) return;

      // Vertical dashed line through the chart area
      var vline = document.createElement('div');
      vline.className = 'event-vline';
      vline.style.left = x + 'px';
      vline.dataset.eventDate = evt.date;
      chartBody.appendChild(vline);

      // Badge in event row
      var badge = document.createElement('div');
      badge.className = 'event-badge ' + evt.cssClass;
      badge.textContent = evt.badge;
      badge.style.left = x + 'px';
      badge.dataset.eventDate = evt.date;

      // Click to toggle info panel
      badge.addEventListener('click', function (e) {
        e.stopPropagation();
        var existing = chartBody.querySelector('.event-panel[data-event-date="' + evt.date + '"]');
        if (existing) {
          existing.remove();
          vline.classList.remove('event-vline--active');
          return;
        }
        // Remove any other open panels
        chartBody.querySelectorAll('.event-panel').forEach(function (p) { p.remove(); });
        chartBody.querySelectorAll('.event-vline--active').forEach(function (v) { v.classList.remove('event-vline--active'); });

        vline.classList.add('event-vline--active');

        // Create info panel
        var panel = document.createElement('div');
        panel.className = 'event-panel';
        panel.dataset.eventDate = evt.date;

        // Position near the badge but inside the chart area
        var panelX = Math.min(x + 12, chartBody.offsetWidth - 240);
        panel.style.left = panelX + 'px';

        panel.textContent = ''; // clear
        var header = document.createElement('div');
        header.className = 'event-panel-header';
        var icon = document.createElement('span');
        icon.className = 'event-panel-icon ' + evt.cssClass;
        icon.textContent = evt.badge;
        var titleText = document.createElement('span');
        titleText.className = 'event-panel-title';
        titleText.textContent = evt.label;
        header.appendChild(icon);
        header.appendChild(titleText);

        var row1 = document.createElement('div');
        row1.className = 'event-panel-row';
        row1.textContent = 'Date';
        var val1 = document.createElement('span');
        val1.textContent = evt.date;
        row1.appendChild(val1);

        var desc = document.createElement('div');
        desc.className = 'event-panel-desc';
        desc.textContent = evt.detail;

        panel.appendChild(header);
        panel.appendChild(row1);
        panel.appendChild(desc);
        chartBody.appendChild(panel);
      });

      eventsRow.appendChild(badge);
    });

    // Close panel on click outside
    document.addEventListener('click', function () {
      chartBody.querySelectorAll('.event-panel').forEach(function (p) { p.remove(); });
      chartBody.querySelectorAll('.event-vline--active').forEach(function (v) { v.classList.remove('event-vline--active'); });
    });

    // Reposition on viewport change
    timeScale.subscribeVisibleLogicalRangeChange(function () {
      CHART_EVENTS.forEach(function (evt) {
        var evtTs = Math.floor(new Date(evt.date + 'T16:00:00Z').getTime() / 1000);
        var closest = null;
        for (var i = 0; i < dataPoints.length; i++) {
          if (dataPoints[i].time >= evtTs) { closest = dataPoints[i].time; break; }
        }
        if (!closest) return;
        var newX = timeScale.timeToCoordinate(closest);
        if (newX === null) return;
        // Update badge position
        var badge = eventsRow.querySelector('[data-event-date="' + evt.date + '"]');
        if (badge) badge.style.left = newX + 'px';
        // Update vline position
        var vline = chartBody.querySelector('.event-vline[data-event-date="' + evt.date + '"]');
        if (vline) vline.style.left = newX + 'px';
      });
    });
  }

  // ── Public API ─────────────────────────────────────────────
  window.ApolloChart = {
    init: initChart,
    setData: setChartData,
    appendPoint: appendDataPoint
  };

  // ── Auto-Init ──────────────────────────────────────────────
  // If Supabase is configured, app.js handles the central fetch
  // and calls ApolloChart.init() with shared data (avoids triple fetch).
  // Only auto-init here for static JSON fallback.
  function autoInit() {
    if (window.apolloDb && window.apolloDb.isConfigured()) {
      // Central init in app.js will call ApolloChart.init() — skip here
      return;
    }
    fallbackToJson();
  }

  function fallbackToJson() {
    // Show empty state instead of stale $1K-scale fallback data
    var container = document.getElementById('equity-chart');
    if (container) {
      container.style.display = 'flex';
      container.style.alignItems = 'center';
      container.style.justifyContent = 'center';
      container.style.color = 'var(--text-muted)';
      container.style.fontFamily = 'var(--font-mono)';
      container.style.fontSize = '0.75rem';
      container.textContent = 'Connecting to live data...';
    }
  }

  // Wait for DOM + supabase-client.js to load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }

})();
