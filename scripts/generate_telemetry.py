"""Generate APOLLO telemetry summary using Gemini API."""

import json
import os
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TRADES_PATH = os.path.join(SCRIPT_DIR, "..", "data", "trades.json")
TELEMETRY_PATH = os.path.join(SCRIPT_DIR, "..", "data", "telemetry.json")


def compute_stats(trades):
    """Compute trading stats from recent trades."""
    last_10 = trades[-10:] if len(trades) >= 10 else trades

    wins = sum(1 for t in last_10 if t.get("pnl", 0) > 0)
    rolling_win_rate = wins / len(last_10) if last_10 else 0

    cum_pnl = 0
    peak = 0
    max_dd = 0
    for t in trades:
        cum_pnl += t.get("pnl", 0)
        if cum_pnl > peak:
            peak = cum_pnl
        dd = peak - cum_pnl
        if dd > max_dd:
            max_dd = dd

    last_10_pnl = sum(t.get("pnl", 0) for t in last_10)
    avg_edge = sum(t.get("edge", 0) for t in last_10) / len(last_10) if last_10 else 0

    return {
        "total_trades": len(trades),
        "rolling_10_win_rate": round(rolling_win_rate * 100, 1),
        "last_10_pnl": round(last_10_pnl, 2),
        "cumulative_pnl": round(cum_pnl, 2),
        "max_drawdown_from_peak": round(max_dd, 2),
        "avg_edge_last_10": round(avg_edge * 100, 2),
    }


def generate_with_gemini(stats):
    """Call Gemini API to generate telemetry summary."""
    import google.generativeai as genai

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return None

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-2.0-flash")

    system_prompt = (
        "You are APOLLO, a systematic risk manager for a quantitative table tennis "
        "betting model. Analyze these recent trades. Output a single clinical, "
        "quantitative sentence summarizing current execution edge and risk posture. "
        "Use precise numbers. Format: [SYS] your analysis"
    )

    response = model.generate_content(
        [system_prompt, json.dumps(stats)],
    )

    return response.text.strip()


def main():
    with open(TRADES_PATH, "r") as f:
        trades = json.load(f)

    stats = compute_stats(trades)

    summary = None
    try:
        summary = generate_with_gemini(stats)
    except Exception:
        pass

    if summary:
        telemetry = {
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "summary": summary,
            "model": "gemini-2.0-flash",
            "trades_analyzed": stats["total_trades"],
        }
        with open(TELEMETRY_PATH, "w") as f:
            json.dump(telemetry, f, indent=2)
            f.write("\n")
        print(f"Telemetry updated: {stats['total_trades']} trades analyzed")
    else:
        print("No GEMINI_API_KEY set or API call failed. Keeping existing telemetry.json.")


if __name__ == "__main__":
    main()
