---
id: f15-prorated-top-payer
feature: F15 — the Charge dialog's prorated option decides the sibling-discount top payer by plan
plan: docs/plans/sibling-discount-top-payer-by-plan-plan.md
env: staging
mutates: false
login: superadmin
---

# F15 — prorated charge does not discount the top payer

## Why
Before #133, a superadmin choosing **Charge → Prorated from today** for the child on the pricier
plan could see 10% off when the prorated amount fell below a cheaper sibling's plan fee. A pass
proves staging now ranks the top payer by plan in the dialog's preview, which is computed by the
same function and inputs as the real charge. This gate only reads the preview; it never confirms
a charge.

## Preconditions
- **Audit fixtures are seeded** (`cd backend && npm run audit:seed`). The bridge family has
  `Audit BridgeSecond` on **Audit Level A ($100/month, Tuesdays)** and `Audit BridgeFirst` on
  **Audit Level B ($50/month, Thursdays)**, both active. If either has no active subscription the
  run is `blocked`; re-run the live audit's S5 or ask the owner.
- **The prorated amount for Level A today is above $0 and below $50.** Prorated = $100 ×
  (Tuesdays left this month, today included) ÷ (Tuesdays in the month). Compute it before the run
  and write the arithmetic in the result. At $50 or more F15 cannot show, and at $0 the old and
  new code look the same: either way the run is `blocked`. In practice the window is the days
  with exactly one Tuesday left, from the Wednesday before the last Tuesday through that Tuesday
  ($25 in a four-Tuesday month, $20 in a five-Tuesday month; two left in a five-Tuesday month,
  $40, also works).
- **Staging serves #133 or later.** Note the `develop` commit in the result; if it cannot be
  determined, record `unknown` — the steps below still detect the old behaviour.

## Steps
| # | Do | Expect |
|---|---|---|
| 1 | Open `/admin/subscriptions` logged in as the staging superadmin | The Subscriptions table loads |
| 2 | Search for `BridgeSecond` | One active row: Audit BridgeSecond, Audit Class A |
| 3 | Click **Charge** on that row | The Charge dialog opens and loads its preview |
| 4 | Read the **Prorated from today** option label | It shows the computed prorated amount exactly (e.g. `$25.00`), not 90% of it (`$22.50`) |
| 5 | Select **Prorated from today** | The breakdown shows `Monthly fee: $100.00`, **no** sibling-discount line, and `Total:` equal to the step 4 amount |
| 6 | Select **Full month** | `Total: $100.00` and no sibling-discount line (top payer pays full) |
| 7 | Close the dialog with **Cancel** (never Confirm) | The dialog closes; nothing was charged |
| 8 | Search for `BridgeFirst`, click **Charge**, select **Prorated from today** | A `− $X sibling discount (10%)` line appears, where X is 10% of BridgeFirst's prorated amount (Level B: $50 × Thursdays left ÷ Thursdays in month), and Total = prorated − X |
| 9 | Close the dialog with **Cancel** | The dialog closes; nothing was charged |

An "already paid this month" notice and a disabled Confirm button are expected (the audit family's
month is paid). They do not affect this gate.

## Pass rule
Steps 4–6 show BridgeSecond's prorated and full-month totals with no sibling discount, and step 8
shows BridgeFirst's 10% discount on its own prorated amount, all matching the arithmetic.
