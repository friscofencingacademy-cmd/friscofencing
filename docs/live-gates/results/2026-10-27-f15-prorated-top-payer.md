---
gate: f15-prorated-top-payer
result: blocked
env: staging
url: https://friscofencing-git-develop-frisco-fencing.vercel.app
commit: f310230
date: 2026-10-27
run_by: Claude (/live-gate, first run while building the skill)
recording: none
---

| # | Expect | Seen | Result |
|---|---|---|---|
| P1 | Audit fixtures: BridgeSecond active on Audit Level A, BridgeFirst active on Audit Level B | Read-only staging query (`friscofencing-staging`): both active, Tuesday and Thursday schedules, October paid | pass |
| P2 | Level A prorated amount today is below $50 | Tuesdays in Oct 2026: 6, 13, 20, 27; 1 of 4 left on Oct 27 → $100 × 1/4 = $25.00. Old bug would show $22.50 | pass |
| P3 | Staging serves #133 or later | `develop` at `f310230` (includes #133); both Vercel deployments `success` | pass |
| 1–9 | Browser steps | Not run: the Claude in Chrome extension was not connected (`list_connected_browsers` returned none) | blocked |

Expected values for the browser steps, for the re-run:
- BridgeSecond: Prorated from today `$25.00`, no sibling-discount line; Full month `$100.00`, no
  sibling-discount line.
- BridgeFirst: Thursdays in Oct 2026: 1, 8, 15, 22, 29; 1 of 5 left → $50 × 1/5 = $10.00;
  `− $1.00 sibling discount (10%)`; Total `$9.00`.

Notes: these amounts hold only on 2026-10-27, the last Tuesday of October. From 2026-10-28 Level A
has no Tuesdays left this month, so its prorated amount is $0, and $0 looks the same before and
after the fix. The next window is Wednesday 2026-11-18 through Tuesday 2026-11-24
(Level A prorates to $25.00); recompute both amounts on the day.
