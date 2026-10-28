---
id: trial-cancel-reschedule
feature: A parent reschedules and cancels an upcoming trial class from the dashboard
plan: docs/plans/trial-cancel-reschedule-plan.md
env: staging
mutates: true
login: audit-parent:audit-trial-parent@example.com
---

# Trial cancel and reschedule

## Why
A parent who booked a trial must be able to move it to another class, or cancel it and start
over, but only before the class starts and before attendance is taken. A pass proves, against the
real backend: the dashboard offers **Reschedule trial** and **Cancel trial** for an upcoming trial;
the wizard's reschedule mode fixes the child, leaves out the class the trial is already in, and
moves the trial; and a cancel puts the child back to **Book a free trial**. The gate books, moves
and cancels one trial for the gate's own audit child (no money moves) and ends with no trial on
file, so it can be run again.

## Preconditions
- **`Audit Class A` has at least two upcoming trial sessions** (`GET /group-class-sessions/by-class/<id>`
  as superadmin): one to book, one to move to. If not, run `npm run extend-sessions` (or
  `npm run audit:seed`) in `backend/`.
- **`Audit TrialChild` has no trial on any upcoming audit roster** (`GET /group-class-sessions/<id>`
  for every upcoming session of both audit classes). A trial left by an aborted run blocks the
  gate: run `cd backend && npm run audit:reset` (it deletes the audit children's trials), then
  `npm run audit:seed`.
- **The trial parent can sign in.** The script signs in as `audit-trial-parent@example.com` from
  `audit/.env` (`AUDIT_TEST_PASSWORD`). Claude never types a password.
- **Staging serves the commit being promoted.** Record the `develop` commit in the result.

## Steps
| # | Do | Expect |
|---|---|---|
| 1 | Open `/parent/dashboard` | The `Audit TrialChild` card offers `Book a free trial →`, and no `Reschedule trial` or `Cancel trial` |
| 2 | Click `Book a free trial →`, pick `Audit TrialChild`, choose level `Audit Level A`, pick the first session, click `Book Trial Class` | `Trial class booked!`, with the Session line `<day> · <time>` of the session picked |
| 3 | Click `Back to Dashboard` | The card reads `Trial class — <day without year> · <time>` for that session, and offers `Reschedule trial` and `Cancel trial` |
| 4 | Click `Reschedule trial` | `/parent/book-trial?reschedule=<child id>`, the title `Reschedule Trial`, and only `Audit TrialChild`'s card, already chosen, reading `Currently <day without year> · <time>` |
| 5 | Choose level `Audit Level A` | The session picker does not offer the booked session: it shows one session fewer than the precondition counted |
| 6 | Pick the first session offered, click `Reschedule Trial` | `Trial class rescheduled!`, with the Session line of the new session |
| 7 | Click `Back to Dashboard` | The card reads `Trial class — <new day without year> · <time>` |
| 8 | Click `Cancel trial` | A `Cancel Trial` dialog: `Cancel Audit's free trial on <new day without year> · <time>? You can book a new trial afterwards.` |
| 9 | Click `Cancel Trial` in the dialog | The dialog closes, and the card offers `Book a free trial →` again, with no `Reschedule trial` or `Cancel trial` |

## Pass rule
Every step's Expect holds. The day and time on the dashboard, the reschedule badge and the cancel
dialog match the session picked in step 2 (steps 3–4) or step 6 (steps 7–8) exactly, compared from
the text the page shows. After step 9, `Audit TrialChild` has no trial on file.
