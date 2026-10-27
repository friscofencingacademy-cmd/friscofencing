# Live gates

A **live gate** is a short, written checklist that proves a feature works in a real browser on a
deployed environment (staging). Each gate has a Playwright script, `audit/gates/<id>.js`, that
mirrors the checklist step for step. The owner runs it in a visible window
(`cd audit && npm run gate -- <id> --headed`, or `/live-gate <id>` to have Claude run it and relay
the narration); the script signs in from `audit/.env`, records a video and a trace, and writes the
pass/fail result file. Design: `docs/plans/playwright-live-gates-plan.md`.

**Rule (owner decision, 2026-10-27): no feature is promoted to `main` until its live gate has a
passing result on staging for the code being promoted.** A feature plan that changes user-visible
or money behaviour names its gate; the gate is written in the same PR as the feature.

Live gates complement, never replace, the automated layers (`docs/TESTING_STRATEGY.md`):

| Layer | Runs | Proves |
|---|---|---|
| Jest / Playwright E2E | every PR in CI, mocked or in-memory | the code's contract |
| Live audit (`audit/`, `/audit-live-registration`) | weekly, unattended, scripted | the core money flows still work on staging |
| **Live gate** (`npm run gate`, `/live-gate`) | once per feature before promotion, watched by the owner | this feature works on the real deployed app |

---

## Layout

```
docs/live-gates/
  README.md                    this file
  <gate-id>.md                 one checklist per feature (the gate, the source of truth)
  results/<date>-<gate-id>.md  one record per run (pass, fail or blocked), never edited after the run
audit/gates/<gate-id>.js       the script that runs it, step for step
audit/gate-runs/<date>-<gate-id>/  video + trace per account (gitignored)
```

`<gate-id>` is short kebab-case, e.g. `f15-prorated-top-payer`. Recordings are not committed
(they can be large); the result file names the video so the owner can attach it to the PR.

## Running a gate

```bash
cd audit
npm run gate -- <gate-id> --headed          # visible window, 700 ms between actions (--slow <ms> to change)
```

- **Read-only is enforced.** Every browser context aborts any non-GET call to the app's API except
  sign-in and sign-out, and the step fails with `Blocked write: <METHOD> <path>`. A `mutates: true`
  gate refuses to start without `--allow-writes`.
- **Nobody types a password.** The script signs in from `audit/.env`, one isolated browser context
  per account, and starts the trace only after sign-in.
- **Preconditions run in the script:** Central-time arithmetic plus read-only API reads as the
  staging superadmin. One that does not hold ends the run `blocked`.
- **Exit codes:** `0` pass, `1` fail, `2` blocked, `3` refused (unknown id, a production URL,
  missing env, `mutates` without `--allow-writes`).

A gate's `.md` and its script must agree: CI (`auditSelectorGuard.test.ts`) fails when a gate has
only one of the two, when their step numbers differ, or when a label the script selects by no
longer exists in the app.

## Gate file format

```markdown
---
id: f15-prorated-top-payer
feature: One line naming the feature
plan: docs/plans/<plan>.md
env: staging                  # staging (default) | production (owner must ask for it explicitly)
mutates: false                # true when any step saves, charges, books or deletes anything
login: superadmin             # superadmin | audit-parent:<email> | none
---

# <Title>

## Why
One paragraph: what could break, and what a pass proves.

## Preconditions
Read-only facts that must hold before the run, each with how to check it. If one fails the run
is `blocked`, not `fail`.

## Steps
| # | Do | Expect |
|---|---|---|
| 1 | Open `/admin/subscriptions` | The table loads with at least one row |

## Pass rule
Every step's Expect holds. Name any value that must be compared exactly.
```

Rules for writing a gate (and its script):
- **Expect is observable on the page.** Exact text or amounts a person can read, not internal state.
- **Steps name the click target by its visible label**, so a person could run the gate by hand.
- **Prefer read-only checks.** A gate that must save or charge sets `mutates: true` and says in its
  Preconditions how to reset (usually `cd backend && npm run audit:reset`).
- **Use the audit fixtures** (`backend/scripts/lib/seedAuditFixtures.js`) for accounts and plans, so
  gates never touch real families. Never write a password into a gate file.
- **Amounts come from the backend.** A gate may compute the expected amount by hand from the plan's
  rule (e.g. proration), and must show that arithmetic in the step.
- **A step may be skipped only where its row says so** (e.g. `register-quote` steps 4–5 when no
  this-month date exists). A skipped step shows in the result and does not fail the run.
- **The script locates by plain label strings** (or a simple regex) and compares amounts from the
  text it reads, so the selector guard can check every label; see `docs/TESTING_STRATEGY.md`.

## Result file format

```markdown
---
gate: f15-prorated-top-payer
result: pass                 # pass | fail | blocked
env: staging
url: https://friscofencing-git-develop-frisco-fencing.vercel.app
commit: 66cb96d              # the develop commit staging was serving, or "unknown"
date: 2026-10-27
run_by: Playwright (npm run gate), watched by the owner
recording: audit/gate-runs/2026-10-27-f15-prorated-top-payer/f15-prorated-top-payer-admin.webm
---

| # | Expect | Seen | Result |
|---|---|---|---|
| P1 | ... | ... | pass |
| 1 | ... | ... | pass |

Notes:
- Anything surprising, and for a fail, the failure screenshot under `audit/gate-runs/`.
```

Preconditions are `P1`, `P2` …; a row's result is `pass`, `fail`, `skipped` or `blocked`. The
commit is develop's head only when both Vercel deployments for it report success, else `unknown`.
The three hand-run F15 results of 2026-10-27 predate the script and use the older GIF format.

## Future CI check (not built yet)

The promotion PR (`develop` → `main`) gets a required job that reads every gate whose `plan` was
changed since the last `main` commit and fails unless `results/` holds a `result: pass` record for
it dated after the gate file's own last change. Until that job exists, the owner checks this by
hand before approving a promotion.
