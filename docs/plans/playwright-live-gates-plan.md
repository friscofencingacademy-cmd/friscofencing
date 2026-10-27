# Playwright Live Gates

**Status:** PLANNED 2026-10-27 — owner approved the draft ("ok write"); reviewed against the
code the same day and corrected (§1 D2/D3/D5/D8, §2, §3, §6 and the new §7). Plan PR #137.
PR 1 BUILT 2026-10-27 on `feature/playwright-live-gates` (§8); all four gates passed headed on
staging with the owner watching the same day; PR open to `develop`.
**Executor:** Opus or Sonnet. PR 1 (`feature/playwright-live-gates` → `develop`), then the optional
PR 2. The owner tests each PR (one headed run per gate on staging) before it is merged.
**Origin:** the owner's go-live rule (`docs/live-gates/README.md`, 2026-10-27). The first gate run
showed that Claude may not type a password into the staging preview host
(`friscofencing-git-develop-frisco-fencing.vercel.app`) through the browser tools, so every gate
that signs in as an audit parent needed the owner to sign in by hand. A Playwright script in the
repo signs in itself from `audit/.env`, exactly as the weekly live audit already does, on the
existing staging address. Required reading: `docs/live-gates/README.md`,
`docs/plans/audit-and-health-refresh-plan.md` §4, `docs/TESTING_STRATEGY.md` "Live audits".

---

## 0. What exists today (measured 2026-10-27 on `develop` at `1e70067`)

| Piece | Where | Reused as |
|---|---|---|
| Standalone Playwright package (`playwright`, `dotenv`, `axios`) | `audit/package.json` | the gate runner's home |
| Login through the real `/login` form, waits for navigation away | `audit/lib/login.js` | every gate's sign-in |
| Refuses to run unless `AUDIT_STAGING_URL` is the staging alias | `audit/lib/staging-guard.js` | first call of the runner |
| `AUDIT_STAGING_URL`, `AUDIT_TEST_PASSWORD`, `AUDIT_SUPERADMIN_*`, `AUDIT_HEADED` | `audit/.env` (gitignored), `audit/.env.example` | the runner's config; no new variables except as listed in D2 |
| Audit accounts and plans (`AUDIT_FAMILIES`, `AUDIT_LEVELS`) | `backend/scripts/lib/seedAuditFixtures.js` | the only accounts gates use |
| PR-time check that audit selectors exist in app source | `auditSelectorGuard.test.ts` (`docs/TESTING_STRATEGY.md`) | extended to `audit/gates/` (D8) |
| Written gates | `docs/live-gates/{f15-prorated-top-payer,charge-dialog-modes,payment-history,register-quote}.md` | the spec each script mirrors |
| `/live-gate` skill, Claude in Chrome | `.claude/skills/live-gate/SKILL.md` | becomes a thin wrapper (D7) |

`audit/` has no test runner today and CI does not run anything in it.

---

## 1. Decisions

**D1 — One script per gate.** `audit/gates/<id>.js` mirrors `docs/live-gates/<id>.md` step for
step: same numbering, same Do/Expect wording, as an exported `{ id, preconditions, steps }`. The
`.md` stays the human-readable spec and the source of truth for what a pass means. PR 1 ships four
scripts: `f15-prorated-top-payer`, `charge-dialog-modes`, `payment-history`, `register-quote`.
Because the script must mirror the `.md`, PR 1 also edits the four gate files where they still
describe the hand-run (§7, "Gate file corrections"); the corrected `.md` is what the script mirrors.
A step may end `skipped` (with a reason) only where its `.md` row says so explicitly; a skipped
step shows in the result table and never makes the run a fail.

**D2 — Runner `audit/run-gate.js`, `npm run gate -- <id> [--headed] [--slow <ms>] [--allow-writes]`.**
- Prints `Step n/N — <Do>. Expect: <Expect>.` before each step and `Seen: "<exact page text>" —
  pass|fail` after it. Verification reads the page (`getByText`, `textContent`); never assumes a
  click worked.
- Stops at the first failing step; saves a screenshot and a Playwright trace of the run.
- `--headed` opens a visible Chromium window (also `AUDIT_HEADED=true`); `--slow` sets Playwright's
  `slowMo` (default 700 ms when headed, 0 headless) so the owner can follow along.
