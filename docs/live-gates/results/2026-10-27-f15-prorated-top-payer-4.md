---
gate: f15-prorated-top-payer
result: pass
env: staging
url: https://friscofencing-git-develop-frisco-fencing.vercel.app
commit: 1e70067
date: 2026-10-27
run_by: Playwright (npm run gate), watched by the owner
recording: audit/gate-runs/2026-10-27-f15-prorated-top-payer/f15-prorated-top-payer-admin.webm
---

| # | Expect | Seen | Result |
|---|---|---|---|
| P1 | Audit fixtures: BridgeSecond and BridgeFirst each have an active subscription | Audit BridgeSecond: active; Audit BridgeFirst: active | pass |
| P2 | Audit Level A prorated amount today is above $0 and below $50.00 | Oct 27, 2026 (Central); Tuesdays left 1 of 4 → $100.00 × 1 ÷ 4 = $25.00 | pass |
| P3 | Staging serves #133 or later (recorded) | develop at 1e70067; both Vercel deployments success | pass |
| 1 | The Subscriptions table loads. | 25 rows; first: "Audit RetryChild · Audit RetryParent · audit-retry-parent@example.com · Audit Class A · Audit Level A · Tuesday · 4:00 …" | pass |
| 2 | One active row: Audit BridgeSecond, Audit Class A. | Audit BridgeSecond · Audit BridgeParent · audit-bridge-parent@example.com · Audit Class A · Audit Level A · Tuesday · 4:00 PM-5:00 PM Premium — any session · Audit Coach · Nov 1, 2026 · $22.50 10% sibling Prorated first month · Active · Pa… | pass |
| 3 | The Charge dialog opens and loads its preview. | Charge Subscription · Audit BridgeSecond · Audit Class A — Audit Level A · Already paid through this period. Not due until Nov 1, 2026 — the Confirm button unlocks then. · How to collect · Charge card on file · Record offline payment · Per… | pass |
| 4 | It shows the computed prorated amount exactly, not 90% of it. | Prorated from today — $25.00 | pass |
| 5 | Monthly fee is the plan fee, no sibling-discount line, Total equals the step 4 amount. | Charge Subscription · Audit BridgeSecond · Audit Class A — Audit Level A · This month is already paid — $22.50 on Oct 26, 2026 (card). · How to collect · Charge card on file · Record offline payment · Period covered · Full month — $100.00 … | pass |
| 6 | Total is the full plan fee and no sibling-discount line. | Charge Subscription · Audit BridgeSecond · Audit Class A — Audit Level A · Already paid through this period. Not due until Nov 1, 2026 — the Confirm button unlocks then. · How to collect · Charge card on file · Record offline payment · Per… | pass |
| 7 | The dialog closes; nothing was charged. | Dialog closed; row unchanged "Audit BridgeSecond · Audit BridgeParent · audit-bridge-parent@example.com · Audit Class A · Audit Level A · Tuesday · 4:00 PM-5:00 PM Premium — any session · A…" | pass |
| 8 | A 10% sibling-discount line on BridgeFirst's own prorated amount, and Total = prorated − discount. | Charge Subscription · Audit BridgeFirst · Audit Class B — Audit Level B · This month is already paid — $10.00 on Oct 26, 2026 (card). · How to collect · Charge card on file · Record offline payment · Period covered · Full month — $45.00 · … | pass |
| 9 | The dialog closes; nothing was charged. | Dialog closed; row unchanged "Audit BridgeFirst · Audit BridgeParent · audit-bridge-parent@example.com · Audit Class B · Audit Level B · Thursday · 5:00 PM-6:00 PM Premium — any session · A…" | pass |

Notes:
- None.
