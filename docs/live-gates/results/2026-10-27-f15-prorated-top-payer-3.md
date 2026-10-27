---
gate: f15-prorated-top-payer
result: pass
env: staging
url: https://friscofencing-git-develop-frisco-fencing.vercel.app
commit: 21465fb
date: 2026-10-27
run_by: Claude (/live-gate), watched by the owner
recording: 2026-10-27-f15-prorated-top-payer.gif
---

| # | Expect | Seen | Result |
|---|---|---|---|
| P1 | Audit fixtures: BridgeSecond and BridgeFirst each have an active subscription | Read-only query on `friscofencing-staging` (run 2, minutes earlier): 1 active each | pass |
| P2 | Level A prorated amount today is above $0 and below $50 | Tue 2026-10-27, 13:00 Central; Tuesdays in Oct 2026: 6, 13, 20, 27; 1 of 4 left → $100 × 1/4 = $25.00 | pass |
| P3 | Staging serves #133 or later | `develop` at `21465fb` (#135, includes #133); both Vercel deployments `success` | pass |
| 1 | Subscriptions table loads | "SUBSCRIPTIONS · 25 total", rows listed; tab already logged in as Superadmin | pass |
| 2 | One active row: Audit BridgeSecond, Audit Class A | "1 total — Audit BridgeSecond · Audit Class A · Audit Level A · Active" | pass |
| 3 | Charge dialog opens and loads its preview | "CHARGE SUBSCRIPTION — Audit BridgeSecond", "Already paid through this period. Not due until Nov 1, 2026 — the Confirm button unlocks then." | pass |
| 4 | Prorated label shows $25.00, not $22.50 | "Prorated from today — $25.00" | pass |
| 5 | Monthly fee $100.00, no sibling line, Total $25.00 | "Billing period Oct 27, 2026 – Nov 1, 2026 · Monthly fee: $100.00 · Total: $25.00", no sibling line | pass |
| 6 | Total $100.00, no sibling line | "Full month — $100.00 · Monthly fee: $100.00 · Total: $100.00", no sibling line | pass |
| 7 | Dialog closes; nothing charged | Dialog closed; row's Last payment unchanged "$22.50 10% sibling" | pass |
| 8 | BridgeFirst prorated: $50 × 1/5 = $10.00, − $1.00 sibling discount (10%), Total $9.00 | "Prorated from today — $9.00 · Monthly fee: $50.00 · − $1.00 sibling discount (10%) · Total: $9.00" (Thursdays Oct 1, 8, 15, 22, 29; 1 of 5 left) | pass |
| 9 | Dialog closes; nothing charged | Dialog closed; row's Last payment unchanged "$10.00" | pass |

Notes:
- Confirm Charge was disabled throughout ("This month is already paid") and was never clicked.
- BridgeSecond's Last payment column shows "$22.50 10% sibling" from its Oct 26 registration. That
  is ADR 006's first-month registration bridge, which the owner chose to keep. It is not the F15
  path, which is the Charge dialog's prorated option checked above.
- The tab was already signed in as the staging superadmin, so no password was typed.
- Full month for BridgeFirst showed $45.00 (10% off $50), as expected for the cheaper sibling.
