/* ══════════════════════════════════════════════════════════════
   Orderbook Trade Tape — APOLLO V9.0
   Renders trades from Supabase (or static JSON fallback).
   Supports real-time updates and pending bet display.
   ══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var MAX_EDGE = 0.40;
  var currentBets = [];

  function formatTime(dateStr) {
    var d = new Date(dateStr);
    var month = String(d.getUTCMonth() + 1).padStart(2, '0');
    var day = String(d.getUTCDate()).padStart(2, '0');
    var hours = String(d.getUTCHours()).padStart(2, '0');
    var mins = String(d.getUTCMinutes()).padStart(2, '0');
    return month + '/' + day + ' ' + hours + ':' + mins;
  }

  function formatPnl(val) {
    if (val === null || val === undefined) return '---';
    if (val >= 0) return '+$' + val.toFixed(2);
    return '-$' + Math.abs(val).toFixed(2);
  }

  function createCell(className, text) {
    var td = document.createElement('td');
    td.className = className;
    var span = document.createElement('span');
    span.textContent = text;
    td.appendChild(span);
    return td;
  }

  /**
   * Render trades into the orderbook table.
   * Handles both Supabase bets and static JSON trades.
   */
  function renderTrades(bets) {
    var tbody = document.getElementById('orderbook-body');
    var countEl = document.getElementById('trade-count');
    if (!tbody) return;

    currentBets = bets;
    tbody.textContent = '';

    // Determine data format
    var isSupabase = bets.length > 0 && ('match_date' in bets[0]);

    // Sort newest first
    var sorted = bets.slice().sort(function (a, b) {
      var dateA = isSupabase ? a.match_date : a.date;
      var dateB = isSupabase ? b.match_date : b.date;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });

    sorted.forEach(function (bet, i) {
      var tr = document.createElement('tr');

      // Determine state
      var isPending = isSupabase && (bet.is_win === null || bet.is_win === undefined) && !bet.actual_winner;
      var isVoid = isSupabase && bet.actual_winner === 'VOID';
      var isCashout = isSupabase && bet.actual_winner === 'CASHOUT';
      var isWin = isSupabase ? bet.is_win === true : bet.result === 'WIN';
      var isLoss = isSupabase ? bet.is_win === false : bet.result === 'LOSS';

      if (isPending) {
        tr.className = 'row-pending';
      } else if (isVoid || isCashout) {
        tr.className = isCashout ? 'row-cashout' : 'row-void';
      } else if (isWin) {
        tr.className = 'row-win';
      } else {
        tr.className = 'row-loss';
      }

      tr.style.animationDelay = (i * 30) + 'ms';

      var edge = Number(isSupabase ? bet.edge : bet.edge) || 0;
      var depthWidth = Math.min((edge / MAX_EDGE) * 100, 100);

      // Time
      var dateStr = isSupabase ? bet.match_date : bet.date;
      tr.appendChild(createCell('col-time', formatTime(dateStr)));

      // Asset (match)
      var matchText = isSupabase
        ? (bet.p1_name + ' vs ' + bet.p2_name)
        : bet.match;
      tr.appendChild(createCell('col-match', matchText));

      // Signal (pick + side)
      var pickTd = document.createElement('td');
      pickTd.className = 'col-pick';
      var pickSpan = document.createElement('span');
      pickSpan.textContent = isSupabase ? bet.pick_name : bet.pick;
      var sideSpan = document.createElement('span');
      sideSpan.className = 'col-side';
      sideSpan.textContent = isSupabase ? bet.bet_side : bet.side;
      pickTd.appendChild(pickSpan);
      pickTd.appendChild(sideSpan);
      tr.appendChild(pickTd);

      // Odds
      var odds = Number(isSupabase ? bet.odds_at_bet : bet.odds) || 0;
      tr.appendChild(createCell('col-odds', odds.toFixed(3)));

      // Edge (show "—" for imported bets without model signals)
      var edgeText = (edge !== null && edge !== undefined && edge !== 0)
        ? (edge * 100).toFixed(1) + '%'
        : (isSupabase && (bet.edge === null || bet.edge === undefined) ? '\u2014' : '0.0%');
      tr.appendChild(createCell('col-edge', edgeText));

      // Stake
      var stake = Number(isSupabase ? bet.stake_amount : bet.stake) || 0;
      tr.appendChild(createCell('col-stake', '$' + stake.toFixed(2)));

      // PnL
      var pnl = isSupabase ? bet.profit_loss : bet.pnl;
      var pnlNum = Number(pnl);
      var pnlClass = isPending ? 'col-pnl-pending' : (pnlNum >= 0 ? 'col-pnl-pos' : 'col-pnl-neg');
      tr.appendChild(createCell(pnlClass, isPending ? '---' : formatPnl(pnlNum)));

      // Result badge
      var resultTd = document.createElement('td');
      var badge = document.createElement('span');
      if (isPending) {
        badge.className = 'badge badge-pending';
        badge.textContent = 'PENDING';
      } else if (isCashout) {
        badge.className = 'badge badge-cashout';
        badge.textContent = 'CASHOUT';
      } else if (isVoid) {
        badge.className = 'badge badge-void';
        badge.textContent = 'VOID';
      } else if (isWin) {
        badge.className = 'badge badge-win';
        badge.textContent = 'WIN';
      } else {
        badge.className = 'badge badge-loss';
        badge.textContent = 'LOSS';
      }
      resultTd.appendChild(badge);

      // Bookmaker badge (Supabase bets with bookmaker field)
      var BOOK_MAP = { 'HardRock': 'HR', 'BetOnline': 'BO' };
      if (isSupabase && bet.bookmaker && BOOK_MAP[bet.bookmaker]) {
        var bookBadge = document.createElement('span');
        bookBadge.className = 'badge badge-book badge-book-' + bet.bookmaker.toLowerCase();
        bookBadge.textContent = BOOK_MAP[bet.bookmaker];
        bookBadge.title = bet.bookmaker;
        resultTd.appendChild(bookBadge);
      }

      tr.appendChild(resultTd);

      // Depth bar in first cell
      var depthBar = document.createElement('div');
      depthBar.className = 'depth-bar';
      depthBar.style.width = depthWidth + '%';
      tr.firstChild.appendChild(depthBar);

      // Store bet ID for resolution
      if (isSupabase && bet.id) {
        tr.dataset.betId = bet.id;
      }

      tbody.appendChild(tr);
    });

    if (countEl) {
      var pendingCount = sorted.filter(function (b) {
        return isSupabase && (b.is_win === null || b.is_win === undefined) && !b.actual_winner;
      }).length;
      var resolvedCount = sorted.length - pendingCount;
      var label = sorted.length + ' trades';
      if (pendingCount > 0) {
        label += ' (' + pendingCount + ' pending)';
      }
      countEl.textContent = label;
    }
  }

  /**
   * Flash a single row (for real-time updates).
   */
  function flashRow(betId, type) {
    var row = document.querySelector('tr[data-bet-id="' + betId + '"]');
    if (!row) return;

    row.style.animation = 'none';
    row.offsetHeight; // Force reflow
    row.style.animation = type === 'win' ? 'flashGreen 0.6s' : 'flashRed 0.6s';
  }

  // ── Public API ─────────────────────────────────────────────
  window.ApolloOrderbook = {
    render: renderTrades,
    flash: flashRow,
    getBets: function () { return currentBets; }
  };

  // ── Auto-Init ──────────────────────────────────────────────
  // If Supabase is configured, app.js handles the central fetch
  // and calls ApolloOrderbook.render() with shared data (avoids triple fetch).
  function autoInit() {
    if (window.apolloDb && window.apolloDb.isConfigured()) {
      // Central init in app.js will call ApolloOrderbook.render() — skip here
      return;
    }
    fallbackToJson();
  }

  function fallbackToJson() {
    // Show empty state instead of stale $1K-scale fallback data
    var tbody = document.getElementById('orderbook-body');
    var countEl = document.getElementById('trade-count');
    if (tbody) {
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = 8;
      td.style.textAlign = 'center';
      td.style.padding = '2rem';
      td.style.color = 'var(--text-muted)';
      td.textContent = 'Connecting to live data...';
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    if (countEl) countEl.textContent = 'connecting...';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }

})();
