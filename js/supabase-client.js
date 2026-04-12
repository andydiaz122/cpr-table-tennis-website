/* ══════════════════════════════════════════════════════════════
   Supabase Client — APOLLO V9.0
   Initializes Supabase JS client for auth, queries, and realtime.
   Loaded via CDN: @supabase/supabase-js@2
   ══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── Configuration ──────────────────────────────────────────
  // These are PUBLIC keys (anon key is safe for client-side use).
  // Security is enforced via Row Level Security policies, not key secrecy.
  var SUPABASE_URL = 'https://fsccjjzutaxfonecmjxc.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_dlBwcGsOgCpFY8yuCULFEA_A6atHjfy';

  // Base bankroll for reconstruction
  var BASE_BANKROLL = 20000;

  // ── Client Initialization ─────────────────────────────────
  var _createClient = window.supabase ? window.supabase.createClient : null;
  var client = null;

  if (_createClient && SUPABASE_URL !== 'YOUR_SUPABASE_URL') {
    client = _createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      },
      realtime: {
        params: { eventsPerSecond: 10 }
      }
    });
  }

  // ── Query Helpers ──────────────────────────────────────────

  /**
   * Fetch all bets ordered by match_date (oldest first, chronological).
   * Consumers needing newest-first should reverse client-side.
   * Returns { data, error }.
   */
  function fetchBets() {
    if (!client) return Promise.resolve({ data: [], error: null });
    return client
      .from('bets')
      .select('*')
      .order('match_date', { ascending: true });
  }

  /**
   * Fetch only pending bets (not yet resolved).
   * Returns { data, error }.
   */
  function fetchPendingBets() {
    if (!client) return Promise.resolve({ data: [], error: null });
    return client
      .from('bets')
      .select('*')
      .is('is_win', null)
      .is('actual_winner', null)
      .order('created_at', { ascending: false });
  }

  /**
   * Fetch capital sweeps.
   * Returns { data, error }.
   */
  function fetchSweeps() {
    if (!client) return Promise.resolve({ data: [], error: null });
    return client
      .from('capital_sweeps')
      .select('*')
      .order('swept_at', { ascending: true });
  }

  /**
   * Get current bankroll via RPC function.
   * Returns numeric value or BASE_BANKROLL on error.
   */
  function getBankroll() {
    if (!client) return Promise.resolve(BASE_BANKROLL);
    return client
      .rpc('get_bankroll')
      .then(function (result) {
        if (result.error) return BASE_BANKROLL;
        return Number(result.data) || BASE_BANKROLL;
      });
  }

  /**
   * Get dashboard stats via RPC function.
   * Returns JSON object with aggregated metrics.
   */
  function getDashboardStats() {
    if (!client) return Promise.resolve(null);
    return client
      .rpc('get_dashboard_stats')
      .then(function (result) {
        if (result.error) return null;
        return result.data;
      });
  }

  /**
   * Insert a new bet.
   * Returns { data, error }.
   */
  function insertBet(bet) {
    if (!client) return Promise.resolve({ data: null, error: { message: 'Supabase not configured' } });
    return client
      .from('bets')
      .insert([bet])
      .select()
      .single();
  }

  /**
   * Resolve a bet (set winner, P&L, resolution timestamp).
   * Returns { data, error }.
   */
  function resolveBet(betId, updates) {
    if (!client) return Promise.resolve({ data: null, error: { message: 'Supabase not configured' } });

    // Validate inputs before writing to the ledger
    var validWinners = ['P1', 'P2', 'VOID', 'CASHOUT'];
    if (validWinners.indexOf(updates.actual_winner) === -1) {
      return Promise.resolve({ data: null, error: { message: 'Invalid actual_winner: ' + updates.actual_winner } });
    }
    if (updates.is_win !== null && typeof updates.is_win !== 'boolean') {
      return Promise.resolve({ data: null, error: { message: 'Invalid is_win: must be boolean or null' } });
    }
    if (typeof updates.profit_loss !== 'number' || !isFinite(updates.profit_loss)) {
      return Promise.resolve({ data: null, error: { message: 'Invalid profit_loss: must be a finite number' } });
    }

    // Guard: only update pending bets (prevents double-resolution)
    return client
      .from('bets')
      .update({
        actual_winner: updates.actual_winner,
        is_win: updates.is_win,
        profit_loss: updates.profit_loss,
        resolved_at: new Date().toISOString()
      })
      .eq('id', betId)
      .is('is_win', null)
      .is('actual_winner', null)
      .select()
      .then(function (result) {
        if (result.error) return result;
        if (!result.data || result.data.length === 0) {
          return { data: null, error: { message: 'Bet already resolved or not found' } };
        }
        return { data: result.data[0], error: null };
      });
  }

  /**
   * Get distinct player names for autocomplete.
   * Returns array of unique player name strings.
   */
  function getPlayerNames() {
    if (!client) return Promise.resolve([]);
    return client
      .from('bets')
      .select('p1_name, p2_name')
      .then(function (result) {
        if (result.error || !result.data) return [];
        var names = {};
        result.data.forEach(function (row) {
          names[row.p1_name] = true;
          names[row.p2_name] = true;
        });
        return Object.keys(names).sort();
      });
  }

  // ── Realtime Subscriptions ─────────────────────────────────

  /**
   * Subscribe to all changes on the bets table.
   * callback receives { eventType, new, old } payload.
   * Returns the channel (call .unsubscribe() to stop).
   */
  function subscribeToBets(callback) {
    if (!client) return null;
    return client
      .channel('bets-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bets' },
        function (payload) {
          callback({
            eventType: payload.eventType,
            newRecord: payload.new,
            oldRecord: payload.old
          });
        }
      )
      .subscribe();
  }

  /**
   * Subscribe to capital sweep changes.
   * Returns the channel.
   */
  function subscribeToSweeps(callback) {
    if (!client) return null;
    return client
      .channel('sweeps-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'capital_sweeps' },
        function (payload) {
          callback({ newRecord: payload.new });
        }
      )
      .subscribe();
  }

  // ── Auth Helpers ───────────────────────────────────────────

  function getSession() {
    if (!client) return Promise.resolve({ data: { session: null } });
    return client.auth.getSession();
  }

  function signIn(email, password) {
    if (!client) return Promise.resolve({ data: null, error: { message: 'Supabase not configured' } });
    return client.auth.signInWithPassword({ email: email, password: password });
  }

  function signOut() {
    if (!client) return Promise.resolve();
    return client.auth.signOut();
  }

  function onAuthStateChange(callback) {
    if (!client) return { data: { subscription: { unsubscribe: function () {} } } };
    return client.auth.onAuthStateChange(callback);
  }

  // ── Public API ─────────────────────────────────────────────
  window.apolloDb = {
    client: client,
    BASE_BANKROLL: BASE_BANKROLL,

    // Queries
    fetchBets: fetchBets,
    fetchPendingBets: fetchPendingBets,
    fetchSweeps: fetchSweeps,
    getBankroll: getBankroll,
    getDashboardStats: getDashboardStats,
    getPlayerNames: getPlayerNames,

    // Mutations
    insertBet: insertBet,
    resolveBet: resolveBet,

    // Realtime
    subscribeToBets: subscribeToBets,
    subscribeToSweeps: subscribeToSweeps,

    // Auth
    getSession: getSession,
    signIn: signIn,
    signOut: signOut,
    onAuthStateChange: onAuthStateChange,

    // Utilities
    isConfigured: function () {
      return client !== null;
    }
  };
})();
