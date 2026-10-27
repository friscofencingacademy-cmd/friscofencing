---
id: payment-history
feature: Payment history from the Registration ledger — the admin Payment History dialog, the parent Payment History page, and My Registrations' Last Payment / current sibling discount
plan: docs/plans/payment-airtight-plan.md
env: staging
mutates: false
login: superadmin, then audit-parent:audit-bridge-parent@example.com
---

# Payment history

## Why
Parents and staff must see exactly what was charged, read only from the `Registration` ledger
(never `Subscription.lastChargeAmount`), with failed charges marked and an invoice for every paid
row. A pass proves the admin dialog and the parent pages show the same rows as the ledger, and
that My Registrations' "Sibling Discount (Current)" names the right top payer (F15's #131/#133
display side). Covers #81 (parent billing history), #88 (admin payment history), #73/#89 (invoice
link). This gate never clicks Download (opening the PDF is a download) and never changes data.

## Preconditions
- **Audit fixtures are seeded and the live audit has run this month.** Read through the API by the
  runner (superadmin, GET only), recorded in the result:
  - Every ledger row of `audit-bridge-parent@example.com`'s family, newest first: student,
    amount, status, method, `periodStart`–`periodEnd`. Today's fixtures give two `completed` card
    rows: BridgeSecond (Audit Level A) and BridgeFirst (Audit Level B).
  - `Audit RetryChild` has a `failed` ledger row.
- **The bridge parent can sign in.** Steps 5–7 run as `audit-bridge-parent@example.com` in its own
  browser context, signed in by the script from `audit/.env` (`AUDIT_TEST_PASSWORD`) before the
  run starts. The superadmin context stays signed in beside it. Claude never types a password.
- **Staging serves the commit being promoted.** Record the `develop` commit in the result.

## Steps
| # | Do | Expect |
|---|---|---|
| 1 | As superadmin, open `/admin/subscriptions`, search `BridgeFirst`, click **Payment History** | A `Payment History` dialog: `Every payment on file for Audit BridgeParent's family, straight from our billing records.`; a table with columns `Date · Student · For · Amount · Status · Method · Invoice`; one row per ledger row from the precondition, newest first. Each group-class row reads `Group Class Registration — Audit Class A (Audit Level A)` (or Class B / Level B), its period line (e.g. `Oct 27, 2026 – Nov 1, 2026`), the exact amount, `Paid`, `Card`, and a `Download` link |
| 2 | Close the dialog with **Close** | The dialog closes |
| 3 | Search `RetryChild`, click **Payment History** | The failed row shows its amount, Status `Failed`, Method `Card`, and Invoice `—` (no Download link) |
| 4 | Close the dialog with **Close** | The dialog closes |
| 5 | Open the parent portal in the bridge-parent context (signed in by the script) | The parent portal loads; the sidebar shows **My Registrations** and **Payment History** as separate entries |
| 6 | Click **Payment History** in the sidebar | `/parent/billing` with the title `Payment History` and `Every charge on file for your family, straight from our billing records.`; the same rows as step 1 — same students, descriptions, periods, amounts, `Paid`, `Card`, `Download` |
| 7 | Click **My Registrations** in the sidebar | A row per child. **Last Payment** equals that child's newest completed ledger amount read in the preconditions, with the chips that charge earned (`10% sibling` when it was discounted, `Prorated first month` when the first charge was prorated, `Manual` for an offline payment). **Sibling Discount (Current)**: BridgeSecond (the $100 plan) `Full price`; BridgeFirst (the $50 plan) `10% sibling — $45.00/mo` |

## Pass rule
Every step's Expect holds, and every amount, status and period on the three screens matches the
ledger rows recorded in the preconditions exactly. BridgeSecond's `$22.50 · 10% sibling` is its
first-month registration bridge (ADR 006, kept by the owner), not a fail; its **current** sibling
discount must read `Full price`.
