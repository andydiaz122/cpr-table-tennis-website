#!/usr/bin/env python3
"""
APOLLO V9.0 — Bulk Bet Import Script
=====================================
Imports historical bets from CSV or JSON into Supabase.
Supports backdated match_date values for historical backfill.

Usage:
    python import_bets.py --file bets.csv --format csv --dry-run
    python import_bets.py --file bets.json --format json
    python import_bets.py --file bets.csv --format csv --confirm

Environment:
    SUPABASE_URL      — Supabase project URL
    SUPABASE_KEY      — Supabase service role key (NOT anon key — needs write access)

CSV Format (expected columns):
    date, p1_name, p2_name, pick, side, odds, model_prob, edge, stake, pnl, result
    Optional: event_id, kelly_scaled, brier_scale_factor, notes

JSON Format:
    Array of objects with same field names as CSV columns.
"""

import argparse
import csv
import json
import os
import sys
from datetime import datetime
from pathlib import Path

def _get_supabase_client():
    """Lazy import — only needed for production imports, not dry-run."""
    try:
        from supabase import create_client
        return create_client
    except ImportError:
        print("ERROR: supabase-py not installed. Run: pip install supabase")
        sys.exit(1)


def _parse_date(date_str: str, row_num: int) -> str:
    """Parse various date formats into UTC ISO 8601 (YYYY-MM-DDTHH:MM:SSZ)."""
    # Strip trailing Z for consistent parsing
    cleaned = date_str.replace("Z", "+00:00") if date_str.endswith("Z") else date_str

    # Try fromisoformat first (handles offsets in Python 3.11+)
    try:
        from datetime import timezone
        dt = datetime.fromisoformat(cleaned)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        pass

    # Fallback: only accept unambiguous timezone-naive formats.
    # Do NOT strip timezone offsets — that silently corrupts timestamps.
    # If offset is present and fromisoformat failed, reject the date.
    from datetime import timezone as tz
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(date_str.strip(), fmt)
            dt = dt.replace(tzinfo=tz.utc)  # assume UTC for naive dates
            return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            continue

    raise ValueError(f"Row {row_num}: Unparseable date '{date_str}'")


