---
gate: payment-history
result: pass
env: staging
url: https://friscofencing-git-develop-frisco-fencing.vercel.app
commit: 1e70067
date: 2026-10-27
run_by: Playwright (npm run gate), watched by the owner
recording: audit/gate-runs/2026-10-27-payment-history/payment-history-admin.webm, audit/gate-runs/2026-10-27-payment-history/payment-history-parent.webm
---

| # | Expect | Seen | Result |
|---|---|---|---|
| P1 | Bridge family's ledger rows, newest first (both children active) | Audit BridgeSecond $22.50 completed card; Audit BridgeFirst $10.00 completed card | pass |
| P2 | Audit RetryChild has a failed ledger row | failed $25.00 (card) | pass |
| P3 | Staging serves the commit being promoted (recorded) | develop at 1e70067 | pass |
| 1 | A Payment History dialog with the family intro, the seven columns, and one row per ledger row, newest first, each cell exactly as the ledger says. | Payment History · Every payment on file for Audit BridgeParent's family, straight from our billing records. · Date · Student · For · Amount · Status · Method · Invoice · Oct 26, 2026 · Audit BridgeSecond · Group Class Registration — Audit Class A (Audit Level A) · Oct 27, 2026 – Nov 1, 2026 · $22.50 · Paid · Card · Download · Oct 26, 2026 · Audit BridgeFirst · Group Class Registration — Audit Class B (Audit Level B) · Oct 29, 2026 – Nov 1, 2026 · $10.00 · Paid · Card · Download · Close | pass |
| 2 | The dialog closes. | Dialog closed | pass |
| 3 | The failed row shows its amount, Status Failed, Method Card, and Invoice — (no Download link). | Oct 26, 2026 · Audit RetryChild · Group Class Registration — Audit Class A (Audit Level A) · Oct 27, 2026 – Nov 1, 2026 · $25.00 · Failed · Card · — | pass |
| 4 | The dialog closes. | Dialog closed | pass |
| 5 | The parent portal loads; the sidebar shows My Registrations and Payment History as separate entries. | Sidebar links "My Registrations" and "Payment History" | pass |
| 6 | /parent/billing with its title and intro, and the same rows as step 1. | 2 rows, identical to step 1: Oct 26, 2026 · Audit BridgeSecond · Group Class Registration — Audit Class A (Audit Level A) · Oct 27, 2026 – Nov 1, 2026 · $22.50 · Paid · Card · Download \| Oct 26, 2026 · Audit BridgeFirst · Group Class Registration — Audit Class B (Audit Level B) · Oct 29, 2026 – Nov 1, 2026 · $10.00 · Paid · Card · Download | pass |
| 7 | A row per child: Last Payment is that child's newest ledger amount with its chips; Sibling Discount (Current) is Full price for the top payer and 10% off the cheaper plan. | Audit BridgeFirst: Last Payment $10.00 [Prorated first month]; Current "10% sibling — $45.00/mo · This is the lower-priced plan among your active children, so the 10% sibling discount applies here."; Audit BridgeSecond: Last Payment $22.50 [10% sibling, Prorated first month]; Current "Full price · Your other child has the lower-priced plan, so the sibling discount applies to their plan instead." | pass |

Notes:
- None.
