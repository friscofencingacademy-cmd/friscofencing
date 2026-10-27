---
gate: f15-prorated-top-payer
result: blocked
env: staging
url: https://friscofencing-git-develop-frisco-fencing.vercel.app
commit: 21465fb
date: 2026-10-27
run_by: Claude (/live-gate), invoked by the owner
recording: none
---

| # | Expect | Seen | Result |
|---|---|---|---|
| P1 | Audit fixtures: BridgeSecond and BridgeFirst each have an active subscription | Read-only query on `friscofencing-staging`: BridgeFirst 1 active, BridgeSecond 1 active | pass |
| P2 | Level A prorated amount today is above $0 and below $50 | Tue 2026-10-27, 12:39 Central; Tuesdays in Oct 2026: 6, 13, 20, 27; 1 of 4 left → $100 × 1/4 = $25.00 | pass |
| P3 | Staging serves #133 or later | `develop` at `21465fb` (#135, includes #133); both Vercel deployments `success` | pass |
| 1–9 | Browser steps | Not run: `tabs_context_mcp` reported the Claude in Chrome extension is not connected, and `list_connected_browsers` returned none | blocked |

Expected values were unchanged from the first run: BridgeSecond prorated `$25.00` and full month
`$100.00`, neither with a sibling-discount line; BridgeFirst `$10.00 − $1.00 = $9.00`.

Notes: today is the last day in October the gate can show the fix. The next window is Wednesday
2026-11-18 through Tuesday 2026-11-24.