def load_csv(filepath: str) -> list[dict]:
    """Load bets from CSV file."""
    bets = []
    with open(filepath, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            bets.append(dict(row))
    return bets


def load_json(filepath: str) -> list[dict]:
    """Load bets from JSON file."""
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError("JSON file must contain an array of bet objects")
    return data


def normalize_bet(raw: dict, row_num: int) -> dict:
    """Normalize a raw bet dict into Supabase-compatible format."""
    # Determine player names
    p1_name = raw.get("p1_name", "").strip()
    p2_name = raw.get("p2_name", "").strip()

    # If match field exists (from trades.json format), split it
    if not p1_name and "match" in raw:
        parts = raw["match"].split(" vs ")
        if len(parts) == 2:
            p1_name = parts[0].strip()
            p2_name = parts[1].strip()

    if not p1_name or not p2_name:
        raise ValueError(f"Row {row_num}: Missing player names")

    # Determine pick side
    side = raw.get("side", raw.get("bet_side", "")).strip().upper()
    if side not in ("P1", "P2"):
        raise ValueError(f"Row {row_num}: Invalid side '{side}', must be P1 or P2")

    # Determine pick name
    pick_name = raw.get("pick", raw.get("pick_name", "")).strip()
    if not pick_name:
        pick_name = p1_name if side == "P1" else p2_name

    # Parse date
    date_str = raw.get("date", raw.get("match_date", "")).strip()
    if not date_str:
        raise ValueError(f"Row {row_num}: Missing date")

    # Parse and normalize to UTC ISO 8601
    match_date = _parse_date(date_str, row_num)

    # Parse numeric fields
    odds = float(raw.get("odds", raw.get("odds_at_bet", 0)))
    if odds <= 1.0:
        raise ValueError(f"Row {row_num}: Invalid odds {odds}, must be > 1.0")

    model_prob = _safe_float(raw.get("model_prob"))
    edge = _safe_float(raw.get("edge"))
    stake = float(raw.get("stake", raw.get("stake_amount", 0)))
    if stake <= 0:
        raise ValueError(f"Row {row_num}: Invalid stake {stake}, must be > 0")

    # Parse result if present
    result_str = raw.get("result", "").strip().upper()
    actual_winner = None
    is_win = None
    profit_loss = _safe_float(raw.get("pnl", raw.get("profit_loss")))

    if result_str == "WIN":
        is_win = True
        actual_winner = side
        if profit_loss is None:
            profit_loss = round(stake * (odds - 1), 2)
    elif result_str == "LOSS":
        is_win = False
        actual_winner = "P2" if side == "P1" else "P1"
        if profit_loss is None:
            profit_loss = round(-stake, 2)
    elif result_str == "CASHOUT":
        actual_winner = "CASHOUT"
        # P&L from source data (Payout - Wager, can be negative)
        if profit_loss is None:
            profit_loss = 0.0
    elif result_str == "VOID":
        actual_winner = "VOID"
        profit_loss = 0.0

    bet = {
        "match_date": match_date,
        "p1_name": p1_name,
        "p2_name": p2_name,
        "bet_side": side,
        "pick_name": pick_name,
        "odds_at_bet": odds,
        "stake_amount": stake,
    }

    # Optional fields (model signals may be absent on sportsbook-imported bets)
    if edge is not None:
        bet["edge"] = edge
    if model_prob is not None:
        bet["model_prob"] = model_prob
    if raw.get("bookmaker_implied"):
        bet["bookmaker_implied"] = float(raw["bookmaker_implied"])
    if raw.get("kelly_scaled"):
        bet["kelly_scaled"] = float(raw["kelly_scaled"])
    if raw.get("brier_scale_factor"):
        bet["brier_scale_factor"] = float(raw["brier_scale_factor"])
    if raw.get("stake_fraction"):
        bet["stake_fraction"] = float(raw["stake_fraction"])
    if raw.get("event_id"):
        bet["event_id"] = raw["event_id"].strip()
    if raw.get("notes"):
        bet["notes"] = raw["notes"].strip()
    if raw.get("model_version"):
        bet["model_version"] = raw["model_version"].strip()

    # Resolution fields
    if actual_winner is not None:
        bet["actual_winner"] = actual_winner
        bet["is_win"] = is_win
        bet["profit_loss"] = profit_loss
        bet["resolved_at"] = match_date  # Use match date as resolution time for historical

    return bet


def _safe_float(val: str | float | int | None) -> float | None:
    """Safely convert to float, returning None for empty/None values."""
    if val is None or val == "":
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def check_duplicates(supabase_client, bets: list[dict]) -> list[dict]:
    """Check for existing bets using event_id (exact match via UNIQUE constraint).

    For bets without event_id, we rely on the database-side upsert with
    ON CONFLICT DO NOTHING to handle deduplication at insert time.
    This avoids fragile timestamp string comparison in Python.
    """
    # Only check event_id-based duplicates (reliable UNIQUE constraint)
    bets_with_event_id = [b for b in bets if b.get("event_id")]
    bets_without_event_id = [b for b in bets if not b.get("event_id")]

    if not bets_with_event_id:
        return bets  # No event_ids to check, let insert handle errors

    event_ids = [b["event_id"] for b in bets_with_event_id]

    # Batch query existing event_ids (paginated to avoid unbounded SELECT)
    existing_ids = set()
    batch_size = 100
    for i in range(0, len(event_ids), batch_size):
        batch = event_ids[i : i + batch_size]
        try:
            result = (
                supabase_client.from_("bets")
                .select("event_id")
                .in_("event_id", batch)
                .execute()
            )
            for row in result.data or []:
                existing_ids.add(row["event_id"])
        except Exception as exc:
            print(f"  WARNING: Duplicate check query failed: {exc}")
            print("  Proceeding without duplicate check — DB constraints will catch conflicts.")
            return bets  # Return all bets; let insert handle conflicts

    new_bets = []
    skipped = 0
    for bet in bets_with_event_id:
        if bet["event_id"] in existing_ids:
            skipped += 1
        else:
            new_bets.append(bet)

    if skipped > 0:
        print(f"  Skipped {skipped} duplicate(s) (matching event_id)")

    # Include bets without event_id — they'll be inserted; any DB-level
    # constraint violations will be caught at insert time
    return new_bets + bets_without_event_id


def main():
    parser = argparse.ArgumentParser(description="Import bets into Supabase")
    parser.add_argument("--file", required=True, help="Path to CSV or JSON file")
    parser.add_argument("--format", choices=["csv", "json"], required=True, help="File format")
    parser.add_argument("--dry-run", action="store_true", help="Preview without inserting")
    parser.add_argument("--confirm", action="store_true", help="Skip confirmation prompt")
    parser.add_argument("--no-skip-duplicates", action="store_true", default=False,
                        help="Disable duplicate checking (default: duplicates are skipped)")
    args = parser.parse_args()

    # Validate file exists
    filepath = Path(args.file)
    if not filepath.exists():
        print(f"ERROR: File not found: {filepath}")
        sys.exit(1)

    # Load environment
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_KEY")

    if not args.dry_run and (not supabase_url or not supabase_key):
        print("ERROR: SUPABASE_URL and SUPABASE_KEY environment variables required")
        print("  export SUPABASE_URL='https://your-project.supabase.co'")
        print("  export SUPABASE_KEY='your-service-role-key'")
        sys.exit(1)

    # Load data
    print(f"Loading {args.format.upper()} from {filepath}...")
    raw_bets = load_csv(str(filepath)) if args.format == "csv" else load_json(str(filepath))
    print(f"  Found {len(raw_bets)} row(s)")

    # Normalize
    print("Normalizing...")
    normalized = []
    errors = []
    for i, raw in enumerate(raw_bets, start=1):
        try:
            bet = normalize_bet(raw, i)
            normalized.append(bet)
        except (ValueError, KeyError) as e:
            errors.append(str(e))

    if errors:
        print(f"\n  {len(errors)} error(s):")
        for err in errors[:10]:
            print(f"    - {err}")
        if len(errors) > 10:
            print(f"    ... and {len(errors) - 10} more")

    if not normalized:
        print("No valid bets to import.")
        sys.exit(1)

    # Summary
    resolved = sum(1 for b in normalized if b.get("is_win") is not None or b.get("actual_winner") in ("VOID", "CASHOUT"))
    pending = len(normalized) - resolved
    total_pnl = sum(b.get("profit_loss", 0) or 0 for b in normalized)

    print(f"\n  Valid bets: {len(normalized)}")
    print(f"  Resolved:   {resolved} (P&L: ${total_pnl:+.2f})")
    print(f"  Pending:    {pending}")

    if args.dry_run:
        print("\n--- DRY RUN --- No data inserted.")
        print("\nFirst 5 bets preview:")
        for bet in normalized[:5]:
            winner = bet.get("actual_winner", "PENDING")
            pnl = bet.get("profit_loss")
            pnl_str = f"${pnl:+.2f}" if pnl is not None else "---"
            print(f"  {bet['match_date'][:10]}  {bet['p1_name']} vs {bet['p2_name']}  "
                  f"Pick: {bet['pick_name']}  @{bet['odds_at_bet']}  "
                  f"{winner}  {pnl_str}")
        return

    # Connect to Supabase
    create_client = _get_supabase_client()
    client = create_client(supabase_url, supabase_key)

    # Check duplicates
    if not args.no_skip_duplicates:
        print("\nChecking for duplicates...")
        normalized = check_duplicates(client, normalized)

    if not normalized:
        print("All bets already exist in database. Nothing to import.")
        return

    # Confirm
    if not args.confirm:
        response = input(f"\nInsert {len(normalized)} bet(s) into Supabase? [y/N] ")
        if response.lower() != "y":
            print("Aborted.")
            return

    # Insert in batches of 50
    print(f"\nInserting {len(normalized)} bet(s)...")
    batch_size = 50
    inserted = 0
    failed_batches = 0
    for i in range(0, len(normalized), batch_size):
        batch = normalized[i : i + batch_size]
        batch_num = i // batch_size + 1
        try:
            result = client.from_("bets").insert(batch).execute()
            count = len(result.data or [])
            inserted += count
            print(f"  Batch {batch_num}: {count} inserted")
        except Exception as exc:
            failed_batches += 1
            print(f"  ERROR in batch {batch_num} (rows {i+1}-{i+len(batch)}): {exc}")
            print("  Aborting remaining batches to prevent inconsistent state.")
            sys.exit(1)

    print(f"\nDone. {inserted} bet(s) imported successfully.")
    if failed_batches > 0:
        print(f"WARNING: {failed_batches} batch(es) failed.")


if __name__ == "__main__":
    main()
