-- ══════════════════════════════════════════════════════════════
-- APOLLO V9.0 Website — Supabase Schema
-- Investor-facing bet ledger with real-time subscriptions
-- ══════════════════════════════════════════════════════════════

-- ── Table: bets ───────────────────────────────────────────────
-- Core bet ledger. Mirrors daemon's bets table structure.
-- Andrew enters bets manually; investors view via public reads.
CREATE TABLE IF NOT EXISTS bets (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Match identification
  event_id TEXT UNIQUE,                                          -- BetsAPI event_id (optional for manual entry)
  match_date TIMESTAMPTZ NOT NULL,                               -- When the match occurs
  p1_name TEXT NOT NULL,                                         -- Player 1 (positional, NOT favorite)
  p2_name TEXT NOT NULL,                                         -- Player 2

  -- Bet details
  bet_side TEXT NOT NULL CHECK (bet_side IN ('P1', 'P2')),       -- Which player we backed
  pick_name TEXT NOT NULL,                                       -- Denormalized for display
  odds_at_bet NUMERIC(6,3) NOT NULL CHECK (odds_at_bet > 1.0),  -- Decimal odds at placement

  -- Model signals
  model_prob NUMERIC(5,4) CHECK (model_prob BETWEEN 0 AND 1),   -- Model probability for picked side
  bookmaker_implied NUMERIC(5,4),                                -- Vig-removed implied probability
  edge NUMERIC(6,4),                                              -- Expected value: (model_prob * odds) - 1. NULL for imported bets without model signals.

  -- Kelly sizing
  kelly_scaled NUMERIC(6,4),                                     -- Brier-scaled Kelly fraction
  brier_scale_factor NUMERIC(4,2) DEFAULT 1.0,                  -- Calibration multiplier (1.0/0.5/0.25)
  stake_amount NUMERIC(10,2) NOT NULL CHECK (stake_amount > 0), -- Dollar amount wagered
  stake_fraction NUMERIC(8,6),                                   -- Fraction of bankroll

  -- Resolution
  actual_winner TEXT CHECK (actual_winner IN ('P1', 'P2', 'VOID', 'CASHOUT')),
  is_win BOOLEAN,                                                -- true=win, false=loss, NULL=pending
  profit_loss NUMERIC(10,2),                                     -- Win: stake*(odds-1), Loss: -stake

  -- Metadata
  model_version TEXT DEFAULT 'V8.3',
  bookmaker TEXT DEFAULT 'HardRock',                             -- 'HardRock' or 'BetOnline'
  notes TEXT,                                                    -- Operator notes
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Composite index for duplicate detection on bulk import
CREATE INDEX IF NOT EXISTS idx_bets_match_players
  ON bets (match_date, p1_name, p2_name);

-- Index for real-time dashboard queries
CREATE INDEX IF NOT EXISTS idx_bets_resolved
  ON bets (resolved_at DESC NULLS FIRST)
  WHERE is_win IS NOT NULL;

-- Index for pending bets display
CREATE INDEX IF NOT EXISTS idx_bets_pending
  ON bets (created_at DESC)
  WHERE is_win IS NULL;


-- ── Table: capital_sweeps ─────────────────────────────────────
-- Profit extraction ledger. Tracks realized gains swept from
-- operating bankroll to reserve.
CREATE TABLE IF NOT EXISTS capital_sweeps (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  swept_at TIMESTAMPTZ DEFAULT NOW(),
  bankroll_before NUMERIC(12,2) NOT NULL,
  amount_swept NUMERIC(12,2) NOT NULL CHECK (amount_swept > 0),
  bankroll_after NUMERIC(12,2) NOT NULL
);


-- ── Table: system_snapshots ───────────────────────────────────
-- Periodic health snapshots entered by operator after reviewing
-- daemon state. Not auto-populated.
CREATE TABLE IF NOT EXISTS system_snapshots (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snapshot_at TIMESTAMPTZ DEFAULT NOW(),
  rolling_brier NUMERIC(6,4),
  total_bets INTEGER,
  win_count INTEGER,
  bankroll NUMERIC(12,2),
  system_status TEXT CHECK (system_status IN ('GREEN', 'YELLOW', 'RED'))
);


-- ══════════════════════════════════════════════════════════════
-- RPC Functions
-- ══════════════════════════════════════════════════════════════

-- Bankroll from first principles (never cached, never trusted)
-- Base: $20,000 (V8.3 Mac deployment)
CREATE OR REPLACE FUNCTION get_bankroll()
RETURNS NUMERIC
LANGUAGE SQL
STABLE
AS $$
  SELECT 20000
    + COALESCE(
        (SELECT SUM(profit_loss) FROM bets WHERE is_win IS NOT NULL),
        0
      )
    - COALESCE(
        (SELECT SUM(amount_swept) FROM capital_sweeps),
        0
      );
$$;

-- Dashboard summary stats (single scan via CTE for efficiency)
CREATE OR REPLACE FUNCTION get_dashboard_stats()
RETURNS JSON
LANGUAGE SQL
STABLE
AS $$
  WITH bet_agg AS (
    SELECT
      COUNT(*)                                                          AS total_bets,
      COUNT(*) FILTER (WHERE is_win IS NOT NULL)                        AS resolved_bets,
      COUNT(*) FILTER (WHERE is_win IS NULL AND actual_winner IS NULL)  AS pending_bets,
      COUNT(*) FILTER (WHERE is_win = true)                             AS wins,
      COUNT(*) FILTER (WHERE is_win = false)                            AS losses,
      COALESCE(SUM(profit_loss) FILTER (WHERE is_win IS NOT NULL), 0)   AS total_pnl,
      COALESCE(SUM(stake_amount) FILTER (WHERE is_win IS NOT NULL), 0)  AS total_staked,
      MAX(created_at)                                                   AS last_bet_at
    FROM bets
  ),
  sweep_agg AS (
    SELECT COALESCE(SUM(amount_swept), 0) AS total_swept FROM capital_sweeps
  )
  SELECT json_build_object(
    'total_bets',    b.total_bets,
    'resolved_bets', b.resolved_bets,
    'pending_bets',  b.pending_bets,
    'wins',          b.wins,
    'losses',        b.losses,
    'total_pnl',     b.total_pnl,
    'total_staked',  b.total_staked,
    'total_swept',   s.total_swept,
    'bankroll',      20000 + b.total_pnl - s.total_swept,
    'last_bet_at',   b.last_bet_at
  )
  FROM bet_agg b, sweep_agg s;
$$;


-- ══════════════════════════════════════════════════════════════
-- Row Level Security
-- ══════════════════════════════════════════════════════════════

-- Enable RLS on all tables
ALTER TABLE bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE capital_sweeps ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_snapshots ENABLE ROW LEVEL SECURITY;

-- Public read access (investors can view without auth)
CREATE POLICY "Public read bets"
  ON bets FOR SELECT
  USING (true);

CREATE POLICY "Public read sweeps"
  ON capital_sweeps FOR SELECT
  USING (true);

CREATE POLICY "Public read snapshots"
  ON system_snapshots FOR SELECT
  USING (true);

-- Authenticated write access (Andrew only)
-- IMPORTANT: After creating your Supabase Auth account, replace the UUID below.
-- Find your UUID: Supabase Dashboard → Authentication → Users → copy User UID.
-- Until replaced, write operations will fail (which is safer than allowing all users).
CREATE POLICY "Owner insert bets"
  ON bets FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = '00000000-0000-0000-0000-000000000000'::uuid);

CREATE POLICY "Owner update bets"
  ON bets FOR UPDATE
  TO authenticated
  USING (auth.uid() = '00000000-0000-0000-0000-000000000000'::uuid)
  WITH CHECK (auth.uid() = '00000000-0000-0000-0000-000000000000'::uuid);

CREATE POLICY "Owner insert sweeps"
  ON capital_sweeps FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = '00000000-0000-0000-0000-000000000000'::uuid);

CREATE POLICY "Owner insert snapshots"
  ON system_snapshots FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = '00000000-0000-0000-0000-000000000000'::uuid);

-- No DELETE policies — immutable ledger


-- ══════════════════════════════════════════════════════════════
-- Enable Realtime
-- ══════════════════════════════════════════════════════════════

-- Enable realtime for bets table (investors see live updates)
ALTER PUBLICATION supabase_realtime ADD TABLE bets;
ALTER PUBLICATION supabase_realtime ADD TABLE capital_sweeps;