- Every run records a video (`recordVideo` on each context). Playwright names the file only when
  the context closes, so the runner closes every context before it writes the result file and
  renames the video to `<id>.webm`. Run artefacts go to `audit/gate-runs/<YYYY-MM-DD>-<id>/`
  (video, trace, screenshots), gitignored; this replaces the GIF.
- One retry only for a page that had not finished loading (a navigation/timeout on the first read
  of a step), matching the current skill's rule.

**D3 — Read-only is enforced, not promised.** Every browser context the runner creates installs a
`context.route('**/api/v1/**')` guard (on the context, not a page, so every page and popup in it is
covered) that aborts any request whose method is not `GET`/`HEAD`, except `POST /api/v1/auth/login`
and `POST /api/v1/auth/logout`. A blocked request fails the current step with
`Blocked write: <METHOD> <path>`, so an accidental click on **Confirm Charge**, **Record Payment**
or **Register & Pay** can never reach the server. Requests to other origins (Stripe's own domains,
which the inline card form talks to on mount) are not API calls and pass. A gate whose `.md` says
`mutates: true` refuses to start without `--allow-writes`; the four PR 1 gates are all read-only.
Verified 2026-10-27: every non-GET call the frontend makes is a user action (`api.post/put/patch/
delete` in `AuthContext` and `lib/services/*`); nothing fires a write on page load.

**D4 — Sign-ins.** Each account gets its own isolated `browserContext` (its own cookies), signed in
with `lib/login.js`. `payment-history` holds a superadmin context and a bridge-parent context side
by side and never signs out. The owner's own Chrome is never touched. Passwords come only from
`audit/.env` and are never printed, logged or written to a result file. A Playwright trace records
typed values, so each context signs in **before** tracing starts (`context.tracing.start` after
`login`), and video recording is fine (the password field shows dots).

**D5 — Preconditions run in the script, without a database connection.**
- Date arithmetic is computed in `audit/lib/gate-dates.js` in America/Chicago, the academy's
  timezone: today's Central date, class days of a weekday left in the month (today included),
  class days in the month, the prorated amount `round2(fee × left ÷ total)`, the 1st of next month
  and of the month after. The rules are the backend's (`computeProration`, ADR 007). **Class days
  are plain weekday occurrences:** `computeProration` loops over the calendar days and never reads
  the Holiday model, so `gate-dates` must not subtract holidays either, even though the start-date
  picker hides holiday dates. The amount is rounded once, at the end (`toFixed(2)`), never the
  daily rate first.
- Ledger-dependent values are read through the app's own API as superadmin, read-only (`GET`
  through the frontend's `/api/v1` proxy, the same path the live audit's reporting uses):
  `GET /subscriptions?q=<name>` (populated student/parent/schedule/level, `retryCount`,
  `nextBillingDate`), `GET /registrations/history?parentId=<id>` for a family, and
  `GET /subscriptions/:id/charge-preview` (the same call the dialog makes; `previewRenewal` has no
  side effects — verified 2026-10-27).
- For `register-quote`, the first this-month start date is **read from the page** (the first
  pill), never predicted: the picker already excludes started sessions and holidays. `r` is then
  the weekday occurrences from that date to month end.
- A failed precondition ends the run as `blocked` with the reason (e.g. no Level A class day left
  for F15, RetryChild no longer in dunning, a fixture account that cannot sign in). The one
  exception is a precondition the `.md` marks as skippable: `register-quote`'s "a this-month start
  date exists" skips steps 4–5 (D1) instead of blocking.

**D6 — The runner writes the result file.** `docs/live-gates/results/<YYYY-MM-DD>-<id>.md` in the
README's format (adds `-2`, `-3` when the name exists; never edits an earlier file):
- one table row per precondition and per step with the Expect, the exact text seen, and the result
  (`pass` | `fail` | `skipped` | `blocked`);
- `commit` from `gh api repos/friscofencingacademy-cmd/friscofencing/commits/develop --jq .sha`
  only when both Vercel status contexts for it (`Vercel – friscofencing` and
  `Vercel – friscofencing-backend`, read from `commits/<sha>/status`) are `success`, else `unknown`
  (also `unknown` without `gh`);
- `run_by: Playwright (npm run gate)`, plus `, watched by the owner` when `--headed`;
- `recording:` the video path under `audit/gate-runs/`.
Exit codes: `0` pass, `1` fail, `2` blocked, `3` refused (bad id, production URL, missing env,
`mutates` without `--allow-writes`).

