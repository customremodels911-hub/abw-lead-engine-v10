# Master Execution Architecture

## Ultimate Task
Build a low-touch revenue operating system that continuously discovers qualified demand, captures every opportunity, prioritizes the highest-probability cash actions, executes authorized nonbinding work, follows up relentlessly, and escalates only true owner-only blockers.

## System of Record
- Runtime source of truth: AppDeploy production V10
- Code / operating rules: GitHub main
- Business source of truth: persistent command-center records and connected systems
- Never rely on chat memory alone for critical status

## Active Markets
1. Charlotte / Lake Norman — NC Custom Remodels LLC
2. Hampton Roads / Virginia Beach — ABW Custom Remodels
3. New York City — ABW Custom Remodels

## Execution Flywheel
1. Discover: owned forms, authorized webhooks, public opportunities, vendor programs, connected inboxes, referrals, organic/search demand, and lawful outreach.
2. Capture: normalize all opportunities into one deduplicated lead record.
3. Qualify: project type, geography, contactability, urgency, estimated value, source quality, licensing/eligibility fit.
4. Score: prioritize inbound homeowner requests and live bid invitations over colder channels.
5. Act: prepare/send authorized follow-up, qualify, route, create documents, schedule next actions, and advance pipeline stage.
6. Convert: estimate -> contract -> deposit/payment -> scheduled work.
7. Retain: reviews, referrals, maintenance, upsell/cross-sell, repeat work.
8. Learn: measure source-to-cash conversion and shift effort toward channels producing real revenue.

## Five-Slot Active Queue
Only five execution priorities should be active at once. Rotate completed or blocked items out immediately.

### Slot 1 — Live Revenue
Highest-value inbound homeowner, active estimate, warm reply, deposit, contract, or immediate close action.

### Slot 2 — Lead Supply
Keep NC/VA/NY opportunity scanners, webhook intake, owned forms, and free/justified lead sources healthy.

### Slot 3 — Follow-Up
No qualified opportunity goes stale. Every active lead must have a next action and due state.

### Slot 4 — Distribution / Partnerships
Vendor lists, property managers, GCs, restoration firms, housing programs, supplier relationships, and institutional bid channels.

### Slot 5 — Infrastructure / Monetization
DNS, alerts, CRM integrity, website conversion, Stripe/digital product, analytics, reporting, tests, and deployment reliability.

## Automation Rules
- Automatically perform research, qualification, scoring, deduplication, preparation, routing, status updates, reminders, and authorized routine outreach.
- Do not spend money, sign contracts, submit legal attestations, authorize credit, or represent unverified credentials without owner approval.
- Separate test/synthetic records from real opportunities.
- Treat outreach as outreach, not a won job.
- Require a next action on every nonterminal qualified lead.

## Current Verified Infrastructure State — 2026-09-10
- AppDeploy V10 is deployed and healthy.
- Public-opportunity cron runs every 30 minutes and its latest run succeeded.
- Thumbtack webhook secret exists.
- Google Ads webhook secret exists.
- GitHub repository is live and writable.
- Production-to-GitHub sync commits exist for NYC, Hampton Roads, scoring, 90-day rules, and regression tests.
- Branded domain `leads.nccustomremodelsllc.com` is configured in AppDeploy but remains pending DNS.

## Immediate Execution Order
1. Activate branded lead-engine DNS.
2. Verify external webhook registration end-to-end with real provider test events.
3. Add/verify lead-alert delivery so high-priority leads surface immediately.
4. Enforce next-action/follow-up discipline for every qualified live opportunity.
5. Instrument source-to-cash reporting and weekly channel reallocation.
6. Continue Charlotte/Lake Norman, Hampton Roads, and NYC source expansion without duplicating existing channels.
7. Finish monetization dependencies such as Stripe verification/product launch when owner-only verification is required.

## Revenue Control Metrics
- Real qualified opportunities created
- Contactable leads
- P1/P2 opportunities
- Estimate requests
- Estimates sent
- Follow-ups due/overdue
- Contracts signed
- Deposits collected
- Cash collected
- Pipeline value
- Source conversion rate
- Days from lead creation to cash

## Truth / Audit Standard
Every task must be marked exactly one of: DONE, ACTIVE, BLOCKED, NEEDS OWNER, FAILED, or NOT STARTED. Never report a task as completed unless the underlying system confirms it.