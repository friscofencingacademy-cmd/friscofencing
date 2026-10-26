---
name: audit-tests
description: Static test-suite quality audit — test pyramid health, anti-patterns in backend/frontend/E2E tests, and TEST_COVERAGE.md drift. Read-only; runs no tests.
---

# /audit-tests — Test Suite Quality Audit

**Run all phases autonomously from start to finish. Do not ask questions. Do not
pause between phases. Do not ask for confirmation. Just execute every step and
produce the final report.**

Static analysis of every test file in this repo. Ported from CKQ's
`.claude/skills/audit-tests` (docs/plans/testing-strategy-refresh-plan.md PR C,
C8), with this repo's paths. The report covers three areas:

1. **Strategy**: test pyramid health and coverage gaps
2. **Anti-patterns**: specific quality issues in test files
3. **Documentation drift**: what `docs/TEST_COVERAGE.md` claims vs what is on disk

Do not run any tests. Do not write or modify any files. Read and report only.
Listing tests (`jest --listTests`, `playwright test --list`) is allowed. It
runs nothing.

Several rules are already enforced in CI by static guards. Report a guard's
rule only if the tree breaks it anyway, for example on an unmerged branch:
- `backend/tests/guards/`: no focused or reasonless skipped test; no unpinned real-clock date helper
- `frontend/lib/__tests__/guards/`: the same skip/focus rule; one E2E catch-all; the shared mock layer; arm-then-await waits

---

## Workspace

```bash
WORKSPACE=$(git rev-parse --show-toplevel)
BACKEND="$WORKSPACE/backend"
FRONTEND="$WORKSPACE/frontend"
```

Where the tests live:
- **Backend**: `backend/tests/{config,email,guards,middlewares,models,payments,routes,scripts,services,utils}`
  and `backend/tests/health.test.js`, all `*.test.js`. Shared helpers are in
  `backend/tests/testUtils/`. Route tests run real supertest against an in-memory
  MongoDB; payment tests hit Stripe TEST mode.
- **Frontend (Jest)**: `*.test.ts(x)` in the `__tests__/` folder next to the code,
  under `frontend/app/**` and `frontend/lib/**`, with MSW at the network boundary.
- **E2E (Playwright)**: `frontend/e2e/*.spec.ts`. Mocks are in
  `frontend/e2e/fixtures/mock-api.ts`, the shared `test` fixture is
  `frontend/e2e/fixtures/test.ts`, and layout helpers are in `frontend/e2e/helpers/`.

---

## Phase 1 — Strategy Review

### Step 1.1 — Read the coverage and strategy docs

Read both in full before proceeding:
- `$WORKSPACE/docs/TEST_COVERAGE.md`
- `$WORKSPACE/docs/TESTING_STRATEGY.md`

### Step 1.2 — Count test files per layer

```bash
# Backend, by layer
for d in config email guards middlewares models payments routes scripts services utils; do
  printf '%-12s %s\n' "$d" "$(find "$BACKEND/tests/$d" -name '*.test.js' 2>/dev/null | wc -l)"
done
find "$BACKEND/tests" -name '*.test.js' | wc -l

# Frontend
find "$FRONTEND/app" "$FRONTEND/lib" -name '*.test.ts' -o -name '*.test.tsx' | grep -v node_modules | wc -l
find "$FRONTEND/e2e" -name '*.spec.ts' | wc -l
```

### Step 1.3 — Evaluate test pyramid health

The usual industry shape: unit 60–70%, integration 20–30%, E2E 5–10% (critical
flows only). In this repo:
- Backend `utils/`, `models/` and `email/` are unit tests. `routes/` and most of
  `services/` are integration tests, because they use a real in-memory DB. `scripts/`
  tests migration helpers against a real DB.
- Frontend page tests are integration tests (a real component tree plus MSW). Pure
  `lib/` tests are unit tests.

Assess:
- Is the pyramid healthy or inverted?
- Is there a missing middle (unit plus E2E, no integration)?
- Do integration tests use a real DB and MSW (good), or mock the module under test
  (which defeats the layer)? Grep for `jest.mock('../../lib/services` and
  `jest.mock('../../src/services` and report each one.

### Step 1.4 — MSW infrastructure (frontend)

```bash
grep -rl "setupServer" "$FRONTEND/app" "$FRONTEND/lib" --include='*.ts' --include='*.tsx' | wc -l
grep -rlE "jest\.mock\(['\"][./]*lib/api['\"]" "$FRONTEND/app" "$FRONTEND/lib" | head
```

Report how many page tests use MSW. Any test that mocks `lib/api` (axios) directly
bypasses the network boundary. Flag it as a strategy gap.

### Step 1.5 — TEST_COVERAGE.md's improvement plan vs reality