**D7 — `/live-gate` becomes a thin wrapper.** The skill runs `cd audit && npm run gate -- <id>
--headed` in the foreground, relays the narration, and finishes with the result table and the
result-file path. The Claude in Chrome path is removed: the owner no longer needs the extension,
and Claude never types a password. With no argument it still lists gates and their latest results.
The hand-run F15 results of 2026-10-27 stay as they are.

**D8 — PR-time guards.**
- `auditSelectorGuard` scans `audit/gates/` as well as `audit/lib` and `audit/scenarios`, with the
  same rules (strings or simple regexes only; "Audit …" fixture names exempt).
- A new check (in the same test file) asserts every `docs/live-gates/<id>.md` has an
  `audit/gates/<id>.js` whose step count equals the `.md`'s Steps table (skippable steps included),
  and vice versa.
- **Selector rule for gate scripts** (the guard fails the suite otherwise): the guard reports any
  regex containing a metacharacter (`$`, `.`, `(`, `^` …) as `unchecked`, and `unchecked` is a
  failure. So a script locates by a plain label string — `getByText('Prorated from today')`,
  `getByRole('button', { name: 'Charge' })` — and compares amounts from `textContent`, never
  `getByText(/\$25\.00/)`. A `new RegExp(\`…${amount}\`)` with a runtime variable is skipped by
  the guard silently, so it must not be used to carry app text either; only `UPPER_CASE` string
  or simple-regex constants are resolved.

---

## 2. Files

| File | Change |
|---|---|
| `audit/run-gate.js` | new — argument parsing, staging guard, contexts, write guard, step loop, result writing, exit codes |
| `audit/lib/gate-runner.js` | new — `runSteps(steps, ctx)` narration/pass/fail/stop, retry-once rule |
| `audit/lib/write-guard.js` | new — D3's route guard |
| `audit/lib/gate-dates.js` | new — D5's Central-time date and proration helpers |
| `audit/lib/gate-api.js` | new — read-only superadmin API reads used by preconditions |
| `audit/lib/gate-result.js` | new — D6's result-file writer and commit lookup |
| `audit/gates/f15-prorated-top-payer.js`, `charge-dialog-modes.js`, `payment-history.js`, `register-quote.js` | new — one per gate (D1) |
| `audit/tests/*.test.js` | new — §3 |
| `audit/package.json` | add `"gate": "node run-gate.js"` and `"test": "node --test tests/*.test.js"` (a bare directory argument is treated as a test file on Node 22+ and reports a false failure — measured on the owner's Node 24; the glob is expanded by Node itself on 22+ and by the shell on CI's Node 20); no new dependencies |
| `audit/.gitignore` | add `gate-runs/` |
| `audit/README.md`, `audit/.env.example` | document `npm run gate`, `--headed`, `--slow`; `.env.example` notes `AUDIT_SUPERADMIN_*` is now also used by the superadmin gates |
| `docs/live-gates/{payment-history,register-quote,f15-prorated-top-payer,charge-dialog-modes}.md` | the corrections in §7 "Gate file corrections" — the scripts mirror the corrected files |
| `.github/workflows/ci.yml` | new `audit-tests` job (`npm ci && npm test` in `audit/`, `TZ: UTC`, no secrets; `npm ci` downloads no browsers — the pinned `playwright@1.62.1` has no install hook); added to `ci-passed`'s `needs` |
| `frontend/.../auditSelectorGuard.test.ts` | D8 |
| `.claude/skills/live-gate/SKILL.md` | D7 rewrite |
| `docs/live-gates/README.md` | how gates run now; the script/spec pairing; exit codes |
| `docs/TESTING_STRATEGY.md`, `docs/TEST_COVERAGE.md` | live gates as a layer; the new `audit-tests` job and counts |
| `CLAUDE.md`, `CLAUDE_HISTORY.md` | doc-map and history rows |

---

## 3. Tests (PR 1)

Node's built-in runner (`node --test`), no new dependencies, all offline:
- **gate-runner:** a passing step prints both lines; a failing step stops the run and later steps
  never run; a step that returns `skipped` is recorded with its reason and the run continues; the
  one-retry rule applies only to a load timeout on the first read.
