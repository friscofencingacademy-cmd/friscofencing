# Implementation plan: Timezone consistency — Central time default, location-ready

**Status:** BUILT 2026-08-28 on `feature/timezone-consistency`, awaiting owner diff review before
commit (Hard Rule 5 — payment-adjacent). **Sequenced BEFORE `docs/plans/registration-ledger-
plan.md` PR 2** (explicit owner decision) — PR 2's renewal create-pending-first sequencing reads
`todayAtMidnight()` for its charge-eligibility gate; it now builds on an already-correct "today"
from day one instead of needing a second pass later. D9 and D10 were both found and corrected
DURING the build, not fully anticipated in the original plan — see those sections for what
changed and why; the plan below reflects the final, as-built design.

**Builder:** sized small enough that either Fable or a Sonnet session can execute it — the
owner's call at `write` time. Read the file list in §7 in full before editing anything; this is
a payment-adjacent change (it feeds `renewal.service.js`'s charge gate) even though no file it
touches is itself a charge call.

---

## 0. Why this, why now

Frisco Fencing is a single-location business, always Central time, with locations planned as a
future feature. The question was: is our timezone handling actually correct today the way CKQ's
is, or does it just look that way because there's only one timezone in play so far?

**Answer, verified against source 2026-08-28 (not assumed):** not yet. `Location.timezone`
exists with the right shape and the right default, but nothing in the codebase reads it —
day-boundary/"today" logic is computed via raw server-local `Date` math, and **no `TZ` env var
is set anywhere** (checked both repos' `vercel.json`/`.env.example`) and **no timezone-math
library is installed at all**. Vercel's Node runtime defaults to UTC when `TZ` is unset, so in
production "today" is currently computed in UTC, not Central — a permanent ~5-6 hour gap every
day (roughly 6pm–midnight Central), not a rare edge case.

This is the exact bug class CKQ's `dateUtils.js` was built to close, after it shipped **four
separate times** in that codebase before being centralized (`docs/TESTING_STRATEGY.md`'s
"Timezone day-boundary math" section, in the chesskq workspace). Frisco has the equivalent bug,
unfixed, sitting directly under the renewal cron's `nextBillingDate <= today` gate — i.e. under
real money movement, not a display nicety.

---

## 1. Current-state audit (every call site, verified against source)

| File / function | What it does today | Risk |
|---|---|---|
| `backend/src/utils/billingDates.js` `todayAtMidnight()` | `new Date(); setHours(0,0,0,0)` — server-local (UTC in prod) | **High** — feeds `renewal.service.js` (renewal cron gate, line 63 + candidate query line 221), `registration.service.js` (past-date validation line 111, roster anchor line 323), `subscription.service.js` (schedule-change effective date line 290) |
| `billingDates.js` `addOneDay()` | raw `setDate` | **Medium, forward-looking** — zero call sites today; would hit real DST drift once ledger-plan PR 3's `nextRetryAt: addOneDay(todayAtMidnight())` lands (D9) — fixed now, before that PR needs it |
| `billingDates.js` `addOneMonth()`/`addMonths()`/`daysInMonth()`/`endOfMonth()` | raw `setMonth`/local getters | **None** — every real call site operates on a date-only sentinel, not a real instant; confirmed by tracing shapes (D9, corrected) — no change needed |
| `backend/src/utils/scheduleOccurrence.js` `nextOccurrenceStrictlyAfter()` | raw `getDay()`/`setDate()` | Medium — private-class public availability preview + session generation |
| `backend/src/services/groupClassSession.service.js` `nextOccurrenceOnOrAfter()` | raw `getDay()`/`setDate()`, own copy of the same logic | Medium — new group-class-schedule session generation |
| `backend/src/services/groupClassSession.service.js` `listUpcomingByClass()` | its own **third** independent `new Date(); setHours(0,0,0,0)` | Medium — trial-booking "upcoming sessions" window (user-facing, not money) |
| `backend/src/email/dates.js` `TIME_ZONE` constant | hardcoded `'America/Chicago'`, used correctly via `Intl.DateTimeFormat` | Low — already timezone-correct, but a second, un-synced source of truth from `Location.timezone` |
| `frontend/lib/formatTime.ts`, `email/dates.js`'s `timeOfDay()` | parse `"HH:mm"` as literal wall-clock digits, no real-instant conversion | **None** — this is the correct pattern for a schedule's own local time string; do not touch |
| `backend/src/services/billing/proration.service.js` `countClassDays()` | `new Date(year, month, day).getDay()` on already-resolved calendar components | **None directly** — see D7; it inherits correctness from its caller's anchor date, needs no change of its own |
| `Location.timezone` (model field) | exists, `default: 'America/Chicago'`, correct shape | Already right — see D8, no schema change |
| `registration.service.js` `create()`/`previewChargeAmount()`'s `anchorDate` fallback | `now = new Date()` when no `startDate` chosen, feeds `computeProration()`'s local-getter date extraction | **High** — found during the exhaustive sweep (D10); real proration bug for immediate (no-future-date) registrations in the gap window, distinct fix from D3/D9 |

---

## 2. Target architecture

Match CKQ's proven pattern (`moment-timezone`, one `DEFAULT_TIMEZONE` constant, tz-aware
day-boundary helpers), sized for "one location today, more later":

- `DEFAULT_TIMEZONE = 'America/Chicago'` — one constant, one place, imported everywhere that
  needs a fallback timezone. Never hardcoded a second time anywhere else (this is CKQ's own
  explicit rule, stated in its `dateUtils.js` docblock, and it's the reason `email/dates.js`'s
  separate hardcoded constant is a problem worth fixing even though it happens to be correct
  today).
- Every day-boundary helper gains an **optional** `tz` parameter defaulting to
  `DEFAULT_TIMEZONE`. This is what makes the fix free of consumer-side churn today (every current
  call site calls these functions with zero arguments, so behavior for them changes from "wrong,
  UTC-anchored" to "correct, Central-anchored" with no code change at the call site) while making
  every helper ready to accept `location.timezone` the day a second location exists, without
  re-plumbing signatures then.
- `Location.timezone` itself is **not wired into any call site by this plan** — there is
  exactly one location, so there is nothing to select between yet. This plan only makes the
  wiring possible later; actually reading `location.timezone` at a call site is future work,
  explicitly out of scope here (see §4).

---

## 3. Design decisions

### D1 — Add `moment-timezone`

Same library CKQ uses. This is a proven fix for a bug class Frisco doesn't need to
re-discover independently; picking a different (e.g. native `Intl`-only) approach would mean
hand-rolling IANA DST-transition math that `moment-timezone` already gets right, for no benefit.

### D2 — New `backend/src/config/timezone.js`

Matches the existing `config/billing.js` precedent (a single-constant module, not buried in a
utils file). Exports `DEFAULT_TIMEZONE = 'America/Chicago'` only. This is the one place the
literal string `'America/Chicago'` is allowed to appear in application code — every other file
imports it.

Why a new `config/` file rather than adding it to `billingDates.js`: `billingDates.js`'s own
docblock scopes it to "the billing domain" — `email/dates.js` (presentation layer) importing a
constant from a billing-domain util would be a backwards, confusing dependency. A neutral
`config/timezone.js` avoids that and matches how `config/billing.js` already isolates
`MAX_PAYMENT_RETRIES` from the service code that uses it.

### D3 — `billingDates.js`: `todayAtMidnight(tz = DEFAULT_TIMEZONE)`

```js
const moment = require('moment-timezone');
const { DEFAULT_TIMEZONE } = require('../config/timezone');

function todayAtMidnight(tz = DEFAULT_TIMEZONE) {
  return moment().tz(tz).startOf('day').toDate();
}
```

Same name, same zero-arg call convention every existing caller already uses — this is the whole
point: `renewal.service.js`, `registration.service.js`, `subscription.service.js` need **zero
changes** for this fix to take effect for them. Verified: grepped every current call site (4,
listed in §1) — all call it with no arguments.

### D4 — `scheduleOccurrence.js`: `nextOccurrenceStrictlyAfter(fromDate, dayOfWeek, tz = DEFAULT_TIMEZONE)`

Same treatment — `moment(fromDate).tz(tz)` for the day-of-week walk instead of raw
`getDay()`/`setDate()`. Update its own comment (currently disclosed as an "MVP simplification");
this plan is what closes that disclosed gap, so the comment should say what actually happens now,
not what used to.

### D5 — `groupClassSession.service.js`: two call sites

1. `nextOccurrenceOnOrAfter(fromDate, dayOfWeek, tz = DEFAULT_TIMEZONE)` — same treatment as D4.
   Consider (builder's judgment, not mandated) whether this and `scheduleOccurrence.js`'s
   strictly-after version should become one shared helper taking an `inclusive` flag — they are
   near-duplicates today and this plan touches both anyway. Not required; don't let it expand
   scope if the two call sites have any behavioral nuance worth keeping separate.
2. `listUpcomingByClass()`'s inline `new Date(); rangeStart.setHours(0,0,0,0)` — replace with a
   call to `todayAtMidnight()` from `billingDates.js` instead of hand-rolling a third copy of the
   same primitive. This is a consolidation, not just a tz fix — one fewer place this bug class can
   reappear in.

### D6 — `email/dates.js`: consolidate `TIME_ZONE`

Delete the private `TIME_ZONE` constant; import `DEFAULT_TIMEZONE` from `config/timezone.js`
instead. No behavior change (it already formats correctly) — this is purely closing the
"two sources of truth" gap so a future timezone change can't update one and miss the other.

### D7 — `proration.service.js`: reviewed, no change

`countClassDays()` operates on already-resolved `year`/`month`/`day` integers, not on "now" —
`new Date(year, month, day).getDay()` correctly answers "what weekday is this already-known
calendar date" regardless of server timezone, because both the construction and the `.getDay()`
read use the same (local) reference frame consistently. It needs no change of its own; it
inherits correctness once its callers (ultimately `registration.service.js`'s `anchorDate`, which
traces back to `now`/`todayAtMidnight()`) pass a Central-correct calendar date. Documenting this
explicitly so a future reader doesn't wonder why this file wasn't touched.

**Worth flagging, not promising:** the pre-existing, already-tracked "$0-remaining-class-days"
proration test flakiness (`registration.routes.test.js`'s two proration tests, which have failed
intermittently across multiple recent PRs when run near real-world month-end) is a *different*
documented bug, but it's in exactly this date-math neighborhood. Re-check whether it still
reproduces after this plan ships — it may or may not be related; do not assume it's fixed by this
plan, and do not attempt to fix it here if it isn't (separate, already-tracked item).

### D8 — `Location.timezone`: no schema change to its role, but add format validation

**Update, 2026-08-29 (`docs/plans/frontend-polish-plan.md` PR 4):** the "no call site yet" premise
below is now out of date — `groupClassSchedule.service.js`'s `listPublic()` returns
`Location.timezone` per public schedule row (the location was already populated for that query, so
this is a zero-extra-query field), replacing the frontend's previous "guess from whichever location
loaded first" logic on `/classes`. The rest of this section is left as written for the historical
record of why the validator was added ahead of having a consumer.

Shape and default stay as-is (`String`, `default: 'America/Chicago'`) — this plan still does not
wire it into any call site (one location, nothing to select between yet). But it currently has
**no validation that the value is a real IANA zone name** — an admin typo when a second location
is added later (`'America/Chigaco'`) would not error; `moment-timezone` silently treats an
unrecognized zone as UTC, which is exactly the wrong-timezone bug this plan exists to fix,
reintroduced through a data-entry typo with no error at write time. Add a Mongoose custom
validator on `Location.timezone` — `moment.tz.names().includes(value)` — now, while it's cheap
and the dependency is already being added for D1. This directly serves the "future locations"
half of the ask: it's the guardrail that makes location expansion safe later, even though this
plan doesn't use the field for anything yet.

**Checked, not assumed:** every controller in this codebase does `error.status || 500` (grepped
all of them) — a raw Mongoose `ValidationError` has no `.status`, so without a catch this new
validator would surface as a bare 500 with an internal Mongoose message, not a clean 400. Add a
`ValidationError`-only catch in `location.service.js`'s `create()`/`update()` remapping to the
existing `badRequestError()` convention. Scoped to exactly this: `location.routes.test.js`
already has no coverage for a missing-required-field 500 either (checked — that's a **pre-existing,
unrelated gap**, not introduced by this plan, and not fixed by it — only the new timezone
validator gets the remap, not a general overhaul of Location's error handling).

### D9 — `addOneDay` needs to become DST-safe; `addOneMonth`/`addMonths`/`daysInMonth`/
`endOfMonth` do NOT (corrected during implementation pre-reads — the first version of this
section, written last turn, was itself wrong; caught by tracing every actual call site's input
shape before writing code, not by re-reading the earlier reasoning)

**What last turn's version of D9 got right:** raw `setDate`/`setMonth` math is not DST-safe in
general — demonstrated, still true. **What it got wrong:** it assumed `addOneMonth()`'s inputs
are real Central instants (like `todayAtMidnight()`'s output) and would need tz-reinterpretation
to fix. Tracing every actual call site (grepped, all of them) shows the opposite: `anchorDate`
(→ `currentPeriodStart`), and every `currentPeriodEnd`/`nextBillingDate` it produces via
`addOneMonth`, is — and, after D10, remains — a **date-only UTC-midnight sentinel** (no real
timezone meaning, matching `GroupClassSession.date`'s own convention), never a genuine Central
instant. **Reinterpreting a date-only sentinel through the Central timezone lens before adding a
month is itself a bug**, not a fix — demonstrated directly:

```
new Date('2026-03-08')                                    // sentinel: means "March 8", nothing more
moment(sentinel).tz('America/Chicago').add(1,'month')  ->  2026-04-07  (WRONG — off by a day)
moment.utc(sentinel).add(1,'month')                     ->  2026-04-08  (correct — zero DST
                                                              exposure, because UTC has no DST)
```

So: `addOneMonth`, `addMonths`, `daysInMonth`, `endOfMonth` — every real call site today
(`registration.service.js`, `renewal.service.js`'s period rollover, `proration.service.js`,
`registrationFee.service.js`'s grace deadline) operates on this sentinel shape. **These four
functions need no change at all** — same "no change, inherits correctness from a
consistently-shaped input" conclusion as D7's `proration.service.js` finding, just established
more rigorously this time by tracing shapes instead of assuming them.

**`addOneDay` is different, and does need the fix**, but not for a reason that bites today:
`addOneDay` currently has **zero real call sites** anywhere in this codebase (grepped — confirmed
absent outside `billingDates.js` itself). It exists because `docs/plans/registration-ledger-plan.md`
D6 (not yet built — Item 3 of the batch orchestrator) specifies `nextRetryAt: addOneDay(todayAtMidnight())`
— and `todayAtMidnight()`'s output (post-D3) genuinely IS a real Central-midnight instant, not a
sentinel. That future call site would hit the exact DST drift last turn's D9 demonstrated. Fixing
`addOneDay` now — `moment(date).tz(tz).add(1, 'day').toDate()`, DST-safe, wall-clock-preserving —
closes a latent gap before PR 3 builds on it, rather than leaving a known-wrong function for a
future PR to discover, or worse, not discover.

New test: `addOneDay()` preserves the correct Central wall-clock instant across both 2026 DST
transitions (spring-forward and fall-back), contrasted against the raw-math result. Also add a
regression test locking in the *other* half of this finding — `addOneMonth()`/`addMonths()`
called on a date-only sentinel across the same DST transitions returns the calendar-correct next
month/day (`moment.utc(...).add()`-equivalent), NOT the tz-reinterpreted result — so a future
change can't "fix" these back into the bug this section just walked away from.

### D10 — `registration.service.js`'s `anchorDate` fallback (found during implementation's own
pre-read pass, not in the original discussion — the exhaustive `new Date()` sweep D9 itself was
built from)

**A second, distinct bug from D3/D9, needing its own fix — not just "one more `todayAtMidnight()`
call site."** `create()`/`previewChargeAmount()` (registration.service.js lines 182/407) do
`const now = new Date(); const anchorDate = requestedStartDate ?? now;` — when a parent registers
without picking a future start date (the common case), `anchorDate` defaults to the exact current
instant. This flows into `proration.service.js`'s `computeProration({ registrationDate:
anchorDate })`, which extracts the calendar day via **local `Date` getters**
(`.getFullYear()/.getMonth()/.getDate()`) — the same drift-prone operation D3 fixes elsewhere,
here unfixed because `todayAtMidnight()` isn't the right primitive for it (see below), so
naively swapping `now` for `todayAtMidnight()` would NOT actually fix this — verified by working
through the shapes, not assumed:

- `requestedStartDate` (the other `anchorDate` branch) is a **UTC-midnight sentinel** — pure
  calendar-date data with no real-time meaning, from `new Date("YYYY-MM-DD")`, matching how
  `GroupClassSession.date` itself is stored (confirmed: a plain `Date` field, unique per
  `scheduleId`+`date`, the same "date-only" convention CKQ's own `parseDate()` uses).
- `todayAtMidnight()`, even after D3's fix, deliberately returns the **opposite shape** — the
  true Central-midnight instant expressed as a real UTC timestamp (e.g.
  `2026-03-09T05:00:00.000Z`, not `00:00:00.000Z`) — correct for D3's own use (comparing against
  other real instants like `nextBillingDate`), wrong here: it would make `anchorDate` sometimes
  a UTC-midnight sentinel (`requestedStartDate` given) and sometimes a real 5am/6am-UTC instant
  (`now` fallback) — two different shapes for the same field, which local-getter date extraction
  would then read inconsistently depending on which branch ran.
- CKQ's own `dateUtils.js` independently hit this exact distinction and ships **two** separate
  "today" primitives for exactly this reason — `todayET()` (UTC-midnight sentinel) vs.
  `todayMidnightET()` (real instant) — with its own docblock explicitly warning "Unlike
  `todayET()`... this returns the moment when the calendar day actually begins." Finding the same
  split independently, then confirming it against CKQ's already-solved version, is strong
  evidence this is a real distinction and not overthinking it.

**Fix:** add `todayDateOnly(tz = DEFAULT_TIMEZONE)` to `billingDates.js` — Frisco's equivalent of
CKQ's `todayET()`: `moment().tz(tz).format('YYYY-MM-DD')` parsed the same way
`resolveStartDate()` already parses a client `startDate` string (`new Date(...)`), so the two
`anchorDate` branches produce the identical UTC-midnight-sentinel shape. `registration.service.js`
line 182/407: `const anchorDate = requestedStartDate ?? todayDateOnly();`. This is the ONLY
change needed — `computeProration()` itself still needs no edit (D7's "no change" claim now
holds for real, because its input is finally shape-consistent, not because the function doesn't
care about timezones).

New test: register with no `startDate` at an instant in the UTC/Central gap window (mirroring
§5's pattern) — assert the persisted `currentPeriodStart`/the proration calculation both reflect
the correct **Central** calendar day, not the UTC one; assert `todayDateOnly()` and
`requestedStartDate`-shaped values compare/serialize identically (same sentinel shape) so no
future code has to special-case which branch produced `anchorDate`.

---

## 4. Explicitly NOT changing

- `Location` schema's field/default/role — already correct, unchanged (D8 adds a format
  validator to the existing `timezone` field; it does not change what the field means or does).
- `"HH:mm"` wall-clock formatters (`email/dates.js`'s `timeOfDay()`, `frontend/lib/formatTime.ts`)
  — these deliberately treat a schedule's stored time as a literal string, never a real instant.
  Converting them through a timezone would be wrong, not a fix — do not touch.
- `proration.service.js` (D7).
- Actually reading `location.timezone` at any call site — future work once a second location
  exists.
- The `addStudentToRoster` anchorDate bug (`registration-ledger-gap-analysis.md`, already
  tracked) — may become an easier fix once this lands (it also calls `todayAtMidnight()`) but
  fixing its own logic is separate, out of scope here.
- The $0-proration edge case (D7's flag) — separate tracked item.

---

## 5. Test plan

The single biggest regression risk, and the thing to be genuinely careful about: existing tests
that build an "expected date" fixture via raw `new Date()`/`setHours` math (mirroring the OLD
implementation) to compare against these functions' output. Most of this codebase's fixed test
instants are midday UTC (per `docs/TESTING_STRATEGY.md`'s date-rules convention), which is
early morning Central — safely inside the same calendar day in both zones, so most existing tests
should be unaffected. But this must be verified test-by-test for every suite touching
`billingDates.js`/`scheduleOccurrence.js`/`groupClassSession.service.js`/`renewal.service.js`/
`registration.service.js`/`subscription.service.js`, not assumed.

**New tests, the actual point of this plan** — pin a `jest.useFakeTimers` instant between
~6pm–midnight Central (e.g. `2026-01-15T23:30:00.000Z`, which is 5:30pm Central — inside the gap
window on the OTHER side; pick a genuine UTC-vs-Central-disagreement instant and state which one
in the test name) and assert:
- `todayAtMidnight()` returns the correct **Central** calendar day, demonstrably different from
  what raw `new Date().setHours(0,0,0,0)` would have returned at that instant — the test should
  make this contrast explicit (compute both, assert they differ, assert the tz-aware one is
  right), so it actually proves the fix rather than just exercising the new code path.
- `nextOccurrenceStrictlyAfter()` / `nextOccurrenceOnOrAfter()` return the correct next weekday
  when `fromDate` sits in that same gap window.
- `renewOne()`'s existing "not due yet" / "due today" boundary tests still pass, plus one new
  case at a UTC/Central-disagreement instant proving the renewal gate now uses the correct
  calendar day.
- **Mock-fidelity note** (mirrors CKQ's own documented warning): if any suite ever mocks
  `billingDates.js`/`config/timezone.js` wholesale, the mock must reflect its real input/tz
  behavior, not a naive stub that ignores the timezone argument — a stub that always returns the
  same fixed value would make a test pass without exercising anything real.

**D9's tests — two real 2026 DST transitions, both directions:**
- `addOneDay()` across the March 8→9, 2026 spring-forward boundary AND the November 1→2 fall-back
  boundary: given a real Central-midnight instant (e.g. `todayAtMidnight()`'s shape), assert the
  result is exactly the next day's Central midnight, contrasted against what the raw `setDate`
  math would have produced (demonstrated 60-minute drift) — "prove the fix," same standard as D3.
- **Regression lock, the other half of D9's correction:** `addOneMonth()`/`addMonths()` given a
  date-only sentinel (e.g. `new Date('2026-03-08')`) across the same two transitions returns the
  calendar-correct next month (`2026-04-08`, `2026-12-08`), NOT a tz-reinterpreted result
  (`2026-04-07`) — this is what stops a future "helpful" change from reintroducing the bug D9's
  correction just walked away from.
- `location.routes.test.js`: creating/updating a `Location` with an invalid `timezone` string
  returns 400 with a clear message (D8), and a valid IANA name still succeeds.

```
cd backend && TZ=UTC npm test
```

Coverage floor unchanged (currently 86.98%, per the ledger-plan PR 1 completion notes).

---

## 6. Docs to update

- `docs/TESTING_STRATEGY.md` — add the same "Timezone day-boundary math" section CKQ's carries
  (adapted: `moment-timezone`, `DEFAULT_TIMEZONE`/`config/timezone.js`, the mock-fidelity note).
- `docs/decisions/001-in-house-subscription-billing.md` — short addendum noting the renewal gate
  now resolves "today" via `DEFAULT_TIMEZONE`, not server-local time.
- `CLAUDE.md` — register this plan in the Documentation Map; mark closed once shipped.
- `docs/plans/registration-ledger-gap-analysis.md` — note the possible (not confirmed)
  relationship to the $0-proration flakiness, per D7.

---

## 7. Builder instructions

**Pre-reads (mandatory, in order):**
1. This doc, in full.
2. `backend/src/utils/billingDates.js`, `scheduleOccurrence.js`, `groupClassSession.service.js`,
   `email/dates.js`, `src/config/billing.js` (the `config/` single-constant precedent),
   `src/models/location.model.js`, `src/services/location.service.js`, in full, before editing
   any of them.
3. `backend/src/services/renewal.service.js`, `registration.service.js`, `subscription.service.js`,
   `registrationFee.service.js`, `billing/proration.service.js` — not edited by this plan for
   their own logic (D7/D9), but read them to confirm (as this doc claims, and D9's correction
   depends on) exactly which `billingDates.js` call sites pass a date-only sentinel vs. a real
   instant, so you don't accidentally "fix" `addOneMonth`/`addMonths`/`daysInMonth`/`endOfMonth`
   into the reinterpretation bug D9 walked away from. Only `registration.service.js`'s two
   `anchorDate` lines (D10) get an actual edit.
4. `docs/TESTING_STRATEGY.md`'s date-rules section before writing any test.

**Rules:**
- One PR, on its own `feature/*` branch from latest `develop`.
- Do not touch `proration.service.js` (D7) or any `"HH:mm"` formatter (§4) — reviewed and
  explicitly excluded; touching them would be scope creep, not part of this fix.
  `addOneMonth`/`addMonths`/`daysInMonth`/`endOfMonth` (which it imports) get NO behavior change
  either (D9, corrected) — do not wrap them in `moment(date).tz(tz)` reinterpretation; only
  `addOneDay` gets the real-tz-aware treatment.
- Do not wire `location.timezone` into any call site — out of scope (D8). Do not expand D8's
  `ValidationError` remap beyond the new timezone validator — Location's general
  missing-required-field error handling is a separate, pre-existing gap, not this plan's to fix.
- Do not attempt to fix the $0-proration flakiness or the `addStudentToRoster` anchorDate bug —
  separate tracked items; just note in your report whether the proration flakiness still
  reproduces after this change, per D7.
- No `console.log` outside the established `eslint-disable`-annotated operational pattern.
- Do not commit until the full suite passes under `TZ=UTC` and the diff has been reviewed by the
  owner — this feeds a payment-critical charge gate even though it isn't itself a charge.
- Report back: files changed, test counts (added/updated/passing), the explicit before/after
  contrast from the new gap-window tests (§5), whether the $0-proration flakiness still
  reproduces, and any deviation from this spec with its reason.

**Explicitly out of scope:** `Location.timezone` call-site wiring, `proration.service.js`,
`"HH:mm"` formatters, the $0-proration edge case fix, the `addStudentToRoster` anchorDate fix,
any change to `registration-ledger-plan.md` PR 2/3 themselves (this plan ships *before* them, not
inside them).
