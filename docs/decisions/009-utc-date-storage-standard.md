# ADR 009: UTC date-storage standard — two shapes, one gate module per side

**Status:** Implemented — 2026-08-30 (`docs/plans/utc-date-standard-plan.md`, 3 PRs: #76 frontend display gate, #77 backend gates + sentinel normalization, and this PR's private-class real-instant fix, all merged to `develop`).

## Context

A parent reported the trial-session picker showing a Sunday pill for a Mon/Wed/Fri class. Root cause traced to three coexisting, undeclared date-storage conventions in the same codebase:

1. `GroupClassSession.date` was generated as a **Central-midnight real instant** (`docs/plans/timezone-consistency-plan.md` D4/D5), while `Subscription`/`Registration` period fields (`currentPeriodEnd`, `periodStart`/`periodEnd`) are **UTC-midnight calendar-day sentinels** (`billingDates.js`'s own documented convention, matching CKQ's `dateUtils.js` split of `todayET()` vs `todayMidnightET()`) — two different shapes for what a reader would assume is "the same kind of date."
2. The frontend rendered every date via `toLocaleDateString()`/`toLocaleString()` with no `timeZone` option — browser-local, which silently renders the wrong calendar day for a sentinel whenever the viewer's device timezone sits west of UTC. Verified live: staging's stored sessions were `T04:00:00.000Z` (Eastern-midnight, from the owner's own dev machine) — a Monday session rendered as "Sunday" for any Central-timezone parent.
3. `PrivateClassSession.startDate`/`endDate` used `combineDateAndTime()`'s server-local `setHours()` — on Vercel's UTC production server, that wrote a Central wall-clock time's raw clock numbers directly into the UTC field, storing every private-lesson session hours early and silently widening the attendance/per-session-charge gate before the lesson actually happened. Confirmed against real staging data before the fix: every stored session was off by exactly the Central/UTC offset.

CKQ's own `dateUtils.js` (`chesskqwebsite/backend/backend-2.0/src/utils/dateUtils.js`) had already solved the same class of problem: every `Date` is one of two declared shapes, each with one blessed constructor and one blessed renderer, backed by real `moment-timezone` IANA math — not a second, ad hoc implementation.

## Decision

Adopt CKQ's two-shape contract, ported to this codebase's actual field set, with one gate module per side (backend, frontend) rather than scattering construction/comparison/rendering logic across call sites:

| Shape | Meaning | Backend gate | Frontend gate | Render |
|---|---|---|---|---|
| **Calendar-day sentinel** | A pure calendar day, no real timezone meaning. Stored as UTC midnight. | `backend/src/utils/dateShapes.js`: `dateOnlyUTC`/`addDaysToDateOnly`/`nextDateOnlyOnOrAfter`; compare only via `billingDates.js`'s `todayDateOnly()` | `frontend/lib/formatDate.ts`: `CalendarDay`/`todayInAcademyTZ`/`sentinelCalendarDay`/`calendarDayOrdinal`/`addCalendarDays` | `email/dates.js`'s `dateOnlyFull` (UTC); frontend's `formatDateOnly` (UTC) |
| **Real instant** | An actual point in time. Stored as the true UTC instant. | `dateShapes.js`'s `combineDayAndTimeInTZ` (wall-clock day+time → UTC via real IANA math) | n/a (backend-constructed, frontend only renders) | `email/dates.js`'s `dateFull` (Central); frontend's `formatInstant` (Central) |

Applied per field:

- `GroupClassSession.date` — sentinel. Generator (`groupClassSession.service.js`) and range queries (`listUpcomingByClass`) rebuilt on the gate; supersedes the Central-midnight-instant choice from `timezone-consistency-plan.md` D4/D5 for this one field only (that plan's other primitives — `todayAtMidnight`, `addOneDay`, `nextOccurrenceStrictlyAfter` — are unaffected and remain correct).
- `Subscription.currentPeriodStart/End`/`nextBillingDate`, `Registration.periodStart`/`periodEnd` — sentinel (unchanged shape, already correct when built from `todayDateOnly()`/a client date string; the bug was contamination when a `GroupClassSession.date` value flowed through `resolveStartDate` before the generator fix).
- `PrivateClassSession.startDate`/`endDate` — real instant, rebuilt on `combineDayAndTimeInTZ`, weekly-stepped *inside* the tz-anchored `moment` chain (never `setDate()` on an already-resolved instant — the same DST-unsafe pattern `billingDates.js`'s `addOneDay` exists to avoid).
- Every roster-mutation call site (`addStudentToRoster`/`removeStudentFromRoster`, four call sites across `registration.service.js`, `renewal.service.js` ×2, `subscription.service.js`, and a legacy-import script) now passes a sentinel, not `todayAtMidnight()`'s instant shape — closes a same-day-session exclusion that was live in production.
- `email/dates.js` gained `dateOnlyFull` (UTC) alongside the existing `dateFull` (Central); `monthLabel` — whose one real caller always feeds it a period-start sentinel — switched from Central to UTC-anchored.

**No migration was built for `PrivateClassSession`, and the group-class migration (`normalize-date-sentinels.js`, PR #77) was never run against staging or production** — owner-confirmed 2026-08-30: staging holds only disposable test data (reset via the existing wipe/reseed scripts rather than migrated) and production's private-class collection is empty. The migration script for group-class sentinels ships anyway (PR #77) as a tested, dry-run-first tool for whenever real contaminated data exists in any environment; building the equivalent for private-class instants was judged premature engineering against data that doesn't exist and was deliberately dropped from scope (owner decision, this PR).

## Consequences

- Two small gate modules (one per side) are now the only place either shape is constructed — a future field in either shape has one pattern to copy, not a decision to re-derive.
- `docs/TESTING_STRATEGY.md` codifies the contract for test fixtures too: hand-rolling a sentinel/instant any other way (raw `setHours`/`setDate` on an instant, `moment(sentinel).tz(tz)` on a sentinel) is wrong even if it happens to pass under `TZ=UTC`.
- `docs/plans/timezone-consistency-plan.md` is **not** superseded wholesale — only its `GroupClassSession.date` generation choice (D4/D5) changed; its `todayAtMidnight`/`todayDateOnly`/`addOneDay`/D9/D10 reasoning is the foundation this ADR builds on and remains correct.
- If real private-class data is ever contaminated in a live environment before another fix ships, `scripts/lib/normalizeDateSentinels.js` is a directly copyable template (it already handles the general "truncate a contaminated instant, dry-run first, abort on ambiguity, skip on unique-index collision" shape) — not built preemptively, but the pattern is proven and available.

## Alternatives considered

- **Central-midnight instants for `GroupClassSession.date`** (the pre-existing choice) — rejected: disagrees with every other sentinel field in the codebase, and renders wrong in any formatter/comparison that assumes UTC midnight.
- **Fix only the frontend rendering, leave backend storage contaminated** — rejected as the final state (though shipped first, deliberately, as PR #76 — see that PR's D3: UTC rendering is day-correct for every shape currently in the wild, so it was safe to ship ahead of the backend fix and gave users the visible fix immediately). Backend construction still needed fixing at the source, since the trial-confirmation email and the private-lesson charge gate are both server-side and unaffected by any frontend change.
- **A generic `Date`-shape wrapper class/type** — rejected as over-engineering for a codebase this size; two named function groups per side (matching CKQ's own precedent) are simpler to find and audit than a wrapper type threaded through every call site.
