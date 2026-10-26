# Live registration audit

Real Playwright (headless Chromium by default) driving the actual staging frontend, completing
real Stripe TEST-mode charges. Design: `docs/plans/audit-system-plan.md`. Current state, the
preflight and the weekly workflow: `docs/plans/audit-and-health-refresh-plan.md`. This file is
the "how do I run it" quick-start; `.claude/skills/audit-live-registration/SKILL.md` has the
scenario table.

**Staging only. Never point this at production** — `lib/staging-guard.js` hard-fails otherwise.

## One-time setup

```bash
cd audit
npm install
npx playwright install chromium
cp .env.example .env
# fill in real values in .env
```

## Prerequisites (the P0 preflight checks all of them)

```bash
cd ../backend
# AUDIT_MONGO_URI (staging cluster) and AUDIT_TEST_PASSWORD in backend/.env first
npm run seed:services          # the Service registry (a staging refresh does this too)
npm run audit:seed             # accounts, catalog, schedules + their next 8 sessions — convergent, safe to re-run
```

The backend's Preview env must also have `STRIPE_PUBLISHABLE_KEY` (`GET /payments/config`).

## Run the audit

```bash
cd ../backend && npm run audit:reset     # before every re-run
cd ../audit && npm run audit:registration
```

Prints a pass/fail/skip row per scenario — P0 preflight (only shown when it fails), S1 trial
booking, S2 add-card + register, S3 sibling discount (own-fee, preview == charge), S4 card-save
decline, S5 sibling discount (bridge case), S6 charge decline enters retry — and, non-fatally,
reports the run to `/admin/audits` (superadmin-only). Exit `0` pass, `1` a scenario failed,
`2` the preflight failed.

A `skip` means stale data from an un-reset run (a trial already used, a child already
enrolled, a card already on file) — run `npm run audit:reset` in `backend/` and re-run.

## Weekly run

`.github/workflows/live-audit.yml` runs reset → audit every Monday, and on demand from the
Actions tab, once its secrets are set (listed at the top of that file).

## Changing a scenario

`frontend/lib/__tests__/guards/auditSelectorGuard.test.ts` checks, in CI, that every label and
text this package selects by still exists in the app. Keep selectors as strings or simple
regexes (words, spaces, `' & % ! , -`), or as a `const UPPER_CASE = …` in the same file, so the
guard can read them. Fixture names starting with "Audit " are exempt.
