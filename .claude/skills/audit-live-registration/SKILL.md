---
name: audit-live-registration
description: Live browser audit of trial booking, group-class registration, and the sibling discount — real Playwright against staging, real Stripe TEST-mode charges. Reports results to the admin Audits dashboard.
disable-model-invocation: true
---

Runs the real, unattended Playwright script in `audit/` against **staging only**
(`https://friscofencing-git-develop-frisco-fencing.vercel.app`) — never production.
See `docs/plans/audit-system-plan.md` for the full design.

**This mutates staging** — every scenario either books a real trial, creates a real
`Registration`/`Subscription`, or completes/declines a real Stripe TEST-mode `PaymentIntent`.
Run `/reset-audit-data` before a re-run (a stale `TrialClass` blocks S1 via its
unique-per-student index) — this skill does **not** reset automatically.

## Run it

```bash
cd audit
npm install                        # first time only
npx playwright install chromium    # first time only
npm run audit:registration
```

Requires `audit/.env` populated from `audit/.env.example` (staging URL, the shared audit-account
test password, and the existing staging superadmin login for the reporting step). If the seeded
audit accounts/classes don't exist yet, run `cd backend && npm run audit:seed` first (idempotent,
safe to re-run).

## Scenarios

| ID | What it tests | Pass criteria |
|---|---|---|
| S1 | Trial booking (free, no Stripe) | 3-step wizard completes, confirmation screen renders |
| S2 | Add a payment method (real `CardElement`, success card) then register for a group class | Card saves, registration completes, `Registration.status === 'active'` |
| S3 | Sibling discount — second (cheaper) child vs. the first (pricier) | Live `GET /registrations/preview` discount line shown pre-charge exactly matches the real applied discount shown post-charge — never disagree |
| S4 | Decline path (Stripe's documented decline card) | Corrected on the first real run, not assumed: the card is declined at the *save* step itself (`POST /payment-methods` returns 500 "Your card was declined." — Stripe's `4000000000000002` declines on `attach()`, not only on charge), not at checkout. Parent sees a clean message — never a raw Stripe/JS error — and no false "card on file" success |

## Report

Prints a pass/fail/skip report per scenario to the console, then — **non-fatally** — POSTs the
structured result to `/api/v1/audit-runs` so it appears on `/admin/audits` (superadmin-only). If
the report POST fails for any reason (endpoint unreachable, login fails), the script prints a
warning and continues; this never changes the audit's own exit code.

A `skip` result usually means stale data from a prior un-reset run — the scenario's `note` says
exactly that; run `/reset-audit-data` and re-run rather than treating it as a real failure.

## Notes

- **Staging only** — `audit/lib/staging-guard.js` hard-fails if `AUDIT_STAGING_URL` doesn't look
  like the staging preview alias.
- **No camp/tournament/guest/membership/credit scenarios** — none of those features exist in
  Frisco (see `CLAUDE.md`'s explicitly-deferred list). This audit's scope is exactly Frisco's
  real registration surface, not a 1:1 port of CKQ's larger one.
- **Headless by default** — set `AUDIT_HEADED=true` in `audit/.env` to watch it run, useful when
  debugging a changed scenario or the Stripe `CardElement` iframe selector (flagged in
  `audit/lib/stripe-card.js` as the one piece not verifiable without a live run).
- **Owner-triggered only** — not run automatically by any other skill, CI, or cron.
