---
gate: charge-dialog-modes
result: pass
env: staging
url: https://friscofencing-git-develop-frisco-fencing.vercel.app
commit: 1e70067
date: 2026-10-27
run_by: Playwright (npm run gate), watched by the owner
recording: audit/gate-runs/2026-10-27-charge-dialog-modes/charge-dialog-modes-admin.webm
---

| # | Expect | Seen | Result |
|---|---|---|---|
| P1 | Audit FirstSibling is active, not in dunning, paid by card this month, next billing after today | inDunning false; paid $25.00 on Oct 26, 2026 (card); next billing Nov 1, 2026 | pass |
| P2 | Audit SecondSibling is active, not in dunning, paid by card this month, next billing after today | inDunning false; paid $9.00 on Oct 26, 2026 (card); next billing Nov 1, 2026 | pass |
| P3 | Audit RetryChild is active and in dunning (retryCount ≥ 1) with a failed charge | inDunning true; retry 1 of 3; failed amount $25.00 | pass |
| P4 | P_A for Level A today (computed) | Oct 27, 2026 (Central) → $100.00 × 1 ÷ 4 = $25.00 | pass |
| P5 | Staging serves the commit being promoted (recorded) | develop at 1e70067 | pass |
| 1 | The Subscriptions table loads; the sidebar shows Superadmin. | 25 rows; sidebar role "superadmin" | pass |
| 2 | Card selected; Full month and Prorated amounts; the already-paid notice; Monthly fee and Total equal the plan fee, no sibling line; the card on file; Confirm Charge disabled. | Charge Subscription · Audit FirstSibling · Audit Class A — Audit Level A · Already paid through this period. Not due until Nov 1, 2026 — the Confirm button unlocks then. · How to collect · Charge card on file · Record offline payment · Period covered · Full month — $100.00 · Prorated from today — $25.00 · Billing period · Nov 1, 2026 – Dec 1, 2026 · Breakdown · Monthly fee: $100.00 · Total: $100.… | pass |
| 3 | The month-already-paid notice; billing period today to the 1st of next month; Total P_A, no sibling line; Confirm Charge still disabled. | Charge Subscription · Audit FirstSibling · Audit Class A — Audit Level A · This month is already paid — $25.00 on Oct 26, 2026 (card). · How to collect · Charge card on file · Record offline payment · Period covered · Full month — $100.00 · Prorated from today — $25.00 · Billing period · Oct 27, 2026 – Nov 1, 2026 · Breakdown · Monthly fee: $100.00 · Total: $25.00 · Card on file · Visa •••• 4242 … | pass |
| 4 | Record Payment shown and disabled; Card on file replaced by Amount prefilled with P_A and an empty Note with its hint. | Record Payment disabled; Amount "25.00"; Note empty; "A note is required to record an offline payment." | pass |
| 5 | Amount re-prefills to the plan fee; the already-paid-through notice returns. | Amount "100.00"; notice "Already paid through this period…" | pass |
| 6 | Confirm Charge and Card on file return before closing; the dialog closes; the row is unchanged. | Confirm Charge and Card on file returned; dialog closed; row unchanged "Audit FirstSibling · Audit SiblingParent · audit-sibling-parent@example.com · Audit Class A · Audit Level A · Tuesday · 4:00 PM-5:00 PM Premium — any session ·…" | pass |
| 7 | Monthly fee, the 10% sibling line and the discounted Total and Full month amounts; Confirm Charge disabled. | Charge Subscription · Audit SecondSibling · Audit Class B — Audit Level B · Already paid through this period. Not due until Nov 1, 2026 — the Confirm button unlocks then. · How to collect · Charge card on file · Record offline payment · Period covered · Full month — $45.00 · Prorated from today — $9.00 · Billing period · Nov 1, 2026 – Dec 1, 2026 · Breakdown · Monthly fee: $50.00 · − $5.00 siblin… | pass |
| 8 | The retry-attempt notice; no Period covered; Monthly fee and the failed amount as Total; Confirm Charge enabled by design (never clicked). | Charge Subscription · Audit RetryChild · Audit Class A — Audit Level A · How to collect · Charge card on file · Record offline payment · Retry attempt 1 of 3 — charging the locked amount from the failed charge. · Billing period · Nov 1, 2026 – Dec 1, 2026 · Breakdown · Monthly fee: $100.00 · Total: $25.00 · Card on file · Visa •••• 0341 · Cancel · Confirm Charge | pass |
| 9 | The dunning notice; Amount prefilled with the failed amount; Record Payment disabled while Note is empty; the dialog closes. | "This subscription is in dunning (retry 1 of 3). Recording a payment below clears the retry cycle."; Amount "25.00"; Record Payment disabled; dialog closed | pass |

Notes:
- None.
