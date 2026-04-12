/* ══════════════════════════════════════════════════════════════
   Bet Entry Form — APOLLO V9.0
   Trading-terminal style form for recording pre-match bets.
   Auto-calculates edge, Kelly, and stake from model signals.
   ══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var form = null;
  var _initialized = false;
  var DEFAULT_KELLY_FRACTION = 0.25; // V8.3 Quarter-Kelly
  var MAX_STAKE = 3000; // Safety rail: 15% of $20K

  function init() {
    if (_initialized) return;
    form = document.getElementById('bet-entry-form');
    if (!form) return;
    _initialized = true;

    // Auto-calculate on input change
    var calcFields = ['odds', 'model-prob', 'brier-scale'];
    calcFields.forEach(function (fieldName) {
      var input = form.querySelector('[name="' + fieldName + '"]');
      if (input) {
        input.addEventListener('input', recalculate);
      }
    });

    // Side radio → auto-fill pick name
    var sideRadios = form.querySelectorAll('[name="side"]');
    sideRadios.forEach(function (radio) {
      radio.addEventListener('change', function () {
        autoFillPickName();
        recalculate();
      });
    });

    // Player name change → auto-fill pick name
    var p1Input = form.querySelector('[name="p1-name"]');
    var p2Input = form.querySelector('[name="p2-name"]');
    if (p1Input) p1Input.addEventListener('input', autoFillPickName);
    if (p2Input) p2Input.addEventListener('input', autoFillPickName);

    // Form submit
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submitBet();
    });

    // Load player name autocomplete
    loadPlayerNames();
  }

  function autoFillPickName() {
    if (!form) return;
    var side = getSelectedSide();
    var p1 = (form.querySelector('[name="p1-name"]').value || '').trim();
    var p2 = (form.querySelector('[name="p2-name"]').value || '').trim();
    var pickEl = form.querySelector('[name="pick-name"]');
    if (pickEl) {
      pickEl.value = side === 'P1' ? p1 : p2;
    }
  }

  function getSelectedSide() {
    if (!form) return 'P1';
    var checked = form.querySelector('[name="side"]:checked');
    return checked ? checked.value : 'P1';
  }

  function recalculate() {
    if (!form) return;

    var odds = parseFloat(form.querySelector('[name="odds"]').value) || 0;
    var modelProb = parseFloat(form.querySelector('[name="model-prob"]').value) || 0;
    var brierScale = parseFloat(form.querySelector('[name="brier-scale"]').value) || 1.0;

    // Edge = (model_prob * odds) - 1
    var edge = odds > 1 && modelProb > 0 ? (modelProb * odds) - 1 : 0;
    var edgeEl = form.querySelector('[name="edge"]');
    if (edgeEl) edgeEl.value = edge > 0 ? edge.toFixed(4) : '0.0000';

    // Kelly raw = edge / (odds - 1)
    var kellyRaw = odds > 1 && edge > 0 ? edge / (odds - 1) : 0;

    // Kelly scaled = kelly_raw * KELLY_FRACTION * brier_scale
    var kellyScaled = kellyRaw * DEFAULT_KELLY_FRACTION * brierScale;
    var kellyEl = form.querySelector('[name="kelly-scaled"]');
    if (kellyEl) kellyEl.value = kellyScaled.toFixed(4);

    // Stake = kelly_scaled * current_bankroll
    if (window.apolloDb && window.apolloDb.isConfigured()) {
      window.apolloDb.getBankroll().then(function (bankroll) {
        var stake = Math.min(kellyScaled * bankroll, MAX_STAKE);
        var stakeEl = form.querySelector('[name="stake"]');
        if (stakeEl && !stakeEl.dataset.manual) {
          stakeEl.value = stake > 0 ? stake.toFixed(2) : '0.00';
        }
      });
    }
  }

  function loadPlayerNames() {
    if (!window.apolloDb || !window.apolloDb.isConfigured()) return;

    window.apolloDb.getPlayerNames().then(function (names) {
      var datalist = document.getElementById('player-names');
      if (!datalist) return;
      // Clear existing options safely (no innerHTML)
      while (datalist.firstChild) {
        datalist.removeChild(datalist.firstChild);
      }
      names.forEach(function (name) {
        var option = document.createElement('option');
        option.value = name;
        datalist.appendChild(option);
      });
    });
  }

  function submitBet() {
    if (!form || !window.apolloDb || !window.apolloDb.isConfigured()) {
      showFormMessage('Supabase not configured. Cannot save bet.', 'error');
      return;
    }

    var matchDate = form.querySelector('[name="match-date"]').value;
    var p1Name = (form.querySelector('[name="p1-name"]').value || '').trim();
    var p2Name = (form.querySelector('[name="p2-name"]').value || '').trim();
    var side = getSelectedSide();
    var pickName = (form.querySelector('[name="pick-name"]').value || '').trim();
    var odds = parseFloat(form.querySelector('[name="odds"]').value);
    var modelProb = parseFloat(form.querySelector('[name="model-prob"]').value);
    var edge = parseFloat(form.querySelector('[name="edge"]').value);
    var kellyScaled = parseFloat(form.querySelector('[name="kelly-scaled"]').value);
    var brierScale = parseFloat(form.querySelector('[name="brier-scale"]').value) || 1.0;
    var stake = parseFloat(form.querySelector('[name="stake"]').value);
    var notes = (form.querySelector('[name="notes"]').value || '').trim();

    // Validation
    var errors = [];
    if (!matchDate) errors.push('Match date required');
    if (!p1Name) errors.push('Player 1 name required');
    if (!p2Name) errors.push('Player 2 name required');
    if (!pickName) pickName = side === 'P1' ? p1Name : p2Name;
    if (!odds || odds <= 1) errors.push('Odds must be > 1.0');
    if (!modelProb || modelProb <= 0 || modelProb >= 1) errors.push('Model prob must be between 0 and 1');
    if (!stake || stake <= 0) errors.push('Stake must be > 0');
    if (stake > MAX_STAKE) errors.push('Stake exceeds $' + MAX_STAKE + ' safety limit');

    if (errors.length > 0) {
      showFormMessage(errors.join('. '), 'error');
      return;
    }

    // Build bet object
    var bet = {
      match_date: new Date(matchDate).toISOString(),
      p1_name: p1Name,
      p2_name: p2Name,
      bet_side: side,
      pick_name: pickName,
      odds_at_bet: odds,
      model_prob: modelProb,
      bookmaker_implied: odds > 0 ? parseFloat((1 / odds).toFixed(4)) : null,
      edge: edge,
      kelly_scaled: kellyScaled,
      brier_scale_factor: brierScale,
      stake_amount: stake,
      stake_fraction: kellyScaled,
      notes: notes || null
    };

    // Disable submit button
    var submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    window.apolloDb.insertBet(bet).then(function (result) {
      if (submitBtn) submitBtn.disabled = false;

      if (result.error) {
        showFormMessage('Error: ' + result.error.message, 'error');
      } else {
        showFormMessage('Bet recorded successfully.', 'success');
        form.reset();
        setDefaultDateTime();
        // Reload player names for autocomplete
        loadPlayerNames();
      }
    });
  }

  function setDefaultDateTime() {
    var dateInput = form ? form.querySelector('[name="match-date"]') : null;
    if (dateInput) {
      var now = new Date();
      // Format as YYYY-MM-DDTHH:MM for datetime-local input
      var local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
      dateInput.value = local.toISOString().slice(0, 16);
    }
  }

  function showFormMessage(message, type) {
    var msgEl = document.getElementById('bet-form-message');
    if (!msgEl) return;
    msgEl.textContent = message;
    msgEl.className = 'form-message form-message--' + type;
    msgEl.style.display = 'block';

    if (type === 'success') {
      setTimeout(function () {
        msgEl.style.display = 'none';
      }, 3000);
    }
  }

  // ── Public API ─────────────────────────────────────────────
  window.ApolloBetEntry = {
    init: init
  };

  // Auto-init when authenticated
  document.addEventListener('apollo:auth', function (e) {
    if (e.detail.authenticated) {
      init();
      setDefaultDateTime();
    }
  });

})();
