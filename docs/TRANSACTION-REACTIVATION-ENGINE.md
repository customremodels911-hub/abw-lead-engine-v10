# V10 Transaction Reactivation Engine

## Purpose
Use authorized transaction history as evidence of proven customer relationships and prioritize who deserves follow-up. Transaction data is an input signal, not a contact list by itself.

## Core principle
The best reactivation candidate is not always the person who paid the most. V10 should rank the person with the strongest combination of:

1. Proven spend
2. Repeat-payment behavior
3. Recency
4. Project-specific payment evidence
5. Verified relationship type
6. Adjacent-project / expansion potential

## Score (0-100)
- Proven spend: 0-20
- Repeat-payment behavior: 0-20
- Recency: 0-15
- Project / invoice evidence: 0-20
- Relationship quality: -8 to +10
- Expansion potential: 0-15

### Hard exclusions
- Personal/family transfers
- Known friend/favor work when the goal is market-rate customer reactivation
- Self transfers
- Refunds/reimbursements unless separately verified as customer revenue
- Test payments
- Unattributed cash deposits until customer identity is independently verified

## Relationship buckets
- Retail customer
- B2B / contractor / referral partner
- Friend/favor
- Personal/family
- Ambiguous / research required

Never allow one bucket to contaminate another. A friend who paid for discounted work is not evidence of normal market-price demand.

## Opportunity tiers
- A: 75-100 — contact/review first
- B: 55-74 — strong candidate; enrich project context before outreach when needed
- C: below 55 — research first; do not prioritize over stronger opportunities
- DO_NOT_CONTACT — excluded relationship class

## Transaction-to-opportunity workflow
transaction -> payer normalization -> transfer/refund exclusion -> relationship classification -> project extraction from memo -> total paid / count / last paid -> adjacent-project inference -> score -> match against CRM/contact history -> personalized owner-review draft

## Critical safeguards
- Do not store raw bank/Venmo transaction history or customer PII in public source control.
- Do not infer a customer identity from an ATM/cash-deposit location alone.
- Do not auto-message a customer solely because a payment exists.
- Match against authorized contact/project history before outreach.
- Preserve existing V10 owner-review and compliance gates.

## Unattributed-cash recovery queue
Cash/ATM deposits can represent missing historical jobs. Store only date, amount, account and branch/location as a private research signal. Resolve identity by matching authorized invoices, emails, messages, calendar events or job records from the same date window. Never guess.

## Outcome learning
After outreach, record:
- reached / no response
- appointment booked
- estimate created
- won / lost
- deposit collected
- final revenue

Use those outcomes to adjust weights by project type, market, relationship type, ticket size and age. The score should optimize for collected cash, not response rate alone.
