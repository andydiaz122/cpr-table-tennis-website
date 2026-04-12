/* ══════════════════════════════════════════════════════════════
   Bet Resolution — APOLLO V9.0
   Handles resolving pending bets (WIN/LOSS/VOID).
   Only available when operator is authenticated.
   ══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var resolveModal = null;
  var currentBetId = null;
  var currentBet = null;

  function init() {
    resolveModal = document.getElementById('resolve-modal');
    if (!resolveModal) return;

    // Close modal on backdrop click
    resolveModal.addEventListener('click', function (e) {
      if (e.target === resolveModal) {
        closeModal();
      }
    });

    // Resolution buttons
    var winBtn = document.getElementById('resolve-win');
    var lossBtn = document.getElementById('resolve-loss');
    var cashoutBtn = document.getElementById('resolve-cashout');
    var voidBtn = document.getElementById('resolve-void');
    var cancelBtn = document.getElementById('resolve-cancel');

    if (winBtn) winBtn.addEventListener('click', function () { resolve('WIN'); });
    if (lossBtn) lossBtn.addEventListener('click', function () { resolve('LOSS'); });
    if (cashoutBtn) cashoutBtn.addEventListener('click', function () { resolve('CASHOUT'); });
    if (voidBtn) voidBtn.addEventListener('click', function () { resolve('VOID'); });
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    // Listen for clicks on pending rows in the trade tape
    // Security note: RLS enforces write access server-side.
    // This client check prevents confusing UI for unauthenticated visitors.
    document.addEventListener('click', function (e) {
      var row = e.target.closest('tr.row-pending');
      if (!row || !row.dataset.betId) return;

      // Check actual Supabase session, not CSS class
      if (!window.apolloDb || !window.apolloDb.isConfigured()) return;
      window.apolloDb.getSession().then(function (result) {
        if (result.data.session) {
          openResolveModal(row.dataset.betId);
        }
      });
    });
  }

  function openResolveModal(betId) {
    if (!resolveModal || !window.apolloDb) return;

    currentBetId = betId;

    // Find the bet data from the orderbook
    var bets = window.ApolloOrderbook ? window.ApolloOrderbook.getBets() : [];
    currentBet = bets.find(function (b) { return String(b.id) === String(betId); });

    if (!currentBet) return;

    // Populate modal with bet details
    var detailEl = document.getElementById('resolve-detail');
    if (detailEl) {
      detailEl.textContent =
        currentBet.p1_name + ' vs ' + currentBet.p2_name +
        ' | Pick: ' + currentBet.pick_name + ' (' + currentBet.bet_side + ')' +
        ' | Odds: ' + Number(currentBet.odds_at_bet).toFixed(3) +
        ' | Stake: $' + Number(currentBet.stake_amount).toFixed(2);
    }

    resolveModal.classList.add('active');
  }

  function resolve(outcome) {
    if (!currentBetId || !currentBet || !window.apolloDb) return;

    var stake = Number(currentBet.stake_amount) || 0;
    var odds = Number(currentBet.odds_at_bet) || 0;
    var side = currentBet.bet_side;

    var updates = {};

    if (outcome === 'WIN') {
      updates.actual_winner = side;
      updates.is_win = true;
      updates.profit_loss = parseFloat((stake * (odds - 1)).toFixed(2));
    } else if (outcome === 'LOSS') {
      updates.actual_winner = side === 'P1' ? 'P2' : 'P1';
      updates.is_win = false;
      updates.profit_loss = parseFloat((-stake).toFixed(2));
    } else if (outcome === 'CASHOUT') {
      // Cash-out: P&L = Payout - Wager (can be negative for early exits)
      var cashoutPnlInput = document.getElementById('cashout-pnl');
      var cashoutPnl = cashoutPnlInput ? parseFloat(cashoutPnlInput.value) : 0;
      if (isNaN(cashoutPnl)) cashoutPnl = 0;
      updates.actual_winner = 'CASHOUT';
      updates.is_win = null;
      updates.profit_loss = cashoutPnl;
    } else {
      updates.actual_winner = 'VOID';
      updates.is_win = null;
      updates.profit_loss = 0;
    }

    // Disable buttons during update
    var buttons = resolveModal.querySelectorAll('button');
    buttons.forEach(function (btn) { btn.disabled = true; });

    window.apolloDb.resolveBet(currentBetId, updates).then(function (result) {
      buttons.forEach(function (btn) { btn.disabled = false; });

      if (result.error) {
        var errorEl = document.getElementById('resolve-error');
        if (errorEl) errorEl.textContent = 'Error: ' + result.error.message;
        return;
      }

      closeModal();

      // Flash the resolved row
      if (window.ApolloOrderbook) {
        window.ApolloOrderbook.flash(
          currentBetId,
          outcome === 'WIN' ? 'win' : 'loss'
        );
      }

      // The real-time subscription will handle refreshing the data
    });
  }

  function closeModal() {
    if (resolveModal) resolveModal.classList.remove('active');
    currentBetId = null;
    currentBet = null;

    var errorEl = document.getElementById('resolve-error');
    if (errorEl) errorEl.textContent = '';
  }

  // ── Public API ─────────────────────────────────────────────
  window.ApolloBetResolution = {
    init: init,
    open: openResolveModal
  };

  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
