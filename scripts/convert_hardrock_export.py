#!/usr/bin/env python3
"""
APOLLO V9.0 — Hard Rock Sportsbook Export Converter
=====================================================
Parses Hard Rock's XML SpreadsheetML export (.xls) and converts
to CSV format compatible with import_bets.py.

Handles:
- "Last, First vs. Last, First" → "First Last" name reordering
- "27 Mar 2026 @ 1:14pm" → ISO 8601 UTC (assumes ET timezone)
- "Cashed Out" → CASHOUT with actual P&L (Payout - Wager)
- Bet Slip ID → event_id for deduplication

Usage:
    python convert_hardrock_export.py --input All_Bets_Export.xls --output bets.csv
    python convert_hardrock_export.py --input All_Bets_Export.xls --output bets.csv --dry-run
"""

import argparse
import csv
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta


# Hard Rock timestamps are US Eastern Time (ET)
ET_OFFSET_STANDARD = timedelta(hours=-5)  # EST
ET_OFFSET_DST = timedelta(hours=-4)       # EDT

# EDT is in effect from second Sunday of March to first Sunday of November
# For simplicity and correctness: use zoneinfo if available (Python 3.9+)
try:
    from zoneinfo import ZoneInfo
    ET_TZ = ZoneInfo("America/New_York")
except ImportError:
    ET_TZ = None


def parse_hardrock_date(date_str: str) -> str:
    """Parse '27 Mar 2026 @ 1:14pm' as ET → UTC ISO 8601."""
    # Remove the @ separator
    cleaned = date_str.replace(" @ ", " ").strip()

    # Parse: "27 Mar 2026 1:14pm"
    for fmt in ("%d %b %Y %I:%M%p", "%d %b %Y %I:%M %p"):
        try:
            dt = datetime.strptime(cleaned, fmt)
            break
        except ValueError:
            continue
    else:
        raise ValueError(f"Unparseable Hard Rock date: '{date_str}'")

    # Apply ET timezone
    if ET_TZ:
        dt = dt.replace(tzinfo=ET_TZ)
        dt_utc = dt.astimezone(timezone.utc)
    else:
        # Fallback: assume EDT (UTC-4) for Mar-Nov, EST (UTC-5) otherwise
        month = dt.month
        is_dst = 3 <= month <= 10  # Rough DST approximation
        offset = ET_OFFSET_DST if is_dst else ET_OFFSET_STANDARD
        dt = dt.replace(tzinfo=timezone(offset))
        dt_utc = dt.astimezone(timezone.utc)

    return dt_utc.strftime("%Y-%m-%dT%H:%M:%SZ")


def reorder_name(name: str) -> str:
    """Convert 'Last, First' → 'First Last'. Pass through if no comma."""
    name = name.strip()
    if ", " in name:
        parts = name.split(", ", 1)
        return f"{parts[1]} {parts[0]}"
    return name


def parse_match(match_str: str) -> tuple[str, str]:
    """Parse 'Last, First vs. Last, First' → (First1 Last1, First2 Last2)."""
    # Hard Rock uses " vs. " as separator
    parts = match_str.split(" vs. ")
    if len(parts) != 2:
        # Fallback: try " vs " without period
        parts = match_str.split(" vs ")
    if len(parts) != 2:
        raise ValueError(f"Cannot parse match: '{match_str}'")

    return reorder_name(parts[0]), reorder_name(parts[1])


def infer_side(pick_name: str, p1_name: str, p2_name: str) -> str:
    """Infer bet_side by matching pick to players."""
    pick_normalized = reorder_name(pick_name).lower()
    if pick_normalized == p1_name.lower():
        return "P1"
    elif pick_normalized == p2_name.lower():
        return "P2"
    else:
        # Fuzzy: check if last name matches
        pick_last = pick_normalized.split()[-1] if pick_normalized.split() else ""
        p1_last = p1_name.lower().split()[-1] if p1_name.split() else ""
        p2_last = p2_name.lower().split()[-1] if p2_name.split() else ""
        if pick_last == p1_last:
            return "P1"
        elif pick_last == p2_last:
            return "P2"
        else:
            return "P1"  # Default with warning


