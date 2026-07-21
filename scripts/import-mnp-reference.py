#!/usr/bin/env python3
"""
One-time load of MNPhistoryfull.xlsx into the read-only `mnp_reference_games`
table (the historical reference used by the data-integrity check for
pre-archive seasons). One row per game, mirroring the sheet schema.

Usage:  python scripts/import-mnp-reference.py [--execute]
Without --execute it's a dry run (parses + prints a sample, inserts nothing).
"""
import os, re, sys, json, urllib.request, urllib.error
import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XLSX = os.path.join(ROOT, "MNPhistoryfull.xlsx")
TABLE = "mnp_reference_games"
BATCH = 500


def load_env():
    env = {}
    with open(os.path.join(ROOT, ".env.local"), encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def match_key(match_str):
    if not match_str:
        return None
    k = match_str.lower()
    k = re.sub(r"\s+@\s+", "-", k)
    k = re.sub(r"\s+", "-", k)
    return re.sub(r"[^a-z0-9-]", "", k)


def to_int(v):
    try:
        if v is None or v == "":
            return None
        return int(float(v))
    except (ValueError, TypeError):
        return None


def to_num(v):
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (ValueError, TypeError):
        return None


def clean(v):
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def build_records():
    wb = openpyxl.load_workbook(XLSX, read_only=True)
    records = []
    for ws in wb.worksheets:
        rows = ws.iter_rows(values_only=True)
        header = next(rows)
        hi = {str(c).strip().lower(): i for i, c in enumerate(header) if c is not None}
        game_seq = {}  # match_str -> running game number within the sheet
        for r in rows:
            def col(name):
                idx = hi.get(name)
                return r[idx] if idx is not None and idx < len(r) else None

            season = to_int(col("season"))
            if season is None:
                continue
            match_str = clean(col("match"))
            game_seq[match_str] = game_seq.get(match_str, 0) + 1
            rec = {
                "season": season,
                "week": to_int(col("week")),
                "match_str": match_str,
                "match_key": match_key(match_str),
                "game_date": clean(col("date")),
                "venue": clean(col("venue")),
                "home_team": clean(col("home_team")),
                "away_team": clean(col("away_team")),
                "round_number": to_int(col("round")),
                "game_number": game_seq[match_str],
                "machine": clean(col("machine")),
                "away_points": to_num(col("away_points")),
                "home_points": to_num(col("home_points")),
            }
            for p in (1, 2, 3, 4):
                rec[f"p{p}_name"] = clean(col(f"p{p}"))
                rec[f"p{p}_score"] = to_int(col(f"p{p}_score"))
                rec[f"p{p}_points"] = to_num(col(f"p{p}_points"))
            records.append(rec)
    return records


def post_batch(url, key, rows):
    data = json.dumps(rows).encode("utf-8")
    req = urllib.request.Request(
        f"{url}/rest/v1/{TABLE}",
        data=data,
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )
    with urllib.request.urlopen(req) as resp:
        return resp.status


def main():
    execute = "--execute" in sys.argv
    env = load_env()
    url = env["NEXT_PUBLIC_SUPABASE_URL"]
    key = env["SUPABASE_SERVICE_ROLE_KEY"]

    records = build_records()
    seasons = {}
    for r in records:
        seasons[r["season"]] = seasons.get(r["season"], 0) + 1
    print(f"Parsed {len(records)} game rows across seasons: "
          + ", ".join(f"{s}:{seasons[s]}" for s in sorted(seasons)))
    print("Sample:", json.dumps(records[0], indent=2)[:600])

    if not execute:
        print("\nDRY RUN — nothing inserted. Re-run with --execute to load.")
        return

    total = 0
    for i in range(0, len(records), BATCH):
        batch = records[i:i + BATCH]
        try:
            post_batch(url, key, batch)
        except urllib.error.HTTPError as e:
            print(f"HTTP {e.code} on batch {i // BATCH + 1}: {e.read().decode()[:400]}")
            sys.exit(1)
        total += len(batch)
        print(f"  inserted {total}/{len(records)}")
    print(f"\nDone — inserted {total} rows into {TABLE}.")


if __name__ == "__main__":
    main()
