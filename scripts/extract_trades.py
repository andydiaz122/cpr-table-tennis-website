#!/usr/bin/env python3
"""Extract trade data from apollo_dashboard.html into trades.json."""

import json
import re
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
HTML_PATH = os.path.join(PROJECT_DIR, "apollo_dashboard.html")
OUTPUT_PATH = os.path.join(SCRIPT_DIR, "..", "data", "trades.json")


def extract_trades(html_path):
    with open(html_path, "r", encoding="utf-8") as f:
        html = f.read()

    # Find all table rows in tbody
    row_pattern = re.compile(r"<tr[^>]*>\s*(.*?)\s*</tr>", re.DOTALL)
    td_pattern = re.compile(r"<td[^>]*>(.*?)</td>", re.DOTALL)
    tag_strip = re.compile(r"<[^>]+>")

    # Find the tbody section
    tbody_match = re.search(r"<tbody>(.*?)</tbody>", html, re.DOTALL)
    if not tbody_match:
        raise ValueError("No <tbody> found in HTML")

    tbody = tbody_match.group(1)
    rows = row_pattern.findall(tbody)

    trades = []
    for row in rows:
        cells = td_pattern.findall(row)
        if len(cells) < 11:
            continue

        # Cell 0: id
        trade_id = int(tag_strip.sub("", cells[0]).strip())

        # Cell 1: date "2026-02-19 01:30" -> "2026-02-19T01:30:00Z"
        date_str = tag_strip.sub("", cells[1]).strip()
        date_iso = date_str.replace(" ", "T") + ":00Z"

        # Cell 2: match "Milan Smrcek vs Petr Picek"
        match = tag_strip.sub("", cells[2]).strip()

        # Cell 3: pick + side - e.g. 'Milan Smrcek<span...>P1</span>'
        pick_html = cells[3]
        side_match = re.search(r">(P[12])<", pick_html)
        side = side_match.group(1) if side_match else ""
        pick = tag_strip.sub("", pick_html).replace(side, "").strip()

        # Cell 4: odds "2.25"
        odds = float(tag_strip.sub("", cells[4]).strip())

        # Cell 5: model_prob "51.6%" -> 0.516
        prob_str = tag_strip.sub("", cells[5]).strip().replace("%", "")
        model_prob = round(float(prob_str) / 100, 4)

        # Cell 6: edge "16.02%" -> 0.1602
        edge_str = tag_strip.sub("", cells[6]).strip().replace("%", "")
        edge = round(float(edge_str) / 100, 4)

        # Cell 7: stake "$0.96" -> 0.96
        stake_str = tag_strip.sub("", cells[7]).strip()
        stake = round(float(stake_str.replace("$", "")), 2)

        # Cell 8: pnl "+$1.20" or "$-0.34"
        pnl_str = tag_strip.sub("", cells[8]).strip()
        pnl = round(float(pnl_str.replace("$", "").replace("+", "")), 2)

        # Cell 9: cum_pnl
        cum_str = tag_strip.sub("", cells[9]).strip()
        cum_pnl = round(float(cum_str.replace("$", "").replace("+", "")), 2)

        # Cell 10: result "WIN" or "LOSS"
        result = tag_strip.sub("", cells[10]).strip()

        trades.append({
            "id": trade_id,
            "date": date_iso,
            "match": match,
            "pick": pick,
            "side": side,
            "odds": odds,
            "model_prob": model_prob,
            "edge": edge,
            "stake": stake,
            "pnl": pnl,
            "cum_pnl": cum_pnl,
            "result": result,
        })

    return trades


if __name__ == "__main__":
    trades = extract_trades(HTML_PATH)
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(trades, f, indent=2)
    print(f"Extracted {len(trades)} trades to {OUTPUT_PATH}")
