/* ══════════════════════════════════════════════════════════════
   Metrics Engine — APOLLO V9.0
   Client-side computation of rolling trading metrics.
   Fed by Supabase data, updates stat cards in the DOM.
   ══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── Metric Calculations ────────────────────────────────────

  /**
   * Compute all dashboard metrics from an array of resolved bets.
   * @param {Array} bets — resolved bets with is_win, profit_loss, stake_amount, odds_at_bet
   * @returns {Object} metrics object
   */
  function computeMetrics(bets) {
    // Resolved = has a result (win, loss, void, or cashout)
    var resolved = bets.filter(function (b) {
      return (b.is_win !== null && b.is_win !== undefined)
        || b.actual_winner === 'VOID'
        || b.actual_winner === 'CASHOUT';
    });
    var total = resolved.length;

    if (total === 0) {
      return {
        totalBets: 0,
        resolvedBets: 0,
        wins: 0,
        winRate: 0,
        totalPnl: 0,
        totalStaked: 0,
        roi: 0,
        sharpe: 0,
        maxDrawdown: 0,
        maxDrawdownPct: 0,
        avgEdge: 0
      };
    }

    var wins = resolved.filter(function (b) { return b.is_win === true; }).length;
    var losses = resolved.filter(function (b) { return b.is_win === false; }).length;
    // Win rate = wins / (wins + losses) — cashouts/voids excluded from denominator
    var decided = wins + losses;
    var winRate = decided > 0 ? (wins / decided) * 100 : 0;

    // P&L series
    var pnlValues = resolved.map(function (b) { return Number(b.profit_loss) || 0; });
    var totalPnl = pnlValues.reduce(function (sum, v) { return sum + v; }, 0);

    // Total staked
    var totalStaked = resolved.reduce(function (sum, b) {
      return sum + (Number(b.stake_amount) || 0);
    }, 0);

    // ROI per bet
    var roi = totalStaked > 0 ? (totalPnl / totalStaked) * 100 : 0;

    // Sharpe ratio (annualized)
    // Annualization: sqrt(bets_per_year). Estimated from actual data span,
    // falling back to ~6 bets/day * 252 trading days = 1512 if insufficient data.
    var meanPnl = totalPnl / total;
    var variance = pnlValues.reduce(function (sum, v) {
      return sum + Math.pow(v - meanPnl, 2);
    }, 0) / total;
    var stdPnl = Math.sqrt(variance);
    var betsPerYear = 1512; // default: ~6 bets/day * 252 days
    if (resolved.length >= 10) {
      var dateKey = resolved[0].match_date ? 'match_date' : 'date';
      var firstDate = new Date(resolved[0][dateKey]).getTime();
      var lastDate = new Date(resolved[resolved.length - 1][dateKey]).getTime();
      var daySpan = (lastDate - firstDate) / (1000 * 60 * 60 * 24);
      if (daySpan > 1) {
        betsPerYear = (resolved.length / daySpan) * 365;
      }
    }
    var sharpe = stdPnl > 0 ? (meanPnl / stdPnl) * Math.sqrt(betsPerYear) : 0;

    // Max drawdown (on cumulative P&L curve)
    var cumPnl = 0;
    var peak = 0;
    var maxDd = 0;

    pnlValues.forEach(function (pnl) {
      cumPnl += pnl;
      if (cumPnl > peak) peak = cumPnl;
      var dd = peak - cumPnl;
      if (dd > maxDd) maxDd = dd;
    });

    var maxDrawdownPct = peak > 0 ? (maxDd / (20000 + peak)) * 100 : 0;

    // Average edge (exclude null/zero edges from imported bets without model signals)
    var betsWithEdge = resolved.filter(function (b) {
      return b.edge !== null && b.edge !== undefined && Number(b.edge) !== 0;
    });
    var totalEdge = betsWithEdge.reduce(function (sum, b) {
      return sum + Number(b.edge);
    }, 0);
    var avgEdge = betsWithEdge.length > 0 ? (totalEdge / betsWithEdge.length) * 100 : 0;

    return {
      totalBets: bets.length,
      resolvedBets: total,
      pendingBets: bets.length - total,
      wins: wins,
      winRate: winRate,
      totalPnl: totalPnl,
      totalStaked: totalStaked,
      roi: roi,
      sharpe: sharpe,
      maxDrawdown: maxDd,
      maxDrawdownPct: maxDrawdownPct,
      avgEdge: avgEdge
    };
  }

  // ── DOM Updates ────────────────────────────────────────────

  /**
   * Update stat cards in the DOM with computed metrics.
   */
  function updateStatCards(metrics) {
    var cards = {
      'Win Rate': {
        value: metrics.winRate.toFixed(1) + '%',
        className: metrics.winRate >= 50 ? 'stat-value--win' : 'stat-value--loss'
      },
      'Max Drawdown': {
        value: '$' + metrics.maxDrawdown.toFixed(2) +
          ' (' + metrics.maxDrawdownPct.toFixed(2) + '%)',
        className: ''
      },
      'Cumulative PnL': {
        value: (metrics.totalPnl >= 0 ? '+$' : '-$') + Math.abs(metrics.totalPnl).toFixed(2),
        className: metrics.totalPnl >= 0 ? 'stat-value--win' : 'stat-value--loss'
      },
      'Total Bets': {
        value: String(metrics.totalBets),
        className: 'stat-value--cyan'
      },
      'Avg Edge': {
        value: metrics.avgEdge > 0 ? metrics.avgEdge.toFixed(2) + '%' : '\u2014',
        className: ''
      }
    };

    // Match stat cards by their label text
    var statCards = document.querySelectorAll('.stat-card');
    statCards.forEach(function (card) {
      var label = card.querySelector('.stat-label');
      var valueEl = card.querySelector('.stat-value');
      if (!label || !valueEl) return;

      var cardData = cards[label.textContent.trim()];
      if (cardData) {
        valueEl.textContent = cardData.value;
        // Update color class
        valueEl.className = 'stat-value num';
        if (cardData.className) {
          valueEl.classList.add(cardData.className);
        }
      }
    });

    // Update total bets counter
    var totalBetsEl = document.getElementById('total-bets');
    if (totalBetsEl) {
      totalBetsEl.textContent = String(metrics.totalBets);
    }
  }

  // ── System Status Badge ────────────────────────────────────

  /**
   * Determine system status based on last bet time.
   * Returns { status: 'LIVE'|'IDLE'|'OFFLINE', color: 'green'|'amber'|'red' }
   */
  function getSystemStatus(lastBetAt) {
    if (!lastBetAt) return { status: 'NO DATA', color: 'amber' };

    var now = Date.now();
    var lastBet = new Date(lastBetAt).getTime();
    var hoursAgo = (now - lastBet) / (1000 * 60 * 60);

    if (hoursAgo < 48) return { status: 'LIVE', color: 'green' };
    if (hoursAgo < 96) return { status: 'IDLE', color: 'amber' };
    return { status: 'OFFLINE', color: 'red' };
  }

  // ── Public API ─────────────────────────────────────────────
  window.ApolloMetrics = {
    compute: computeMetrics,
    updateCards: updateStatCards,
    getStatus: getSystemStatus
  };

})();
