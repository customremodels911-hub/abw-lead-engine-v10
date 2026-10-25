#!/usr/bin/env python3
"""Fallback V10 procurement collector.

Reads PUBLIC NYC procurement notices from the official NYC Open Data API.
Stores only public solicitation metadata in this PUBLIC GitHub repository.
This is not a CRM, private lead store, or automatic customer-contact system.
"""
from __future__ import annotations
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BASE = "https://data.cityofnewyork.us/resource/3khw-qi8f.json"
SOURCE_PAGE = "https://data.cityofnewyork.us/City-Government/Current-Solicitations/3khw-qi8f"
OUT = Path("data/v10_public_bids.json")
KEYWORDS = {
    "electrical": 6, "lighting": 5, "construction": 4, "renovation": 5,
    "remodel": 5, "rehabilitation": 5, "roof": 5, "floor": 4, "plumbing": 4,
    "hvac": 4, "repair": 4, "maintenance": 4, "building": 2,
    "bathroom": 6, "facility": 2, "facilities": 2, "fence": 5,
    "carpentry": 5, "painting": 4, "interior": 3, "window": 4,
    "door": 3, "demolition": 3, "sprinkler": 5, "waterproof": 5,
}
EXCLUDE = ("notice of award", "contract award", "sole source", "intent to award")
MAX_RESULTS = 80

def score(text: str) -> int:
    words = text.lower()
    return sum(weight for word, weight in KEYWORDS.items()
               if re.search(r"\b" + re.escape(word) + r"\w*\b", words))

def normalize(row: dict, today: dt.date) -> dict | None:
    if not isinstance(row, dict):
        return None
    title = str(row.get("short_title") or "").strip()
    if not title or any(term in title.lower() for term in EXCLUDE):
        return None
    due_raw = str(row.get("due_date") or "")[:10]
    try:
        due = dt.date.fromisoformat(due_raw)
    except ValueError:
        return None
    if due < today:
        return None
    details = " ".join(str(row.get(k) or "") for k in
                       ("short_title", "category_description", "additional_description_1"))
    priority = score(details)
    if priority < 4:
        return None
    request_id = str(row.get("request_id") or row.get("pin") or "").strip()
    if not request_id:
        return None
    kind = str(row.get("type_of_notice_description") or "").lower()
    if "award" in kind:
        return None
    return {
        "id": request_id,
        "title": title[:220],
        "agency": str(row.get("agency_name") or "")[:120],
        "due_date": due.isoformat(),
        "score": priority,
        "category": str(row.get("category_description") or "")[:100],
        "source": "NYC Open Data · Current Solicitations",
        "source_url": SOURCE_PAGE,
        "pin": str(row.get("pin") or "")[:80],
        "verification": "Public procurement signal; scope, licensing, eligibility and availability require manual verification",
        "next_action": "Review official bid notice and bidding portal before responding",
    }

def fetch(today: dt.date) -> tuple[list[dict], str]:
    params = {
        "$limit": "2000",
        "$where": "due_date >= '" + today.isoformat() + "T00:00:00'",
        "$order": "due_date ASC",
    }
    url = BASE + "?" + urlencode(params)
    req = Request(url, headers={
        "User-Agent": "NC-Custom-Remodels-V10-Public-Procurement-Scanner/1.0",
        "Accept": "application/json",
    })
    with urlopen(req, timeout=35) as res:
        if res.status != 200:
            raise RuntimeError(f"NYC Open Data returned HTTP {res.status}")
        rows = json.load(res)
    if not isinstance(rows, list):
        raise ValueError("Unexpected API response shape")
    if not rows:
        return [], url
    matches = [item for row in rows if (item := normalize(row, today)) is not None]
    unique = {item["id"]: item for item in matches}
    ordered = sorted(unique.values(), key=lambda x: (-x["score"], x["due_date"]))
    return ordered[:MAX_RESULTS], url

def test() -> None:
    today = dt.date(2026, 10, 25)
    lead = normalize({"short_title": "Electrical repairs at City facility",
        "due_date": "2026-11-08T15:00:00.000", "request_id": "42",
        "agency_name": "City Facilities"}, today)
    assert lead and lead["id"] == "42" and lead["score"] >= 4
    assert normalize({"short_title": "Electrical repairs",
        "due_date": "2026-10-01", "request_id": "43"}, today) is None
    assert normalize({"short_title": "Office supplies",
        "due_date": "2026-11-08", "request_id": "44"}, today) is None
    assert normalize({"short_title": "Notice of award: electrical work",
        "due_date": "2026-11-08", "request_id": "45"}, today) is None
    print("SELF TEST PASSED: relevance, future deadlines, and award exclusions")

def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--self-test", action="store_true")
    args = p.parse_args()
    if args.self_test:
        test()
        return
    now = dt.datetime.now(dt.timezone.utc)
    today = now.date()
    opportunities, request_url = fetch(today)
    previous: dict = {}
    if OUT.exists():
        try:
            previous = json.loads(OUT.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            previous = {}
    old_ids = {str(item.get("id")) for item in previous.get("opportunities", [])
               if isinstance(item, dict)}
    new_ids = [item["id"] for item in opportunities if item["id"] not in old_ids]
    result = {
        "generated_at_utc": now.replace(microsecond=0).isoformat(),
        "source": "NYC Open Data / Current Solicitations",
        "api_endpoint": BASE,
        "source_page": SOURCE_PAGE,
        "dataset_request_url": request_url,
        "market": "New York City",
        "count": len(opportunities),
        "new_since_previous_run": len(new_ids),
        "note": "PUBLIC procurement signals, not verified customers, contacts, bookings, or earned revenue.",
        "opportunities": opportunities,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"V10 fallback scan: {len(opportunities)} NYC public bid signals, "
          f"{len(new_ids)} newly observed, updated {OUT}")
    for item in opportunities[:10]:
        print(f"  {item['due_date']} | {item['agency']} | {item['title']} | ID {item['id']}")

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"V10 SCAN FAILED (existing data left intact): {exc}", file=sys.stderr)
        sys.exit(1)