For each numbered item in `docs/TEST_COVERAGE.md`'s "Improvement plan", check it
live (a file exists, a grep count) rather than trusting the doc's strike-through. Also
check `docs/plans/testing-strategy-refresh-plan.md` §9: report which PRs have as-built
notes and which do not.

Example live checks:
```bash
# fireEvent → userEvent retrofit (item 2): remaining fireEvent use in Jest tests
grep -rl "fireEvent\." "$FRONTEND/app" "$FRONTEND/lib" --include='*.test.tsx' | wc -l
```

### Step 1.6 — Backend services and routes with no test file

Derive the list live. Never trust a hard-coded gap list, this skill's included:

```bash
for f in "$BACKEND"/src/services/*.service.js "$BACKEND"/src/services/*/*.service.js; do
  name=$(basename "$f" .js)
  found=$(find "$BACKEND/tests" -name "${name}*.test.js" | head -1)
  [ -z "$found" ] && echo "service, no test file: ${f#$BACKEND/}"
done
for f in "$BACKEND"/src/routes/*.routes.js; do
  name=$(basename "$f" .js)
  [ -f "$BACKEND/tests/routes/${name}.test.js" ] || echo "route, no test file: ${f#$BACKEND/}"
done
```

A service with no file of its own may still be covered through its routes. Say so
when the route test exists, and do not report it as a gap.

---

## Phase 2 — Anti-Pattern Scan

Run every check over:
- `$BACKEND/tests` (`*.test.js`)
- `$FRONTEND/app` and `$FRONTEND/lib` (`*.test.ts`, `*.test.tsx`)
- `$FRONTEND/e2e` (`*.spec.ts`, and `fixtures/` and `helpers/` where a check says so)

Use the Grep tool (ripgrep) for all pattern searches, and report the file path and
line for each finding.

---

### Check 1 — Hard-coded dates

Patterns: `new Date\(['"]20[0-9]{2}-` and `['"]20[0-9]{2}-[0-9]{2}-[0-9]{2}['"]`