def convert(input_path: str, output_path: str, dry_run: bool = False) -> None:
    """Convert Hard Rock XML export to CSV."""
    # Parse XML
    ns = {"ss": "urn:schemas-microsoft-com:office:spreadsheet"}
    tree = ET.parse(input_path)
    root = tree.getroot()

    rows = root.findall(".//ss:Row", ns)
    if len(rows) < 2:
        print("ERROR: No data rows found in export.")
        sys.exit(1)

    # Parse header
    header_cells = rows[0].findall("ss:Cell/ss:Data", ns)
    headers = [c.text for c in header_cells]
    print(f"Columns: {headers}")

    # Parse data rows
    raw_bets = []
    for row in rows[1:]:
        cells = row.findall("ss:Cell/ss:Data", ns)
        values = [c.text if c.text else "" for c in cells]
        if len(values) >= len(headers):
            raw_bets.append(dict(zip(headers, values)))

    print(f"Total rows: {len(raw_bets)}")

    # Convert
    converted = []
    errors = []

    for i, raw in enumerate(raw_bets, start=1):
        try:
            # Date
            date_utc = parse_hardrock_date(raw["Date Placed"])

            # Players
            p1_name, p2_name = parse_match(raw["Match"])

            # Pick
            pick_name = reorder_name(raw["Market"])
            side = infer_side(raw["Market"], p1_name, p2_name)

            # Odds
            odds = float(raw["Price"])

            # Stake
            wager = float(raw["Wager"])

            # Status → result
            status = raw["Status"]
            if status == "Won":
                result = "WIN"
                pnl = float(raw.get("Winnings", 0))
            elif status == "Lost":
                result = "LOSS"
                pnl = -wager
            elif status == "Cashed Out":
                result = "CASHOUT"
                payout = float(raw.get("Payout", 0))
                pnl = payout - wager  # Can be negative for early exits
            else:
                result = ""
                pnl = 0

            bet = {
                "date": date_utc,
                "p1_name": p1_name,
                "p2_name": p2_name,
                "pick": pick_name,
                "side": side,
                "odds": odds,
                "stake": wager,
                "pnl": round(pnl, 2),
                "result": result,
                "event_id": raw.get("Bet Slip ID", ""),
            }

            converted.append(bet)

        except (ValueError, KeyError) as e:
            errors.append(f"Row {i}: {e}")

    # Summary
    wins = sum(1 for b in converted if b["result"] == "WIN")
    losses = sum(1 for b in converted if b["result"] == "LOSS")
    cashouts = sum(1 for b in converted if b["result"] == "CASHOUT")
    total_pnl = sum(b["pnl"] for b in converted)

    print(f"\nConverted: {len(converted)} bets")
    print(f"  Won: {wins}, Lost: {losses}, Cashed Out: {cashouts}")
    print(f"  Net P&L: ${total_pnl:+,.2f}")
    print(f"  Date range: {converted[-1]['date'][:10]} to {converted[0]['date'][:10]}")

    if errors:
        print(f"\n  {len(errors)} error(s):")
        for err in errors[:10]:
            print(f"    - {err}")

    if dry_run:
        print("\n--- DRY RUN --- No file written.")
        print("\nFirst 5 bets:")
        for b in converted[:5]:
            print(f"  {b['date'][:16]}  {b['p1_name']} vs {b['p2_name']}  "
                  f"Pick: {b['pick']} ({b['side']})  @{b['odds']}  "
                  f"${b['stake']}  {b['result']}  P&L: ${b['pnl']:+.2f}")
        return

    # Write CSV
    fieldnames = ["date", "p1_name", "p2_name", "pick", "side", "odds",
                  "stake", "pnl", "result", "event_id"]

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(converted)

    print(f"\nWritten to {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Convert Hard Rock export to CSV")
    parser.add_argument("--input", required=True, help="Path to All_Bets_Export.xls")
    parser.add_argument("--output", required=True, help="Output CSV path")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    args = parser.parse_args()

    convert(args.input, args.output, args.dry_run)


if __name__ == "__main__":
    main()
