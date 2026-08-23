# Live registration audit

Real Playwright (headless Chromium by default) driving the actual staging frontend, completing
real Stripe TEST-mode charges. See `docs/plans/audit-system-plan.md` for the full design —
this file is just the "how do I run it" quick-start.

**Staging only. Never point this at production** — `lib/staging-guard.js` hard-fails otherwise.

## One-time setup

```bash
cd audit
npm install
npx playwright install chromium
cp .env.example .env
# fill in real values in .env
```

## Seed the dedicated audit accounts + classes (once, idempotent — safe to re-run)

```bash
cd ../backend
# set AUDIT_MONGO_URI (staging cluster) and AUDIT_TEST_PASSWORD in backend/.env first
npm run audit:seed
```

## Run the audit

```bash
cd ../audit
npm run audit:registration
```

Prints a pass/fail/skip report per scenario (S1 trial booking, S2 add-card + register,
S3 sibling discount, S4 decline path) and — non-fatally — reports the run to
`/admin/audits` (superadmin-only).

## Reset before every re-run

A stale `TrialClass`/`Registration` from a prior run will make S1/S2/S3/S4 report `skip`
(not a bug — the reset script clears exactly this). Never runs automatically:

```bash
cd ../backend
npm run audit:reset
```
