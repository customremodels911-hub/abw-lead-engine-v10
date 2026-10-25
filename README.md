# ABW / NC Custom Remodels — V10 Control Center

This repository contains a public-signal backup, independent of the original Render website and AppDeploy runtime.

## Operator links
- **V10 application (AppDeploy):** https://abw-lead-engine-v10-0a05v1.v2.appdeploy.ai/
- **Independent public bid queue:** [NYC procurement snapshot](data/v10_public_bids.json)
- **Independent scheduled scan:** [GitHub Actions workflow](.github/workflows/v10-public-procurement.yml)
- **Latest scan executions:** https://github.com/customremodels911-hub/abw-lead-engine-v10/actions/workflows/v10-public-procurement.yml
- **Render application:** https://abw-lead-engine-v10-free.onrender.com/
- **Render's free database expiration:** October 31, 2026 at 12:38 PM Eastern. This independent public-signal snapshot does **not** prevent loss of any private data held in that database.

## What works without Render or AppDeploy
The independent Python scanner queries the official [NYC Open Data Current Solicitations](https://data.cityofnewyork.us/City-Government/Current-Solicitations/3khw-qi8f) dataset. It filters for construction and remodeling terms, checks deadlines, removes old and placeholder dates, and updates the public JSON snapshot. GitHub Actions runs it several times daily and can also be triggered manually. A failed data-source request leaves the last successful snapshot in place.

**Important:** The JSON contains only PUBLIC procurement information, not private homeowner or customer records. The entries are review-required bid signals, NOT direct customers, verified contacts, promises of work, or cash revenue. Some large bids may require licensing, insurance, bonding, procurement registration or partnerships with qualified prime contractors.

## Markets to review manually
North Carolina's [electronic Vendor Portal](https://evp.nc.gov/solicitations/) and Virginia's [eVA procurement marketplace](https://eva.virginia.gov/) publish opportunities that are not yet ingested automatically into this independent scanner. Do not claim either market is automatically scanned.

## Troubleshooting
1. Check latest Actions run result. Green = scheduled public-source collection succeeded at least once; it is not proof of customer conversions.
2. Open the snapshot; compare `generated_at_utc` and `count`.
3. For each opportunity, verify scope, deadline and qualifications in the issuing agency's bid portal.
4. Keep client identities, phone numbers, email addresses, addresses, and private CRM details OUT of this PUBLIC repository.
5. The full V10 application has independent limitations including AppDeploy credit quotas and third-party API permissions. Separate V10 app health from scheduled public procurement scanning.

## Core files
- `scripts/v10_public_procurement.py` — built-in self-tests and public NYC procurement API collection.
- `.github/workflows/v10-public-procurement.yml` — scheduled and manual GitHub Actions execution.
- `data/v10_public_bids.json` — latest public procurement signals.
- `.github/workflows/v10-keepalive.yml` — legacy Render health checking (does not eliminate Render free-tier sleeping).
