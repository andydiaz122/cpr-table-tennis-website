/**
 * APOLLO V9.0 — Programmatic Number Verification
 *
 * Loads the live site in Playwright, extracts every displayed number,
 * queries Supabase for the source of truth, and flags mismatches.
 *
 * Usage:
 *   cd /tmp && node /path/to/verify_numbers.js [URL]
 *   Default URL: http://localhost:3847/
 *
 * Requires: playwright (npm install playwright in /tmp)
 */

const { chromium } = require('playwright');

const URL = process.argv[2] || 'http://localhost:3847/';
const TOLERANCE = 0.02; // $0.02 tolerance for floating point

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Collect console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000); // Wait for Supabase data + metrics computation

  const results = [];

  // ── Extract Supabase source of truth ─────────────────────
  const truth = await page.evaluate(async () => {
    if (!window.apolloDb || !window.apolloDb.isConfigured()) {
      return null;
    }
    const betsResult = await window.apolloDb.fetchBets();
    const bets = betsResult.data || [];
    const bankroll = await window.apolloDb.getBankroll();

    const wins = bets.filter(b => b.is_win === true).length;
    const losses = bets.filter(b => b.is_win === false).length;
    const cashouts = bets.filter(b => b.actual_winner === 'CASHOUT').length;
    const resolved = bets.filter(b =>
      b.is_win !== null || b.actual_winner === 'CASHOUT' || b.actual_winner === 'VOID'
    );
    const totalPnl = resolved.reduce((s, b) => s + (Number(b.profit_loss) || 0), 0);
    const totalStaked = resolved.reduce((s, b) => s + (Number(b.stake_amount) || 0), 0);
    const decided = wins + losses;
    const winRate = decided > 0 ? (wins / decided * 100) : 0;

    // Max drawdown
    let cumPnl = 0, peak = 0, maxDd = 0;
    const sorted = [...resolved].sort((a, b) =>
      new Date(a.match_date).getTime() - new Date(b.match_date).getTime()
    );
    sorted.forEach(b => {
      cumPnl += Number(b.profit_loss) || 0;
      if (cumPnl > peak) peak = cumPnl;
      const dd = peak - cumPnl;
      if (dd > maxDd) maxDd = dd;
    });

    return {
      totalBets: bets.length,
      wins, losses, cashouts,
      winRate: Math.round(winRate * 10) / 10,
      totalPnl: Math.round(totalPnl * 100) / 100,
      maxDrawdown: Math.round(maxDd * 100) / 100,
      bankroll: Number(bankroll),
      totalStaked: Math.round(totalStaked * 100) / 100,
      roi: totalStaked > 0 ? Math.round(totalPnl / totalStaked * 10000) / 100 : 0,
      cumPnlFromChart: cumPnl
    };
  });

  if (!truth) {
    console.log('[FAIL] Supabase not connected — cannot verify');
    await browser.close();
    process.exit(1);
  }

  console.log('\n=== SUPABASE SOURCE OF TRUTH ===');
  console.log(JSON.stringify(truth, null, 2));

  // ── Extract displayed values ──────────────────────────────

  // Stat cards
  const displayed = await page.evaluate(() => {
    const cards = {};
    document.querySelectorAll('.stat-card').forEach(card => {
      const label = card.querySelector('.stat-label')?.textContent?.trim();
      const value = card.querySelector('.stat-value')?.textContent?.trim();
      if (label) cards[label] = value;
    });

    // Chart PnL header
    const chartPnl = document.getElementById('chart-pnl')?.textContent?.trim();

    // Trade count
    const tradeCount = document.getElementById('trade-count')?.textContent?.trim();

    // Telemetry ticker
    const ticker = document.getElementById('ai-ticker-text')?.textContent?.trim();

    return { cards, chartPnl, tradeCount, ticker };
  });

  console.log('\n=== DISPLAYED VALUES ===');
  console.log(JSON.stringify(displayed, null, 2));

  // ── Compare ───────────────────────────────────────────────

  function parseNum(str) {
    if (!str) return null;
    const cleaned = str.replace(/[,$%+]/g, '').replace('—', '').trim();
    if (cleaned === '' || cleaned === '—') return null;
    return parseFloat(cleaned);
  }

  function check(name, displayed, expected, tolerance) {
    const tol = tolerance || TOLERANCE;
    const val = parseNum(displayed);
    if (val === null) {
      results.push({ name, status: 'SKIP', displayed, expected, note: 'non-numeric display' });
      return;
    }
    const diff = Math.abs(val - expected);
    const ok = diff <= tol;
    results.push({
      name,
      status: ok ? 'PASS' : 'FAIL',
      displayed: val,
      expected,
      diff: Math.round(diff * 100) / 100
    });
  }

  // Win Rate
  check('Win Rate (stat card)', displayed.cards['Win Rate'], truth.winRate, 0.2);

  // Cumulative PnL
  check('Cumulative PnL (stat card)', displayed.cards['Cumulative PnL'], truth.totalPnl, 1.0);

  // Total Bets
  check('Total Bets (stat card)', displayed.cards['Total Bets'], truth.totalBets, 0);

  // Max Drawdown (extract dollar amount)
  const ddStr = displayed.cards['Max Drawdown'];
  if (ddStr) {
    const ddMatch = ddStr.match(/\$([\d,.]+)/);
    if (ddMatch) {
      check('Max Drawdown $ (stat card)', ddMatch[1], truth.maxDrawdown, 5.0);
    }
  }

  // Chart PnL header
  check('Chart PnL header', displayed.chartPnl, truth.totalPnl, 1.0);

  // Trade count
  const tradeNum = displayed.tradeCount ? displayed.tradeCount.match(/(\d+)/)?.[1] : null;
  if (tradeNum) {
    check('Trade count', tradeNum, truth.totalBets, 0);
  }

  // Console errors
  results.push({
    name: 'Console errors',
    status: consoleErrors.length === 0 ? 'PASS' : 'FAIL',
    displayed: consoleErrors.length,
    expected: 0,
    note: consoleErrors.length > 0 ? consoleErrors[0].substring(0, 100) : ''
  });

  // ── Report ────────────────────────────────────────────────
  console.log('\n=== VERIFICATION RESULTS ===\n');
  let failures = 0;
  results.forEach(r => {
    const icon = r.status === 'PASS' ? '  [PASS]' : r.status === 'FAIL' ? '  [FAIL]' : '  [SKIP]';
    const detail = r.status === 'FAIL'
      ? ` — displayed: ${r.displayed}, expected: ${r.expected}, diff: ${r.diff}`
      : r.note ? ` — ${r.note}` : '';
    console.log(`${icon} ${r.name}${detail}`);
    if (r.status === 'FAIL') failures++;
  });

  console.log(`\n--- ${results.length - failures}/${results.length} passed, ${failures} failed ---`);

  await browser.close();
  process.exit(failures > 0 ? 1 : 0);
})().catch(e => {
  console.error('Verification error:', e.message);
  process.exit(1);
});
