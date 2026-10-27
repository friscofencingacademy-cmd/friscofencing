# Live gates

A **live gate** is a short, written checklist that proves a feature works in a real browser on a
deployed environment (staging by default). Claude walks it in the owner's own Chrome with the
`/live-gate` skill while the owner watches, records a GIF, and writes a pass/fail result file.

**Rule (owner decision, 2026-10-27): no feature is promoted to `main` until its live gate has a
passing result on staging for the code being promoted.** A feature plan that changes user-visible
or money behaviour names its gate; the gate is written in the same PR as the feature.

Live gates complement, never replace, the automated layers (`docs/TESTING_STRATEGY.md`):

| Layer | Runs | Proves |
|---|---|---|
| Jest / Playwright E2E | every PR in CI, mocked or in-memory | the code's contract |
| Live audit (`audit/`, `/audit-live-registration`) | weekly, unattended, scripted | the core money flows still work on staging |
| **Live gate** (`/live-gate`) | once per feature before promotion, watched by the owner | this feature works on the real deployed app |

---

## Layout

```
docs/live-gates/
  README.md                  this file
  <gate-id>.md               one checklist per feature (the gate)
  results/<date>-<gate-id>.md  one record per run (pass or fail), never edited after the run
```

`<gate-id>` is short kebab-case, e.g. `f15-prorated-top-payer`. GIF recordings are not committed
(they can be large); the result file names the GIF so the owner can attach it to the PR.

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

Rules for writing a gate:
- **Expect is observable on the page.** Exact text or amounts a person can read, not internal state.
- **Steps name the click target by its visible label**, so a person could run the gate by hand.
- **Prefer read-only checks.** A gate that must save or charge sets `mutates: true` and says in its
  Preconditions how to reset (usually `cd backend && npm run audit:reset`).
- **Use the audit fixtures** (`backend/scripts/lib/seedAuditFixtures.js`) for accounts and plans, so
  gates never touch real families. Never write a password into a gate file.
- **Amounts come from the backend.** A gate may compute the expected amount by hand from the plan's
  rule (e.g. proration), and must show that arithmetic in the step.

## Result file format

```markdown
---
gate: f15-prorated-top-payer
result: pass                 # pass | fail | blocked
env: staging
url: https://friscofencing-git-develop-frisco-fencing.vercel.app
commit: 66cb96d              # the develop commit staging was serving, or "unknown"
date: 2026-10-27
run_by: Claude (/live-gate), watched by the owner
recording: 2026-10-27-f15-prorated-top-payer.gif
---

| # | Expect | Seen | Result |
|---|---|---|---|
| 1 | ... | ... | pass |

Notes: anything surprising, and for a fail, the step it stopped at and what was on the page.
```

## Future CI check (not built yet)

The promotion PR (`develop` → `main`) gets a required job that reads every gate whose `plan` was
changed since the last `main` commit and fails unless `results/` holds a `result: pass` record for
it dated after the gate file's own last change. Until that job exists, the owner checks this by
hand before approving a promotion.
