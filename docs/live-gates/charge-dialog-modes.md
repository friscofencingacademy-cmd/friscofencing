---
id: charge-dialog-modes
feature: The superadmin Charge dialog — card vs offline, full vs prorated, the already-paid guard, sibling breakdown and dunning
plan: docs/plans/payment-airtight-plan.md
env: staging
mutates: false
login: superadmin
---

# Charge dialog modes

## Why
The Charge dialog on `/admin/subscriptions` is the one place staff move money by hand. A wrong
amount, a lost "already paid" guard, or a Confirm button that unlocks when it should not, charges a
family twice (the $403.82 incident behind `payment-airtight-plan.md`). A pass proves, on the real
deployed app, that every mode of the dialog shows the backend's amounts and keeps Confirm locked
for an already-paid month. Covers #72 (Charge button), #80 (card/manual × full/prorated and the
one-payment-per-month guard), #92 (dialog messaging) and #48 (dunning). F15's top-payer rule has
its own gate, `f15-prorated-top-payer`. This gate only reads; it never confirms or records.

## Preconditions
- **Audit fixtures are seeded and the live audit has run this month** (`cd backend && npm run
  audit:seed`, then the live audit). Check read-only on `friscofencing-staging`:
  - `Audit FirstSibling` (Audit Level A, $100, Tuesdays) and `Audit SecondSibling` (Audit Level B,
    $50, Thursdays) are `active`, not in dunning, each with a `completed` card ledger row for this
    calendar month (`periodMonth`), and `nextBillingDate` after today.
  - `Audit RetryChild` is `active` with `retryCount` ≥ 1 and a `failed` ledger row for this month.
    If the retry job has since cancelled it, steps 8–9 cannot run: the run is `blocked` until the
    live audit's S6 re-creates it.
- **Compute the expected amounts** and write the arithmetic in the result:
  - `P_A` = $100 × (Tuesdays left this month, today included) ÷ (Tuesdays in the month). If no
    Tuesday is left, the prorated option may read `$0.00`; that is still a valid run.
  - FirstSibling's paid amount and date this month, and RetryChild's failed amount, from the ledger.
- **Staging serves the commit being promoted.** Record the `develop` commit in the result.

## Steps
| # | Do | Expect |
|---|---|---|
| 1 | Open `/admin/subscriptions` logged in as the staging superadmin | The Subscriptions table loads; the sidebar shows `Superadmin` |
| 2 | Search `FirstSibling` and click **Charge** on its row | The dialog shows `Audit FirstSibling`, `Audit Class A — Audit Level A`; **Charge card on file** is selected; `Full month — $100.00` and `Prorated from today — $P_A`; the green notice `Already paid through this period. Not due until <nextBillingDate> — the Confirm button unlocks then.`; Breakdown `Monthly fee: $100.00`, no sibling line, `Total: $100.00`; `Card on file` shows a card (`Visa •••• 4242`); **Confirm Charge** is disabled |
| 3 | Select **Prorated from today** | The notice changes to `This month is already paid — $<paid> on <paid date> (card).`; Billing period runs from today to the 1st of next month; `Total: $P_A`, no sibling line; **Confirm Charge** still disabled |
| 4 | Select **Record offline payment** | The button now reads **Record Payment** and is disabled; `Card on file` is replaced by **Amount** prefilled with `P_A` (e.g. `25.00`) and an empty **Note** with the hint `A note is required to record an offline payment.` Type nothing |
| 5 | Select **Full month** | **Amount** re-prefills to `100.00`; the notice returns to `Already paid through this period…` |
| 6 | Select **Charge card on file**, then close with **Cancel** | The button read **Confirm Charge** again and `Card on file` returned before closing; the dialog closes; the row's Last payment is unchanged |
| 7 | Search `SecondSibling`, click **Charge** (Full month is selected) | Breakdown `Monthly fee: $50.00`, `− $5.00 sibling discount (10%)`, `Total: $45.00`; `Full month — $45.00`; **Confirm Charge** disabled. Close with **Cancel** |
| 8 | Search `RetryChild`, click **Charge** | With **Charge card on file** selected: the red notice `Retry attempt <n> of <N> — charging the locked amount from the failed charge.`; **no** Period covered radios; Breakdown `Monthly fee: $100.00` and `Total: $<failed amount>`. **Confirm Charge is enabled here by design (a dunning retry is always actionable) — do not click it** |
| 9 | Select **Record offline payment**, then close with **Cancel** | The red notice `This subscription is in dunning (retry <n> of <N>). Recording a payment below clears the retry cycle.`; **Amount** prefilled with the failed amount; **Record Payment** disabled while Note is empty. The dialog closes; nothing was charged or recorded |

## Pass rule
Every step's Expect holds. Compare exactly: `P_A` in steps 2–4, `100.00` in step 5, `$45.00` and
`− $5.00` in step 7, and the failed amount in steps 8–9. Confirm Charge / Record Payment is never
clicked; a run that clicks either is void.
