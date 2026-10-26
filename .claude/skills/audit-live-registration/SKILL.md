---
name: audit-live-registration
description: Live browser audit of trial booking, group-class registration, and the sibling discount — real Playwright against staging, real Stripe TEST-mode charges. Reports results to the admin Audits dashboard.
disable-model-invocation: true
---

Runs the real, unattended Playwright script in `audit/` against **staging only**
(`https://friscofencing-git-develop-frisco-fencing.vercel.app`) — never production.
Design: `docs/plans/audit-system-plan.md`; current state and the 2026-10-26 refresh:
`docs/plans/audit-and-health-refresh-plan.md`.

**This mutates staging** — every scenario either books a real trial, creates a real
`Registration`/`Subscription`, or completes/declines a real Stripe TEST-mode payment.
Run `/reset-audit-data` before a re-run. This skill does **not** reset automatically; the
weekly workflow does (below).

## Prerequisites (P0 checks every one before any scenario runs)

1. **Audit fixtures** — `cd backend && npm run audit:seed`. Convergent and idempotent: it
   creates or repairs the audit accounts (password, family phone, child date of birth), the
   audit levels/classes/prices and both schedules, and stocks both schedules with their next
   8 sessions. A staging refresh (`npm run refresh:staging`) re-seeds them automatically.
2. **Upcoming sessions** — the weekly `extend-sessions.yml` workflow, or
   `cd backend && npm run extend-sessions -- --live` against staging.
3. **The Service registry** — `cd backend && npm run seed:services` (seeded by every refresh).
4. **The payment public key** — `STRIPE_PUBLISHABLE_KEY` on the backend's Preview env;
   `GET /api/v1/payments/config` must return it.

`audit/.env` (from `audit/.env.example`) holds the staging URL, the shared audit password and
the staging superadmin login used for reporting. `backend/.env` holds `AUDIT_MONGO_URI` and
`AUDIT_TEST_PASSWORD` for the seed and reset scripts.

## Run it

```bash
cd backend && npm run audit:reset          # clean slate for the audit accounts
cd ../audit
npm install                                # first time only
npx playwright install chromium            # first time only
npm run audit:registration
```

Exit code: `0` all passed, `1` a scenario failed, `2` the preflight failed (nothing ran).

**Weekly:** `.github/workflows/live-audit.yml` runs reset → audit every Monday 14:00 UTC, and on
demand from the Actions tab. It needs the secrets listed in that file; until `AUDIT_MONGO_URI` is
set it skips with a notice.

## Scenarios

| ID | What it tests | Pass criteria |
|---|---|---|
| P0 | Preflight | Every prerequisite above holds. On failure: one `P0` row listing every reason, every scenario reported as `skip` ("preflight failed"), exit 2 |
| S1 | Trial booking (free, no payment) | The sequential book-trial page: child → `Level` select → first `Select a session` pill → `Book Trial Class` → "Trial class booked!". A trial left by an un-reset run is a `skip` |
| S2 | Add a payment method (real `CardElement`, success card), then register for a group class | Card saves ("Card on file"), registration completes, confirmation shows "Your card was charged $…" |
| S3 | Sibling discount, OWN-FEE case — second (cheaper) child vs. the first (pricier) | The order summary's live preview and the confirmation agree: the discount is shown in both or neither, the previewed discount amount equals the charged one exactly, and the own-fee reason text is shown |
| S4 | Decline at card SAVE (Stripe `4000000000000002` declines at attach) | The adapter's 402 surfaces Stripe's own message in the alert — never a raw error, never the generic "Something went wrong" (that would mean the 402 mapping regressed to a 500) — and no false "card on file" |
| S5 | Sibling discount, BRIDGE case — a new child registering as the family's *higher* payer (`docs/decisions/006-sibling-discount-family-rule.md`) | Same preview == charge cross-check as S3, plus the bridge-specific reason text, distinct from S3's |
| S6 | A declined *registration charge* (card `4000000000000341` saves, then the charge declines) enters retry (`docs/decisions/008-registration-create-pending-first.md`) | The wizard reaches "Registration received" with the automatic-retry copy (never an error), and `GET /registrations/mine` shows the `Subscription` `active` with `retryCount >= 1` |

A child left enrolled by an un-reset run shows the wizard's "is already enrolled" notice; S2, S3,
S5 and S6 report that as `skip`, not `fail`.

## Report

Prints a pass/fail/skip report per row to the console, then — **non-fatally** — POSTs the
structured result to `/api/v1/audit-runs` so it appears on `/admin/audits` (superadmin-only). A
reporting failure prints a warning and never changes the audit's exit code.

## Notes

- **Staging only** — `audit/lib/staging-guard.js` hard-fails if `AUDIT_STAGING_URL` doesn't look
  like the staging preview alias.
- **Selectors are guarded in CI** — `frontend/lib/__tests__/guards/auditSelectorGuard.test.ts`
  fails a PR that removes or rewords any label or text this audit finds the app by. When you
  change a scenario's selector, keep it a string or a simple regex so the guard can check it.
- **No camp/tournament/guest/membership/credit scenarios** — none of those features exist in
  Frisco (`CLAUDE.md`'s deferred list).
- **Headless by default** — set `AUDIT_HEADED=true` in `audit/.env` to watch a run.
