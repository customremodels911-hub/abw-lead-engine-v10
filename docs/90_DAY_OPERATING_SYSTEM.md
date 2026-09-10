# 90-Day Revenue Operating System

## Mission
Turn qualified demand into cash revenue while preserving status accuracy, compliance, and owner control over binding commitments.

## Markets
1. Charlotte / Lake Norman — NC Custom Remodels LLC
2. Hampton Roads / Virginia Beach — ABW Custom Remodels
3. New York City — ABW Custom Remodels

## Operating Loop
1. Capture demand from owned forms, authorized webhooks, public opportunity sources, vendor programs, connected inboxes, and lawful business outreach.
2. Normalize every opportunity into one pipeline with market, project type, source, contactability, urgency, estimated value, score, and status.
3. Prioritize the highest-probability revenue actions first: inbound homeowner request > active agency/vendor application > warm reply > qualified subcontracting opportunity > cold outreach.
4. Execute nonbinding next actions automatically where authorized: research, qualification, document preparation, follow-up, routing, labeling, and routine outreach.
5. Escalate only the smallest owner-only blocker: signature, identity verification, portal login, binding price/contract, credit authorization, spending, or legal attestation.
6. Follow up until the opportunity reaches Won, Lost, Waiting, or Disqualified.

## Truth Rules
- Never call a vendor opportunity a homeowner lead.
- Never call outreach a secured job.
- Never claim a webhook is externally registered until verified end-to-end.
- Never invent license, insurance, EIN, bonding, certification, address, financial, or identity data.
- Separate synthetic/test leads from real opportunities.
- Prefer verified records from persistent business files and connected systems over memory.

## Lead Priority Model
Base score signals:
- Direct phone/contact path
- Verified email/contact path
- Clear project scope
- High-value project class
- Explicit demand language such as need, hire, quote, estimate, or looking for
- Strategic market fit

Priority tiers:
- P1: live homeowner/inbound request or active bid invitation
- P2: agency/vendor onboarding with real work pipeline
- P3: warm reply from property manager, GC, restoration firm, supplier, or referral partner
- P4: public demand signal with direct response path
- P5: cold prospecting target

## 90-Day Pace
Revenue target: $1,000,000 cash collected.
Reference pace: approximately $11,111/day, $77,778/7 days, and $333,333/30 days.
Maintain at least 3x qualified pipeline coverage where feasible.

## Market Rules
### North Carolina
Use NC Custom Remodels LLC. Prioritize Charlotte / Lake Norman, City/Housing programs, property managers, homeowner demand, supplier relationships, Google/organic demand capture, and free or economically justified marketplace channels.

### Virginia
Use ABW Custom Remodels. Do not position Virginia outreach around Charlotte. Prioritize Hampton Roads / Virginia Beach, housing rehabilitation, property managers, restoration/insurance networks, GCs, homeowner demand, and supplier/vendor programs.

### New York City
Use ABW Custom Remodels. Prioritize private remodeling, property managers, affordable housing managers, HPD, NYCHA, PASSPort/City Record, SCA/DDC where eligible, prime-contractor partnerships, and subcontracting. Never represent a bond, license, insurance policy, or certification as current unless verified.

## Document Durability
Critical business documents should not live only in temporary chat uploads. Store reusable copies in the persistent Business Command Center and recover source documents from connected email when possible. Mark expired credentials as historical, not current.

## Repository / Production Discipline
- AppDeploy production snapshot is the runtime source of truth.
- GitHub main should be synchronized after verified production changes.
- Never commit secrets.
- Keep tests aligned with user-visible workflows.
- Every market expansion must preserve deduplication, scoring, status accuracy, and separation of test versus real leads.
