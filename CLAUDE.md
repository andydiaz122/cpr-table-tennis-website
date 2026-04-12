# APOLLO Website V2 — Project Instructions

## Overview
Investor-facing website for APOLLO V9.0, a quantitative sports betting system deploying $20K of external capital on Czech Liga Pro table tennis. This is a LIVE deployment with real capital — never use "shadow trading" or "virtual capital" language.

## Tech Stack
- **Frontend:** Vanilla HTML/CSS/JS (no build step, no React, no bundler)
- **Charts:** TradingView Lightweight Charts (CDN)
- **Animations:** GSAP + ScrollTrigger (CDN)
- **Data Layer:** Supabase (PostgreSQL + real-time + auth)
- **Fonts:** Inter (sans), Geist Mono / JetBrains Mono (mono)
- **Hosting:** GitHub Pages (static deploy)

### CDN Imports
```html
<script src="https://unpkg.com/lightweight-charts/dist/lightweight-charts.standalone.production.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12/dist/ScrollTrigger.min.js"></script>
```

## Quick Start
```bash
# Serve locally
npx serve website/ -l 3847

# Take Playwright screenshots (requires: npx playwright install chromium)
npx playwright screenshot --viewport-size=1440,900 --full-page http://localhost:3847/ screenshot.png

# Bulk import historical bets (dry-run first)
SUPABASE_URL=... SUPABASE_KEY=... python scripts/import_bets.py --file bets.csv --format csv --dry-run

# Deploy: push to GitHub → GitHub Pages auto-deploys from website/ directory
```

## Supabase Configuration
- **Project URL:** Set in `js/supabase-client.js` as `SUPABASE_URL`
- **Anon Key:** Set in `js/supabase-client.js` as `SUPABASE_ANON_KEY`
- The anon key is PUBLIC by design (like Firebase API keys). Security comes from RLS policies, not key secrecy.
- Schema DDL is version-controlled in `scripts/supabase_schema.sql`

## Design System (from css/style.css)
```css
--bg-primary: #030305;    /* Near-black background */
--bg-surface: #0a0a0f;    /* Card/elevated surfaces */
--win: #00ff88;            /* Green for wins/positive */
--loss: #ff2d6a;           /* Red for losses/negative */
--cyan: #00d4ff;           /* Accent/interactive */
--amber: #ffaa00;          /* Warning/pending */
--font-mono: 'Geist Mono', 'JetBrains Mono', monospace;
--font-sans: 'Inter', -apple-system, sans-serif;
--radius: 2px;             /* Sharp, institutional feel */
```

## File Map

### HTML/CSS
- `index.html` — Single-page site (Hero, Thesis, Live Dashboard, Engine, Validation, Infrastructure)
- `css/style.css` — Complete design system with tokens, grid, animations

### JavaScript
- `js/app.js` — IntersectionObserver reveals, typewriter, smooth scroll, mobile nav
- `js/supabase-client.js` — Supabase createClient init, helper functions
- `js/auth.js` — Login/logout, session management, nav auth state
- `js/bet-entry.js` — Bet entry form logic, auto-calculations, submission
- `js/bet-resolution.js` — Pending bet display, WIN/LOSS/VOID resolution
- `js/tv-chart.js` — TradingView equity curve (Supabase real-time data)
- `js/orderbook.js` — Trade tape (Supabase real-time, pending bets)
- `js/metrics.js` — Client-side metric calculations (win rate, ROI, Sharpe, drawdown)
- `js/animations.js` — GSAP ScrollTrigger, counter animations, number morphing

### Data & Scripts
- `data/telemetry.json` — AI-generated summary (Gemini)
- `scripts/supabase_schema.sql` — Schema DDL for version control
- `scripts/import_bets.py` — Bulk CSV/JSON import with dry-run mode
- `scripts/generate_telemetry.py` — Gemini AI summary generator

### CI/CD
- `.github/workflows/apollo-live.yml` — Telemetry refresh (6h schedule + manual dispatch)

## Critical Rules

### NEVER Reveal Alpha Values
- Do NOT display: ERROR_THRESHOLD, EDGE_THRESHOLD, exact Kelly fractions, MAX_KELLY, BRIER_BASELINE
- Do NOT list exact feature column names (Time_Since_Last_Advantage, etc.)
- DO describe feature families: Fatigue & Recovery, Skill & Rating, Form & Momentum, Market Pricing, Contextual
- DO describe methodology concepts without exact parameter values

### Live Capital Language
- This is a LIVE $20K deployment, not paper/shadow trading
- Bankroll base: $20,000 (not $1,000)
- All P&L values are real dollar amounts
- Disclaimer must include standard risk language, not "virtual capital"

### Authentication
- Bet entry form is AUTH-GATED — only visible when Andrew is logged in
- Investors see the dashboard (public reads via RLS) but never the input form
- Single Supabase Auth account (email/password)

### Data Integrity
- Bets table has immutable ledger design (no DELETE policy)
- Bankroll reconstructed from first principles: `$20,000 + SUM(P&L) - SUM(sweeps)`
- Duplicate detection on bulk import via event_id or composite key

