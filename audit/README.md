# Live registration audit and live gates

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

## Live gates

A live gate (`docs/live-gates/<id>.md`) is one feature's watched check on staging, required before
that feature is promoted to `main` (`docs/live-gates/README.md`). Each gate has a script here,
`gates/<id>.js`, that mirrors the `.md` step for step. Design: `docs/plans/playwright-live-gates-plan.md`.

```bash
cd audit
npm run gate -- f15-prorated-top-payer --headed            # a visible window, 700 ms between actions
npm run gate -- register-quote --headed --slow 300          # faster
npm run gate -- payment-history                             # headless
```

- The script signs in itself from `.env` (`AUDIT_SUPERADMIN_*`, `AUDIT_TEST_PASSWORD`). Each
  account gets its own browser context; nobody types a password.
- **Read-only is enforced.** Every context blocks any non-GET call to `/api/v1/*` except sign-in
  and sign-out, so a stray click on Confirm Charge or Register & Pay never reaches the server. A
  gate whose `.md` says `mutates: true` refuses to start without `--allow-writes`.
- It prints `Step n/N — <Do> Expect: <Expect>` before each step and what it saw after, stops at
  the first failure, and writes `docs/live-gates/results/<date>-<id>.md`.
- The video and a trace of each account go to `gate-runs/<date>-<id>/` (gitignored). Open a trace
  with `npx playwright show-trace gate-runs/<folder>/trace-admin.zip`. Tracing starts after
  sign-in, so it never holds a password.
- Exit `0` pass, `1` fail, `2` blocked (a precondition does not hold, e.g. a fixture is missing),
  `3` refused (unknown id, a production URL, missing env, `mutates` without `--allow-writes`).

`npm test` runs the runner's offline tests (`tests/`, Node's built-in runner; CI's `audit-tests`
job). A new gate needs both files: the guard in `auditSelectorGuard.test.ts` fails when a gate
`.md` has no script, or their step numbers differ.