- **write-guard:** aborts `POST`/`PUT`/`PATCH`/`DELETE` to `/api/v1/*`; allows `GET`, `HEAD`,
  `POST /auth/login`, `POST /auth/logout`, and any non-API URL; the abort message names method and path.
- **gate-dates:** class days left/total across a four- and a five-weekday month, today being the
  last class day, no class day left (amount `0`), month end on the 31st/30th/28th, a date near the
  Central/UTC midnight boundary (clock pinned, `TZ=UTC`), next-month and month-after dates, a
  holiday on a class day changing nothing, and rounding once at the end (`$100 × 1 ÷ 3 = $33.33`,
  not `$33.00`).
- **gate-result:** file format matches the README exactly; `-2`/`-3` suffixing; `skipped` rows;
  `commit: unknown` when the lookup fails or either Vercel context is not `success`; no
  password-shaped value from the env ever appears in the output.
- **step-count guard (frontend Jest, D8):** a gate `.md` without a script, a script without a
  `.md`, and a count mismatch each fail with the file named.
- **run-gate refusals:** unknown id, a production URL (`staging-guard`), missing env, a `mutates`
  gate without `--allow-writes` → exit `3`.

The gate scripts themselves are proven by one headed run each against staging with the owner
watching, before PR 1 is merged; those four result files ship in the PR. Owner steps before that
run: `cd audit && npm ci && npx playwright install chromium` (the lockfile pins Playwright 1.62.1),
and `AUDIT_SUPERADMIN_EMAIL` / `AUDIT_SUPERADMIN_PASSWORD` / `AUDIT_TEST_PASSWORD` present in
`audit/.env`.

---

## 4. PRs

1. **PR 1 — `feature/playwright-live-gates`:** everything in §2 and §3.
2. **PR 2 (optional, after PR 1) — `feature/live-gate-workflow`:** `.github/workflows/live-gate.yml`,
   `workflow_dispatch` with a `gate` input, runs headless against staging with the live audit's
   existing secrets, uploads the video and result file as artefacts. A step toward the CI
   promotion check in `docs/live-gates/README.md`; never a PR gate (it needs staging).

---

## 5. Risks

- **Date-dependent amounts** — expectations are computed from today, never hard-coded. F15 still
  blocks outside its window (needs a Level A class day left and a prorated amount below $50).
- **Fixture drift** — gates use only accounts the weekly reset re-creates; a gate that finds a
  fixture missing ends `blocked`, not `fail`.
- **Selector drift** — D8 catches renamed labels at PR time.
- **Writes later** — a future gate with `--allow-writes` could charge Stripe test mode on
  staging; legitimate, but each such gate must say how to reset (`npm run audit:reset`).
- **Dunning window** — `charge-dialog-modes` steps 8–9 need RetryChild in dunning. No renewal or
  retry job runs on staging (the only workflows are `ci`, `extend-sessions`, `live-audit`), so
  after the Monday audit's S6 the child stays at `retryCount` 1 until the next reset; the window
  is the whole week, not a day.

---

## 6. Owner decisions

The owner approved the draft with "ok write" on 2026-10-27 without answering the three open
questions individually; the recommended defaults below are recorded and stand unless the owner
changes them:
1. Drop the Claude in Chrome path (D7) — **yes** (recommended).
2. The script writes the result file (D6) — **yes** (recommended; a CI job needs it).
3. PR 2 (manual CI workflow) — **after PR 1**, optional.

---

## 7. Executor notes (review of 2026-10-27, measured against `develop` at `1e70067`)

### Gate file corrections (PR 1 edits these `.md` files; the scripts mirror the corrected text)

- **`register-quote` step 4 — the fixture has no card.** `npm run audit:reset` deletes every
  audit parent's `PaymentMethod` and S4 only attempts Stripe's declining card (it skips when a card
  is on file), so `audit-decline-parent@example.com` never has a card. The wizard then renders the
  inline `PaymentMethodCollector` ("Add Card"), not `Card on file: … — this card will be charged.`,
  and **Register & Pay** is disabled (`ctaDisabled={!sessionId || !selectedPrice ||
  !paymentMethod}`). Rewrite step 4's payment-method Expect to the inline card form with its
  **Add Card** button, and step 5 to "visible and disabled; never clicked". The card form talks
  only to Stripe's domain on mount (D3 lets that through).