## Bankroll Reconstruction (canonical SQL)
```sql
SELECT 20000 + COALESCE(SUM(CASE WHEN is_win IS NOT NULL THEN profit_loss ELSE 0 END), 0)
     - COALESCE((SELECT SUM(amount_swept) FROM capital_sweeps), 0) AS bankroll
FROM bets;
```

## Auto-Calculation Formulas (bet entry form)
```
edge = model_prob * odds - 1
kelly_raw = edge / (odds - 1)
kelly_scaled = kelly_raw * KELLY_FRACTION * brier_scale_factor
stake_amount = kelly_scaled * current_bankroll
profit_loss (WIN) = stake_amount * (odds - 1)
profit_loss (LOSS) = -stake_amount
```
Note: KELLY_FRACTION is NOT hardcoded in client JS — it's an editable field defaulting to a safe value.

## Supabase Setup Checklist (one-time)
1. Create Supabase project at supabase.com
2. Run `scripts/supabase_schema.sql` in SQL Editor (creates tables, RLS, RPC functions)
3. Create auth account (Authentication → Users → Add User)
4. Copy your User UID and replace `00000000-...` in all 4 RLS write policies
5. **Disable sign-ups:** Authentication → Settings → disable "Allow new users to sign up"
6. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `js/supabase-client.js`
7. Enable Realtime on `bets` and `capital_sweeps` tables (Database → Replication)

## Gotchas (discovered during code review)

### GSAP + CSS `.reveal` Conflict
The CSS `.reveal` class starts elements at `opacity: 0` and IntersectionObserver triggers on scroll. GSAP animations must NOT also set `opacity: 0` on `.reveal` elements — this causes double-animation and elements staying hidden. GSAP should only enhance specific elements (counters, bars, pipeline stagger), not duplicate the base reveal.

### Supabase CDN Must NOT Use `defer`
The Supabase CDN script (`@supabase/supabase-js@2`) must load synchronously (no `defer`) because `supabase-client.js` runs as an IIFE and checks `window.supabase` immediately. With `defer`, `window.supabase` is undefined and the client falls back to unconfigured mode. GSAP scripts CAN use `defer` since `animations.js` checks for `gsap` availability.

### Counter Animations Skip Live Stat Cards
`animations.js` counter animations only target static elements (`#engine`, `#validation` sections). The live stat cards in `#live` are updated by `metrics.js` — if counters ran on those, they'd conflict with real-time data updates.

### Double-Resolution Guard
`resolveBet()` in `supabase-client.js` includes `.is('is_win', null).is('actual_winner', null)` guards in the WHERE clause. This prevents resolving an already-resolved bet (e.g., from two browser tabs). If 0 rows are updated, it returns "Bet already resolved."

### CSP Must Include Font/Style CDN Domains
The Content-Security-Policy meta tag must include `fonts.googleapis.com` in `style-src` and `fonts.gstatic.com` + `cdn.jsdelivr.net` in `font-src`. Missing these causes all external fonts to be silently blocked.

### Central Data Init (Avoid Triple Fetch)
`app.js` owns the single `fetchBets()` call on page load and distributes data to chart, orderbook, and metrics. `tv-chart.js` and `orderbook.js` skip their own auto-fetch when Supabase is configured — they only fetch independently for static JSON fallback mode.

### VOID Bets
VOID bets have `is_win = null` and `actual_winner = 'VOID'`. They are excluded from P&L calculations but included in resolved counts. They display with muted styling (`row-void` class, 60% opacity) and a "VOID" badge.

### Win Rate Denominator (CRITICAL — caused a live bug)
Win Rate = Wins / (Wins + Losses). **CASHOUT and VOID bets are EXCLUDED from the denominator.** This matches standard sports betting convention and the Secretary CLAUDE.md accounting rules. Including cashouts in the denominator produces a materially different number (49.8% vs 52.0% on 255 bets). Every display of win rate — stat cards, telemetry, hero pills — must use the same formula.

### Cash-Out (CASHOUT) Handling
Cash-out bets use `actual_winner = 'CASHOUT'` with `is_win = null`. P&L is the actual Payout - Wager (can be negative for early exits). The resolution UI has a CASHOUT button with a custom P&L input field. In the trade tape, CASHOUT bets display with amber badge and reduced opacity. In metrics, CASHOUT bets are included in resolved count but excluded from win rate denominator.

### Hard Rock Data Import
Use `scripts/convert_hardrock_export.py` to parse the XML SpreadsheetML export. Handles "Last, First" → "First Last" name reorder and ET → UTC timestamp conversion. Cash-outs compute P&L as Payout - Wager. Outputs CSV for `import_bets.py`.

## Live URL
- **Public:** https://andydiaz122.github.io/CPR_Table_Tennis_V9.0/website/
- **Root redirect:** https://andydiaz122.github.io/CPR_Table_Tennis_V9.0/ (→ website/)
- **Repo:** public (required for GitHub Pages free tier)

## Local Skills
- `.claude/skills/website-design/` — design tokens, animation standards, content rules
- `.claude/skills/website-testing/` — Playwright screenshots, breakpoint checklist, Lighthouse
