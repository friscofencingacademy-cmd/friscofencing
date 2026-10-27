---
gate: register-quote
result: pass
env: staging
url: https://friscofencing-git-develop-frisco-fencing.vercel.app
commit: 1e70067
date: 2026-10-27
run_by: Playwright (npm run gate), watched by the owner
recording: audit/gate-runs/2026-10-27-register-quote/register-quote-parent.webm
---

| # | Expect | Seen | Result |
|---|---|---|---|
| P1 | Audit DeclineChild has no active subscription | none active | pass |
| P2 | Audit Level A and Audit Level B both have registrationFee 0 | Audit Level B $50.00/month, registrationFee 0; Audit Level A $100.00/month, registrationFee 0 | pass |
| P3 | A this-month start date exists (read from the page at step 3; steps 4–5 skip without one) | checked at step 3 | pass |
| P4 | Staging serves the commit being promoted (recorded) | develop at 1e70067 | pass |
| 1 | Register for a Class; a DeclineChild card with no Already enrolled badge; the Live Quote / Summary panel. | Card "A · Audit DeclineChild · Age 11"; panel "Live Quote · Summary · Child · — · Level · — · Start Date · — · Monthly Fee · — · Register & Pay" | pass |
| 2 | Choose your level appears with both audit levels and their monthly fees. | Audit Level B · $50/month \| Audit Level A · $100/month | pass |
| 3 | This month's dates as pills with times, plus Enroll for next month naming its first class. | Audit Level B: 1 this-month date(s), first "Thu, Oct 29, 2026 · 5:00 PM–6:00 PM"; "First class: Thu, Nov 5, 2026 · 5:00 PM–6:00 PM" | pass |
| 4 | Monthly Fee; Prorated r of t class days at the daily rate; no Registration Fee; Due at enrollment the prorated amount; Full price starts the 1st of next month; no Sibling Discount; the inline Add Card form. | Thu, Oct 29, 2026 · 5:00 PM–6:00 PM: Monthly Fee $50; Prorated 1 of 5 class days · $10.00/day; Due $10.00; Full price starts Nov 1, 2026; Add Card shown ($50.00 × 1 ÷ 5 = $10.00) | pass |
| 5 | The button is visible and disabled (no card on file); it is never clicked. | Register & Pay visible and disabled; not clicked | pass |
| 6 | The button turns primary; Start Date the named first class; the full Monthly Fee due; no Prorated, no Registration Fee; Plan renews the 1st of the month after next. | Start Date Thu, Nov 5, 2026 · 5:00 PM–6:00 PM; Monthly Fee $50; Due $50.00; Plan renews Dec 1, 2026 | pass |
| 7 | The start date resets with the level; that level's own full fee is Due at enrollment, no Prorated, no Registration Fee. | Audit Level A: Start Date reset to "—"; Due at enrollment $100.00; no Prorated, no Registration Fee | pass |
| 8 | The parent dashboard loads; nothing was registered (no active subscription, re-checked read-only). | /parent/dashboard loaded; Audit DeclineChild still has no active subscription | pass |

Notes:
- None.
