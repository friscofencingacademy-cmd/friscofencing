---
id: register-quote
feature: The parent register wizard's Live Quote — this-month proration, next-month full fee, per-level registration fee, enrolled-child guard
plan: docs/plans/payment-airtight-plan.md
env: staging
mutates: false
login: audit-parent:audit-decline-parent@example.com
---

# Register quote

## Why
The Live Quote panel on `/parent/register` is what a parent agrees to pay. It must show the
backend's numbers: a start date this month is prorated to the class days left; "Enroll for next
month" bills that whole month at the full fee (the $403.82 incident, ADR 007 addendum); a level's
own registration fee, including an explicit `$0`, wins over the academy-wide fee. A pass proves
the deployed wizard quotes exactly that. Covers #29–#35 and #39 (wizard and start-date window),
#50 and #79 (calendar-month billing, proration rule), #60 (Family Scorecard quote), #69 (per-level
registration fee), #85 (preview breakdown). The sibling-discount quote needs a family with a free
second child, which the audit fixtures do not have; the live audit's S3/S5 cover it. This gate
never clicks **Register & Pay**.

## Preconditions
- **Audit fixtures are seeded.** Read through the API by the runner (superadmin, GET only):
  `Audit DeclineChild` (family `audit-decline-parent@example.com`) has **no** active subscription.
  Audit Level A ($100, Tuesdays) and Audit Level B ($50, Thursdays) both have `registrationFee: 0`.
- **A this-month start date exists.** The picker offers dates from today through the earlier of
  today + 14 days and the month's last day, and never a session that has already started. Pick the
  level that has one (prefer Level B), and compute for its **first** offered date:
  `r` = class days from that date to month end, `t` = class days in the month,
  daily rate = fee ÷ `t`, due = fee × `r` ÷ `t` (rounded to cents). Write the arithmetic in the result.
  The runner reads the first offered date from the page at step 3 (the picker already hides
  holiday and already-started dates) and computes `r` from it. **This is the one skippable
  precondition:** if neither level has a this-month date, steps 4–5 are `skipped` and the run can
  still pass on the rest; the result says so.
- **Next month's sessions exist** (the weekly session extension keeps 8 weeks ahead), so
  **Enroll for next month** is enabled and names a first class.
- **The decline parent never has a card on file.** `npm run audit:reset` deletes every audit
  parent's card and the live audit's S4 only tries a declining card, so the payment section is the
  inline card form and **Register & Pay** stays disabled.
- **The script signs in as `audit-decline-parent@example.com`** from `audit/.env`
  (`AUDIT_TEST_PASSWORD`). Claude never types a password.
- **Staging serves the commit being promoted.** Record the `develop` commit in the result.

## Steps
| # | Do | Expect |
|---|---|---|
| 1 | Open `/parent/register` signed in as the decline parent | `Register for a Class`; under **Who is registering?** a card for `Audit DeclineChild` with **no** `Already enrolled` badge; the summary panel reads `Live Quote` / `Summary` |
| 2 | Click the `Audit DeclineChild` card | **Choose your level** appears; cards `Audit Level A` `$100/month` and `Audit Level B` `$50/month` |
| 3 | Click the level chosen in the preconditions (e.g. `Audit Level B`) | **Choose your start date** lists this month's dates as pills (each with its time, e.g. `5:00 PM–6:00 PM`), plus **Enroll for next month** with `First class: <date> · <time>` |
| 4 | Click the **first** this-month pill | Summary: `Monthly Fee` `$<fee>`; `Prorated` `<r> of <t> class days · $<daily>/day`; **no** `Registration Fee` line; `Due at enrollment` `$<due>`; `Full price starts` the 1st of next month; no `Sibling Discount` line; **Payment method** shows the inline card form with its **Add Card** button (no card on file) |
| 5 | (Check only) **Register & Pay** | The button is visible and disabled (no card on file); **do not click it** |
| 6 | Click **Enroll for next month** | The button turns primary. Summary: `Start Date` the named first class; `Monthly Fee` `$<fee>`; **no** `Prorated` line; **no** `Registration Fee` line; `Due at enrollment` `$<fee>.00` (the full month, never prorated); `Plan renews` the 1st of the month after next |
| 7 | Click the other level's card (e.g. `Audit Level A`), then **Enroll for next month** | The start date resets with the level; the quote shows that level's own fee in full as `Due at enrollment`, no `Prorated`, no `Registration Fee` line |
| 8 | Leave the page with the **Home** breadcrumb | The parent dashboard loads; nothing was registered (the decline parent still has no active subscription — re-check read-only) |

## Pass rule
Every step's Expect holds. Compare exactly: `<r> of <t>`, the daily rate and `Due at enrollment`
in step 4 against the precondition arithmetic; `Due at enrollment` equals the full monthly fee in
steps 6–7. A `Registration Fee` line anywhere is a fail (the audit levels' explicit `$0` must win
over the academy fee). **Register & Pay** is never clicked; a run that clicks it is void.