- **`register-quote` preconditions and `payment-history` precondition + step 5** still say the
  owner signs in by hand. Reword to "signed in by the script from `audit/.env`"; `payment-history`
  step 5 becomes "Open the parent portal in the bridge-parent context" with the same Expect.
- **`payment-history` step 7** hard-codes `$22.50` / `$10.00`, which only hold for a live audit
  run on 2026-10-26. Express them as "the newest ledger amount for that child, read in the
  preconditions" and keep the chip names (`10% sibling`, `Prorated first month`) as the exact text.
- **`register-quote` preconditions** mark "a this-month start date exists" as skippable (steps
  4–5 `skipped`, run can still pass), matching D1/D5; the other preconditions stay blocking.
- **`f15-prorated-top-payer` and `charge-dialog-modes`** need no step changes; their "read-only
  query on `friscofencing-staging`" wording becomes "read through the API by the runner".
- The three hand-run F15 result files are untouched.

### Facts the scripts rely on

- Login form: labels `Email` / `Password`, button `Log In`; success is navigation away from
  `/login` (`audit/lib/login.js`). Reuse it unchanged.
- Admin list: `GET /subscriptions?q=` matches student/parent name/email after populate; rows carry
  `studentId`, `parentId`, `scheduleId.classId.levelId`, `status`, `retryCount`,
  `nextBillingDate`, `lastPayment`.
- Charge preview: `GET /subscriptions/:id/charge-preview` → `{ outcome: 'previewable', due,
  nextBillingDate, periodStart, periodEnd, paymentMethod, … }` plus the amounts; superadmin only.
- History: `GET /registrations/history?parentId=<id>` as an admin role returns `{ history }`.
- Proration: weekday occurrences only, holidays ignored, rounded once at the end (D5).
- Staging guard: `AUDIT_STAGING_URL` must contain `friscofencing` and not be the bare
  `friscofencing.vercel.app` host (`audit/lib/staging-guard.js`); exit code 3 in the runner.

## 8. As built (PR 1, 2026-10-27)

**Files.** As §2, plus `audit/lib/gate-page.js` (shared page reads: `readText`, `waitUntil`, the
subscriptions search, the Charge and Payment History dialogs). `audit/lib/staging-guard.js` gained a
pure `stagingProblem(url)` so the runner can refuse with exit 3; `assertStaging()` is unchanged for
the live audit.

**Divergences from the plan, each for a measured reason:**
- **Page text is read without `innerText`.** `innerText` applies CSS `text-transform`, so the
  sidebar role read `SUPERADMIN` and section labels read in capitals. `readText` walks the text
  nodes instead, grouping them by their nearest non-inline ancestor and putting a space between
  neighbouring inline elements (an amount and its chip).
- **A superadmin API reader runs in its own context** (no video, no trace) for every gate, kept open
  to the end so a step can re-check data (`register-quote` step 8). The steps' recorded contexts
  are separate.
- **Videos are per account:** `gate-runs/<date>-<id>/<id>-<account>.webm` and `trace-<account>.zip`;
  the result's `recording:` lists them. The run folder takes `-2`, `-3` like result files.
- **Switching level waits for the sessions request.** Between the click and the level's own
  `/group-class-sessions/by-class/` response the previous level's pills are still on screen.
- **Precondition rows that only record a value** (the commit, P_A) are `pass`; the commit row says
  `unknown` when it cannot be confirmed, which never blocks, as the gate files say.
- **The step-count guard is static:** it counts `step(n,` calls in the script and `| n |` rows in
  the `.md`'s Steps table (stopping at the next `##`), so the frontend Jest job never loads
  Playwright.

**Verified during the build:**
- `cd audit && npm test`: 36/36 under Node 24 and Node 20 (`TZ=UTC`).
- Frontend: 81 suites / 636 tests; `auditSelectorGuard` fails on a label planted in a gate script.
- A headless run of all four gates on staging (`develop` at `1e70067`): every one passed, every
  step. Their result files and run folders were deleted, so the owner's watched runs are the first
  recorded. No password appears in any result file or trace (both values searched for in every
  trace archive).

**Watched runs (2026-10-27, `develop` at `1e70067`):** all four gates passed headed with the owner
watching — F15 9/9, charge-dialog-modes 9/9, payment-history 7/7, register-quote 8/8. Result files:
`docs/live-gates/results/2026-10-27-{f15-prorated-top-payer-4,charge-dialog-modes,payment-history,register-quote}.md`.
