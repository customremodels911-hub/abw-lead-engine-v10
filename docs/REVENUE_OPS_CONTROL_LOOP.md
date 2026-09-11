# Revenue Ops Control Loop

## Purpose
Move V10 from passive lead ranking to active pipeline management.

## Production behavior
- Compute stage-weighted expected value for active opportunities.
- Boost overdue and stale opportunities in the revenue priority model.
- Maintain a five-item executive queue based on conversion probability, urgency, score and expected value.
- Repair missing next actions and due dates without hiding genuinely overdue actions.
- Persist a bounded revenue-ops state snapshot for command-center use.
- Exclude synthetic/test records from real revenue metrics.

## Control-plane endpoints
- `GET /api/command-center` — active opportunities, overdue count, missing actions, pipeline value, weighted pipeline value, coverage to the $1M target and five-item executive queue.
- `GET /api/revenue-ops/state` — last persisted sweep state.

## Schedules
- Public opportunity scan: every 30 minutes.
- Revenue ops sweep target: every 15 minutes.

## Current verification
Production source contains the `revenueOpsSweep` handler and the two-cron `cron.json`. AppDeploy deployment is healthy with no frontend/backend errors. The AppDeploy status surface is currently reporting only the public-opportunity cron as active, so the revenue-ops schedule must remain open until scheduler registration is visible in status. Do not mark that schedule complete prematurely.

## Operating rule
Warm replies, live homeowner requests, active bid/application steps and deposit/contract events outrank cold prospecting. Escalate only true owner-only blockers such as signatures, identity checks, binding spend, binding price or legal attestations.