For each finding:
- **Safe (static fixture)**: the date is past reference data (a `createdAt`, a
  historical charge), or the file pins the clock to a literal (`jest.useFakeTimers({ now: … })`,
  `jest.setSystemTime`, testUtils' `freezeDate`, Playwright `page.clock.setFixedTime`/`install`).
  A test date in a clock-pinned file is the intended pattern.
- **Risky (time-dependent)**: the date stands for "today", "this month" or "an upcoming
  session" in a file that does NOT pin the clock. It silently changes meaning once the
  real date passes it.

Compute "today" live in Central (`TZ=America/Chicago date +%Y-%m-%d`), which is this
academy's timezone (`backend/src/config/timezone.js`). Flag every risky date that has
already passed.

Also grep for the second shape, **a now-derived date with a hard-coded part**:
`getMonth()|getUTCMonth()|getFullYear()|getUTCFullYear()` inside a `new Date(`/`Date.UTC(`
call that has a numeric day literal. It looks dynamic but expires once that day of
the month passes.

---

### Check 2 — Skipped / disabled tests

Pattern: `\.(skip|fixme)\b` or `\b(xdescribe|xit|xtest)\(`

The guards require a reason comment of five or more words. For each skip, report the
reason and judge whether it still holds. Example: the visual-baseline skips in
`public-site.spec.ts` wait on a CI-container baseline. Is one committed now
(`frontend/e2e/*.spec.ts-snapshots/`)?

---

### Check 3 — `.only` accidentally committed  ← CRITICAL

Pattern: `\.only\(` or `\b(fit|fdescribe)\(`

A committed `.only` makes CI run one test and report the file green. If any is
found, record it as CRITICAL. Keep scanning the remaining checks without pausing; it
surfaces at the top of the report.

---

### Check 4 — Sleep / timer abuse

- **E2E**: `waitForTimeout\(` in `*.spec.ts`. A fixed sleep is flaky by definition.
  Use `expect(locator).toBeVisible()`, `page.waitForURL`, or a promise-first
  `waitForResponse`.
- **Jest**: `new Promise.*setTimeout` or `setTimeout.*resolve` in `*.test.*`. Use fake
  timers or `findBy*`/`waitFor` instead.

---

### Check 5 — Console suppression without verification

Pattern: `spyOn\(console` or `console\.(error|warn).*mockImplementation`

Acceptable only when an assertion on the spy (`toHaveBeenCalled…`) follows within 10
lines. Flag every suppression with no follow-up assertion, because it hides real errors.

---

### Check 6 — Over-broad assertions

Pattern: `\.toBeTruthy\(\)` or `\.toBeDefined\(\)`

Count per layer and report the top five locations. High counts (more than 20 per
layer, relative to the file count) mean the tests pass even when the returned data is
wrong. Prefer `toEqual(expected)` or `toBe(value)`.

---

### Check 7 — Empty test bodies

Test callbacks with no `expect(` call, and `it('…')` with no callback at all (Jest
counts those as pending, which most reporters hide).

---

### Check 8 — `expect.assertions(0)`

Pattern: `expect\.assertions\(0\)`. It passes vacuously.

---

### Check 9 — Hard-coded ObjectId strings in assertions

Pattern: `['"][a-f0-9]{24}['"]` inside `expect(`, `toEqual(` or `toBe(`

Flag only an id that appears in an assertion with no creation step above it, since
that means the test was written against a specific database's state. Backend tests
build ids with `new mongoose.Types.ObjectId()`. E2E fixtures use readable ids such as
`'level-a'`.

---

### Check 10 — E2E waits over 3 seconds

Pattern in `*.spec.ts` and `e2e/fixtures/`: `waitForTimeout\(\d{4,}` or `timeout:\s*\d{4,}`

Flag anything over 3,000 ms that has no explaining comment.
`playwright.config.ts`'s `webServer.timeout` (the Next.js build) is expected.

---

### Check 11 — Backend route tests missing negative paths

For each `backend/tests/routes/<name>.routes.test.js`, count:
- success assertions: lines matching `toBe\(2[0-9][0-9]\)`
- failure assertions: lines matching `toBe\([45][0-9][0-9]\)`
- routes in `backend/src/routes/<name>.routes.js`: lines matching `router\.(get|post|put|patch|delete)\(`

```bash
for t in "$BACKEND"/tests/routes/*.routes.test.js; do
  name=$(basename "$t" .test.js)
  ok=$(grep -cE "toBe\(2[0-9][0-9]\)" "$t"); bad=$(grep -cE "toBe\([45][0-9][0-9]\)" "$t")
  routes=$(grep -cE "router\.(get|post|put|patch|delete)\(" "$BACKEND/src/routes/$name.js" 2>/dev/null || echo "?")
  echo "$name  2xx=$ok  4xx/5xx=$bad  routes=$routes"
done
```

Flag every file whose failure count is below its route count. Each route needs at
least its 401 (no session) or 403 (wrong role) case, plus 400/404 where they apply.
A route test with only happy paths misses auth bypass and validation gaps.

---

### Check 12 — Real-clock-sampled fake-timer fixtures

The inverse of Check 1: a pin that samples the real clock is not a pin.

Pattern: `useFakeTimers\(` and `setSystemTime\(` (Jest), `clock\.(install|setFixedTime|setSystemTime)\(`
(Playwright). For each match, check whether the instant is a literal
(`new Date('2026-10-15T15:00:00Z')`) or derives from the real clock (`new Date()`,
`Date.now()`, `moment()…`). Also note: a bare `jest.useFakeTimers()` starts at the
REAL time, so it does not pin anything.
- **Safe**: the derived instant only has to land on some valid day, and the
  assertions are qualitative. Report it as low priority, safe by shape.
- **Risky**: the assertions depend on an exact weekday, count, or month edge. That is
  a real finding: pin a literal instant per branch and assert literal dates.

---

### Check 13 — Dead negative assertions (frontend Jest)

An assertion that text is **not** rendered, for text no code can render any more,
can never fail. Run:

```bash
node "$WORKSPACE/scripts/dead-negative-assertions.mjs" --frontend "$FRONTEND"
```

- **Exit 0**: no candidates.
- **Exit 1**: each candidate prints as `file:line  "text"`. This is a
  `queryBy*("<text>")` with `.not.toBeInTheDocument()`/`.toBeNull()` whose text is in
  no app source, no shared test support file, and no other line of the same test file
  (titles excluded).
- **Exit 2**: the scan could not run. Report it as a failed check, never as a pass.

Triage every candidate, because the script cannot tell these apart:
- **Dead**: the text was deleted from the app. Confirm with
  `git log -S"<text>" --format='%h %ad %s' --date=short -- frontend/app frontend/lib`;
  a removing commit is the proof. Recommend deleting the assertion (or the whole test,
  if that was its only check). Never replace it with another absence check.
- **Composed / intentional**: the app could build the text at runtime, and the test
  proves it does not. Note it as such and move on.

Baseline (2026-10-26): 73 test files, 117 literal negative assertions, 2 candidates,
both intentional: `app/parent/register/__tests__/page.test.tsx:541-542` (`$210.71`,
`$134.50`). Each asserts that the page never shows a sum it computed itself, because
the backend is the only source of billing figures (CLAUDE.md hard rule 7).

---

## Phase 3 — Documentation Drift

### Step 3.1 — Headline counts

`docs/TEST_COVERAGE.md` states suite and test counts per repo, plus the E2E count.
Compare them with:

```bash
(cd "$BACKEND" && npx jest --listTests | wc -l)          # backend suites
(cd "$FRONTEND" && npx jest --listTests | wc -l)         # frontend suites
(cd "$FRONTEND" && npx playwright test --list | tail -1) # "Total: N tests in M files" (both projects)
```

Jest's test count needs a run, so this read-only skill approximates it. Count
`^\s*(it|test)(\.each\([^)]*\))?\(` per repo and report it as an approximation (an
`it.each` expands at run time). Flag any drift in the suite count and the E2E count,
which are exact.

### Step 3.2 — Areas with no mention

List `backend/tests/routes/*.routes.test.js` and frontend `__tests__` folders that
`docs/TEST_COVERAGE.md`'s per-layer tables do not mention. Cross-reference
`CLAUDE_HISTORY.md`'s recent entries for shipped features.

### Step 3.3 — Snapshot staleness

Find the date of the doc's latest re-measurement (the `Re-measured YYYY-MM-DD` line),
and today in Central (`TZ=America/Chicago date +%Y-%m-%d`). Report the gap in days.
Flag it when more than a month of merged test work (`git log --since=<date> --oneline -- backend/tests frontend`)
has landed since.

---

## Output Format

```
════════════════════════════════════════════════════════════════
 FRISCO FENCING TEST AUDIT — <date>
════════════════════════════════════════════════════════════════

⚠️  CRITICAL FINDINGS (address before the next main release)
  [any .only, expired hard-coded date in a time-dependent context, or a guard rule broken]
  (or: None)

────────────────────────────────────────────────────────────────
PHASE 1 — STRATEGY
────────────────────────────────────────────────────────────────
Test file counts:
  Backend  : N files  (utils X | models X | email X | services X | routes X | scripts X | payments X | other X)
  Frontend : N Jest files + N E2E specs

Pyramid health:
  Backend  : X% unit / Y% integration → [HEALTHY | INVERTED | GAP]
  Frontend : X% unit / Y% integration / Z% E2E → [HEALTHY | MISSING INTEGRATION LAYER]

MSW (frontend): N page tests on MSW; direct lib/api mocks: <list | none>
Improvement plan / refresh-plan status: <item — done | open (live evidence)>
Services/routes with no test file: <list | none>

────────────────────────────────────────────────────────────────
PHASE 2 — ANTI-PATTERNS
────────────────────────────────────────────────────────────────
[1]  Hard-coded dates           RISKY: <file>:<line> — <why> | SAFE: N | ✅ None
[2]  Skipped tests              <file>:<line> — <reason, still valid?> | ✅ None
[3]  .only committed            <file>:<line>  ← CRITICAL | ✅ None
[4]  Sleep / timer abuse        <file>:<line> | ✅ None
[5]  Console suppression        <file>:<line> — no spy assertion | ✅ All verified
[6]  Over-broad assertions      Backend N, Frontend N — top: <file>:<line>… → [acceptable | HIGH]
[7]  Empty test bodies          <file>:<line> | ✅ None
[8]  expect.assertions(0)       <file>:<line> | ✅ None
[9]  Hard-coded ObjectIds       <file>:<line> | ✅ None
[10] E2E waits > 3 s            <file>:<line> — <N> ms [explained | unexplained] | ✅ None
[11] Route negative paths       <file> — 4xx/5xx N < routes M | ✅ All covered
[12] Real-clock-sampled pins    <file>:<line> [safe-by-shape | risky] | ✅ None
[13] Dead negative assertions   N candidates: D dead (<sha>), I intentional | ✅ None

────────────────────────────────────────────────────────────────
PHASE 3 — DOCUMENTATION DRIFT
────────────────────────────────────────────────────────────────
Headline counts: doc <…> vs disk <…>  [match | DRIFT]
Unmentioned areas: <list | none>
Snapshot: <date> (<N> days; <M> test commits since) [current | STALE]

────────────────────────────────────────────────────────────────
VERDICT
────────────────────────────────────────────────────────────────
🔴 CRITICAL  • <item>
🟡 WARNING   • <item>
ℹ️  INFO      • <item>

Overall health: [CRITICAL | NEEDS ATTENTION | GOOD]
════════════════════════════════════════════════════════════════
```

---

## Notes

- This skill reads files only. No tests run and no files are modified.
- Hard-coded-date and real-clock findings need judgement. The skill flags them, but
  cannot always tell a static fixture from a time-dependent one.
- `.only` findings are CRITICAL. Surface them at the top whatever the scan order.
- `docs/TEST_COVERAGE.md`'s "Intentionally skipped" list has documented reasons. Do
  not flag those items as gaps.
