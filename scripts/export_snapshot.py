"""Export the live Supabase bet ledger to a static JSON backup snapshot.

This is a durable, version-controlled backup of the bet ledger. The live data
lives in Supabase (a free-tier project that pauses after 7 days idle and is
deleted after 90 days paused). Committing this snapshot means the public-facing
record survives even if the Supabase project is ever lost — and it can be
re-imported via scripts/import_bets.py.

ALPHA SAFETY: only the columns the site actually renders are exported. The
proprietary columns (model_prob, kelly_scaled, stake_fraction,
brier_scale_factor, bookmaker_implied, model_version, notes) are deliberately
omitted so they never land in this public repo.

Usage:
    python scripts/export_snapshot.py
"""

import json
import os
import urllib.request

SUPABASE_URL = "https://fsccjjzutaxfonecmjxc.supabase.co"
# Public anon/publishable key — safe for client-side use; RLS enforces security.
SUPABASE_KEY = "sb_publishable_dlBwcGsOgCpFY8yuCULFEA_A6atHjfy"

# Only columns the site displays. Excludes all alpha-bearing fields.
SAFE_COLUMNS = [
    "id", "match_date", "p1_name", "p2_name", "pick_name", "bet_side",
    "odds_at_bet", "edge", "stake_amount", "profit_loss", "is_win",
    "actual_winner", "bookmaker",
]

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(SCRIPT_DIR, "..", "data", "bets_snapshot.json")
BASE_BANKROLL = 20000.0


def fetch_bets():
    url = (
        SUPABASE_URL
        + "/rest/v1/bets?select="
        + ",".join(SAFE_COLUMNS)
        + "&order=match_date.asc"
    )
    req = urllib.request.Request(
        url,
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": "Bearer " + SUPABASE_KEY,
            "Range": "0-9999",
            "Prefer": "count=exact",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp), resp.headers.get("content-range")


def main():
    bets, content_range = fetch_bets()
    with open(OUT_PATH, "w") as f:
        json.dump(bets, f, separators=(",", ":"))
        f.write("\n")
    print(f"content-range: {content_range} | wrote {len(bets)} bets -> {os.path.relpath(OUT_PATH)}")


if __name__ == "__main__":
    main()
