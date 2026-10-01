# V10 Free-Host Migration Plan

## Goal
Move ABW Lead Engine V10 off AppDeploy while preserving the current production branch and changing lead priority toward urgent maintenance, emergency repair, insurance-related repair, and necessary property work.

## Proposed free stack
- GitHub: source control
- Render Free Web Service: Node/React application hosting
- Supabase Free: persistent PostgreSQL datastore
- cron-job.org: HTTP scheduler every 5 minutes for the V10 control loop
- Gemini Developer API Free Tier: optional replacement for AppDeploy ai.generate calls

## Migration branch
render-free-migration

## Maintenance-first priority
Highest priority:
- active leaks / water intrusion
- roof, chimney, flashing, venting failures
- mold-producing moisture conditions
- electrical failures, panel/breaker/outlet faults
- storm / wind / hail / tree damage
- insurance-related repairs and documentation
- HVAC / heat-pump failure where coordination or general repair is required
- structural / foundation concerns
- unsafe decks, porches, stairs, railings
- damaged fencing / exterior envelope
- make-ready / turnover / pre-sale repairs
- urgent drywall, flooring, siding and carpentry repairs

Secondary:
- planned bathroom, kitchen, addition, and cosmetic remodels without urgency

## Scoring changes
1. Add a maintenance/emergency intent score.
2. Boost leads containing urgent, leak, water, mold, storm, hail, wind, insurance, claim, damaged, failed, no power, breaker, unsafe, structural, foundation, roof, chimney, HVAC, repair, replace, today, ASAP, this week.
3. Rank emergency/insurance/necessary repair ahead of discretionary remodel when contactability and freshness are comparable.
4. Keep owner review required before outbound customer messages.
5. Preserve deduplication and compliance checks.

## Portability work
- Replace @appdeploy/sdk router with a standard Node HTTP framework.
- Replace @appdeploy/sdk db with PostgreSQL access.
- Replace AppDeploy secrets with environment variables.
- Replace @appdeploy/client with a small fetch-based API client.
- Replace AppDeploy cron.json with authenticated /api/control-loop endpoint called by cron-job.org.
- Replace ai.generate with Gemini API calls when GEMINI_API_KEY is configured; otherwise skip AI evolution while keeping core lead scanning/ranking operational.

## Free-tier constraints
- Render free web services spin down after 15 minutes without inbound traffic.
- The five-minute scheduler will call the control-loop endpoint and provide regular inbound traffic.
- Do not use Render free Postgres for persistent V10 data because it expires after 30 days.
- Use Supabase Free Postgres instead.
- Keep API keys only in server-side environment variables.

## Deployment sequence
1. Connect/create Supabase project.
2. Create V10 database schema and migrate any necessary lead records.
3. Port backend from AppDeploy SDK to Node/Postgres.
4. Port frontend API client.
5. Add maintenance/emergency scoring.
6. Deploy render-free-migration branch to Render Free Web Service.
7. Configure server-side environment variables.
8. Configure cron-job.org for /api/control-loop every 5 minutes.
9. Verify healthcheck, lead intake, scans, database persistence, scoring, and owner-review contact gating.
10. Only then consider merging migration changes back to main.
