# Calendar View Plan — one calendar of classes and private lessons (public, parent, admin)

**Status:** PR 1 (backend) OPEN as PR #109 to `develop` (2026-09-25), pending owner staging test;
PR 2, PR 3 not started. As-built divergences: §9. Spec'd 2026-09-25 from the current code (every file, function and
field named below was checked against the tree on that date), reviewed the same day (review found
three substantive gaps and four omissions; all folded in — see §8), owner decisions O1–O5 (§7)
decided 2026-09-25. Not started. Nothing is built until the owner says `write`.

**Goal:** A calendar that shows what the academy offers, day by day, filtered by coach — so a
visitor or parent can pick a coach and see every open private-lesson slot and group class time on a
month grid (or, on a phone, a day-by-day list), then click straight into the booking flow that
already exists. The admin gets the same calendar with everything on it: booked lessons (with the
student), holidays, and links to attendance.

**Reverses a recorded decision.** `docs/design-system.md` → "Explicitly not adopted from CKQ" lists
"the discovery/calendar page patterns". The owner asked for a calendar on 2026-09-25; PR 2 moves that
item out of the list and adds a "Calendar" page pattern, recording the reversal the same way the
2026-08-29 radius change was recorded (a deliberate reversal, not a silent drift).

**Builder pre-reads (CLAUDE.md):** `docs/design-system.md`, `docs/features/admin.md`,
`docs/features/parent-portal.md`, `docs/features/private-class.md`, `docs/features/public-site.md`,
`docs/TESTING_STRATEGY.md` (date rules, E2E section), `docs/decisions/009-utc-date-storage-standard.md`
(two date shapes; the attendance addendum), `DATABASE_SCHEMA_DOCUMENTATION.md` (no schema change is
planned — read to confirm).

---

## §0 Decisions

| # | Decision | Why |
|---|---|---|
| C1 | **The backend builds every calendar event.** One new service, `calendar.service.js`, returns ready-to-draw events for a date range. The frontend does no date arithmetic on instants, no availability logic, and no price math. | Today the data is scattered: group session dates are behind login and one class per request (`GET /group-class-sessions/by-class/:classId`, `requireAuth`); private open dates are one request per rule (`GET /private-class-schedules/:id/available-dates`); holidays are admin-only. A calendar built from those would need dozens of requests and would re-derive what "bookable" means on the client. Hard Rule 7 and the public-site rule ("no client-side availability math, ever") point the same way. |
| C2 | **"Is this private slot open?" keeps exactly one home.** The loop inside `privateClassSchedule.service.js` `listAvailableDates` (weekday stepping, rule range, holidays, already-started, already-held) is extracted into `openSlotsForRules(rules, fromDay, toDay, now)` — one holidays read and one held-sessions read for all rules. `listAvailableDates` becomes a thin wrapper over it (behavior and response unchanged). The calendar calls the same function. **The held-slot key is `(scheduleId, startDate)`, never `startDate` alone** — see §1.3. | The calendar can then never show a slot the booking wizard would refuse, and vice versa. Duplicating that loop would be the exact drift the duplication-cleanup plan exists to prevent. Today's `heldTimes` set is keyed on time only, which is safe for ONE schedule; generalized to many rules it would hide two coaches' same-instant slots when one is booked. The slot-claim unique index is `{ scheduleId, startDate }`, so the set key must be too. |
| C3 | **Every event carries its Central calendar day as a string** (`day: 'YYYY-MM-DD'`), computed on the backend. The frontend places events by that string only. | ADR 009: a group session's day is a calendar-day sentinel (`GroupClassSession.date` → `sentinelDayString`), a private lesson is a real instant. Putting an instant on the right Central day is timezone math that belongs in `dateShapes.js`, not in the browser — and a browser in another timezone would otherwise draw an evening lesson on the next day. |
| C4 | **Add one date helper, `instantDayString(instant, tz = DEFAULT_TIMEZONE)`, to `utils/dateShapes.js`** (the gate for both date shapes). It returns the Central `'YYYY-MM-DD'` of a real instant. Verified 2026-09-25: no such helper exists (`dateShapes.js` exports `dateOnlyUTC`, `addDaysToDateOnly`, `nextDateOnlyOnOrAfter`, `sentinelDayString`, `combineDayAndTimeInTZ`). | Needed for booked private lessons (admin, parent). One home, tested at a DST boundary. |
| C5 | **One event shape for all three audiences**, with fields only added by role, never renamed. Public events never carry student or parent data. | One frontend type, one component; the privacy rule is testable field by field. |
| C6 | **Range limits:** `from` and `to` are `'YYYY-MM-DD'`, both required, `from ≤ to`, at most 42 days (a 6-week month grid). Public and parent ranges are also clipped to at most `PRIVATE_BOOKING_HORIZON_DAYS` days ahead of today (O3: 62, about two months) and never before today. Admin may look back. **One shared horizon constant** — `PRIVATE_BOOKING_HORIZON_DAYS = 62` in `privateClassSchedule.service.js` replaces today's `DEFAULT_AVAILABLE_DAYS = 56` as the wizard picker's default window AND is the calendar's clip. The response carries `horizonTo: 'YYYY-MM-DD'` (public/parent) or `null` (admin) so the frontend can stop at the edge. | Bounds the work per request (rules × weeks), keeps the public view about what can actually be booked, and lets the admin review past weeks. **Review finding (2026-09-25):** the wizard fetches available dates with no `days` param, so it got the 56-day default; a calendar slot past day 56 would deep-link to a wizard whose picker never offers that day — the exact "calendar shows what the wizard refuses" case C2 exists to close. One constant, two consumers, no drift. Behavior change: the wizard's picker now lists 62 days instead of 56 (`MAX_AVAILABLE_DAYS = 120` still caps the explicit `days` query). |
| C7 | **Holidays:** public and parent calendars simply omit events on holiday dates (matching the wizards). The admin calendar shows each holiday as an all-day event and shows a holiday-date group session greyed with its holiday name. | Same rule the pickers and `listBySchedule` annotations already follow (`holiday-blocking-plan.md`). |
| C8 | **Clicking an event reuses existing flows, never a new booking path.** Public/parent open private slot → `/parent/register-private?slot=<scheduleId>&day=<day>` (via `/login?next=` when logged out). `/private-classes` already builds the `?slot=` form of this link and the wizard already reads an optional `day` param (`register-private/page.tsx`, "Deep links" effect) — the calendar is the first caller to send both. Group class → `/parent/book-trial` (logged out: `/login?next=`). Admin booked lesson → `/admin/private-classes?tab=bookings`; admin group session → `/sessions/:id/attendance`. | Payment, holds, card checks and consent all stay in the one wizard that is already tested end to end. |
| C9 | **One shared frontend component, built in-house** (`app/components/calendar/`), CSS Modules and design tokens only. **No calendar library.** | The app has 7 runtime dependencies; calendar libraries ship their own CSS that fights the token system and the two shells. A month grid plus an agenda list is modest code. |
| C10 | **Two views:** a month grid (default at ≥ 769px) and an agenda list — events grouped under day headings (default at ≤ 768px, where a 7-column grid is unreadable; also selectable on desktop). | Mirrors the portal shell's own breakpoint (`docs/design-system.md`, Portal shell). |
| C11 | **View state lives in the URL:** `?month=YYYY-MM&coach=<coachId>&type=all|group|private&view=month|agenda`. Invalid values fall back to defaults, the same way the child page validates `?tab=`. | A filtered calendar is a shareable link ("Chris's lessons in October"); back/forward work; tests can deep-link. |
| C12 | **Coach filter options come from the backend** (`coaches` in the response: every coach with at least one event source in range). The frontend does not derive the list from events. | Keeps the filter stable when a month happens to have no events for a coach. |
| C13 | **Out of scope:** a coach-facing calendar (O4 — later, reuses the component), drag-to-reschedule, iCal/Google export, creating availability from the calendar, week/day time-grid views. | Each is additive on this design. |

---

## §1 PR 1 — Backend (`feature/calendar-backend`)

### 1.1 Event shape (`CalendarEvent`)

```js
{
  id: String,                 // stable: 'group:<sessionId>', 'private-open:<scheduleId>:<day>',
                              //         'private-booked:<privateSessionId>', 'holiday:<holidayId>:<day>'
  kind: 'group' | 'private-open' | 'private-booked' | 'holiday',
  day: 'YYYY-MM-DD',          // Central calendar day (C3)
  startsAt: ISO | null,       // real instant; null for a holiday
  endsAt: ISO | null,
  title: String,              // 'Beginner Foil', 'Private lesson — 30 min', holiday name
  coach: { id, name } | null,
  locationName: String | null,
  levelName: String | null,   // group only
  durationMinutes: Number | null,
  scheduleId: String | null,  // group: GroupClassSchedule; private: PrivateClassSchedule
  sessionId: String | null,   // group: GroupClassSession; private-booked: PrivateClassSession
  price: Number | null,       // private-open only: the single-session price, from purchaseOptionsFor
                              //   (options[0].unitPrice) — never recomputed
  mine: Boolean,              // parent only: this family's own item (false elsewhere)
  students: [{ id, name }],   // admin + parent (own children) only — ALWAYS [] on /calendar/public
                              //   (as built: an array, not `student` — §9 #1)
  isHoliday: Boolean,         // admin only: a group session on a holiday date (drawn greyed)
  holidayName: String | null,
}
```

Response: `{ from, to, horizonTo, events: CalendarEvent[] (sorted by day, then startsAt), coaches: [{ id, name }] }`.
`from`/`to` are the range actually served (after clipping); `horizonTo` is the last day a public or
parent caller may ever request (`today + PRIVATE_BOOKING_HORIZON_DAYS`), `null` for admin (C6).

### 1.2 `backend/src/utils/dateShapes.js`

- **New** `instantDayString(instant, tz = DEFAULT_TIMEZONE)` → `'YYYY-MM-DD'` of the instant in `tz`
  (moment-timezone, like `combineDayAndTimeInTZ`). C4.

### 1.3 `backend/src/services/privateClassSchedule.service.js` (refactor, no behavior change)

- **New** `openSlotsForRules(rules, fromDay, toDay, now = new Date())` → `[{ scheduleId, day, startDate,
  endDate }]`: for each rule, its weekdays within `max(rule.startDate, fromDay)`…`min(rule.endDate,
  toDay)`, minus holidays (one `holidayService.getHolidaysInRange` for the whole range), minus
  `startDate <= now`, minus held slots (ONE `PrivateClassSession.find` for all rules, `scheduleId ∈
  rules`, `status ∈ SLOT_HOLDING_STATUSES`, `startDate` within the range). **The held set is keyed
  `${scheduleId}:${startDate.getTime()}`** — a booking on rule A must never remove rule B's slot at
  the same instant (C2). This is the existing loop from `listAvailableDates`, moved and re-keyed.
- **Rename** `DEFAULT_AVAILABLE_DAYS = 56` → `PRIVATE_BOOKING_HORIZON_DAYS = 62`, exported (C6). It is
  the picker's default window and the calendar's clip — the one number for "how far ahead can a
  parent book". `MAX_AVAILABLE_DAYS = 120` stays.
- `listAvailableDates(scheduleId, { days })` keeps its validation and window (today … today + days,
  default now 62) and calls `openSlotsForRules([schedule], …)`. Its route tests must pass unchanged
  except any that asserted the old 56-day default (verify first; adjust only that number) — that is
  the refactor's proof.

### 1.4 `backend/src/services/calendar.service.js` (new)

- `parseRange({ from, to }, { allowPast, horizonDays })` — C6 validation (400 messages:
  `"from and to are required (YYYY-MM-DD)"`, `"from must be on or before to"`, `"A calendar range can
  be at most 42 days"`); clips public/parent ranges to today … today + `PRIVATE_BOOKING_HORIZON_DAYS`
  and returns `horizonTo`. A range entirely past the horizon serves an empty `events` with the
  clipped `from`/`to`, not a 400 (the grid's trailing days may legitimately cross the edge).
- `groupEvents({ fromDay, toDay, coachId, now, includePast })` — `GroupClassSession.find({ date:
  { $gte, $lte } })` (day-granular, sentinel field) populated through `scheduleId → classId →
  levelId/locationId` and `scheduleId.coachId`; `day = sentinelDayString(date)`; public/parent keep
  only `startsAt > now` (the same started-session rule `listUpcomingByClass` uses, `session-start-
  time-cutoff-plan.md`); orphaned references (deleted class/level/location/coach) are skipped, the
  same way `groupClassSchedule.service.js` `listPublic` skips them.
- `privateOpenEvents({ fromDay, toDay, coachId, now })` — current rules (`currentRulesFilter`) whose
  coach resolves and has an **active contract** (same gate as `listPublic`), through
  `openSlotsForRules`; `price` from `purchaseOptionsFor(contract, rule.durationMinutes)[0].unitPrice`.
- `privateBookedEvents({ fromDay, toDay, coachId, parentId? })` — confirmed `PrivateClassSession`s in
  range (admin: all; parent: `parentId` only), `day = instantDayString(startDate)`, with `student`.
- `holidayEvents({ fromDay, toDay })` — admin only; one event per covered day.
- `listPublic({ from, to, coachId, type })`, `listForParent(parentId, { … })`, `listForAdmin({ … })`
  compose the above. `type` filters `group` / `private` / `all` (default).
- Parent "mine" (O1): group sessions of the schedules the family's **active subscriptions** point at
  (`Subscription.scheduleId`, status active) **whose `startsAt` is on or after that subscription's
  `currentPeriodStart`**, and the sessions of their **trial classes** (`TrialClass.sessionId`), are
  returned with `mine: true` and `student`; their confirmed private bookings are `private-booked`
  events with `mine: true`. Premium subscriptions (any session of the level) mark the subscription's
  home schedule only — "your usual class"; the rest of the level's sessions still appear as ordinary
  group events. *Why the period-start gate:* `Subscription.status` is only `active`/`cancelled`, and
  "Enroll for next month" (`payment-airtight-plan.md`) creates an ACTIVE subscription whose
  `currentPeriodStart` is in the future — without the gate, this month's sessions would be drawn as
  the family's before the child is enrolled. Same derivation the child page's schedule tab already
  uses (`ParentPortalContext` subscriptions → `scheduleId`), so the two views agree.

### 1.5 Routes (`backend/src/routes/calendar.routes.js`, mounted at `/api/v1/calendar` in `app.js`)

| Endpoint | Guard | Notes |
|---|---|---|
| `GET /calendar/public?from&to&coachId&type` | none | C5: no `student`, no `mine: true`, no booked or holiday events |
| `GET /calendar/mine?from&to&coachId&type` | parent | public events + the family's own (O1) |
| `GET /calendar?from&to&coachId&type` | `ADMIN_ROLES` | everything; may look back (C6) |

Controllers use `next(error)` and `utils/errors.js` factories (duplication-cleanup PR B).

### 1.6 Backend tests

Every suite freezes the clock (`tests/testUtils/privateLessons.js` `freezeDate`, a fixed Monday
morning) — no result may depend on the time of day it runs (`docs/TESTING_STRATEGY.md` → Date rules).

| Suite | Coverage |
|---|---|
| `tests/utils/dateShapes.test.js` (extend — exists, verified 2026-09-25) | `instantDayString`: 11:30 PM Central on Oct 31 is `'2026-10-31'` though it is Nov 1 in UTC; the Nov 1 2026 DST change; a midday instant |
| `tests/routes/privateClassSchedule.routes.test.js` | **unchanged and green** (bar any assertion on the old 56-day default, §1.3) — proves the `openSlotsForRules` extraction changed no behavior; add one case: the picker's default window now reaches day 62 |
| `tests/services/privateClassSchedule.service.test.js` (new — `docs/TESTING_STRATEGY.md` mandates `tests/services/<subject>.service.test.js`, mirroring `src/`) | `openSlotsForRules` over two rules: rule date ranges honored, a holiday removed, a started slot removed, a held slot removed, **a slot held on rule A does not remove rule B's slot at the same instant** (two coaches, Tuesday 16:30), released/cancelled holds do not remove a slot, one held-sessions query for many rules |
| `tests/routes/calendar.routes.test.js` (new) | **Range:** missing from/to, `from > to`, 43 days → 400 with the exact messages; public range clipped to today…horizon with `horizonTo` = today + 62; a range wholly past the horizon → 200 with empty events; admin may look back and gets `horizonTo: null`. **Group:** sessions land on their `day`; a started session today is absent publicly; a holiday-date session is absent publicly and `isHoliday` for admin; orphaned class/coach skipped. **Private open:** a taken slot absent; a rule outside its range or under an inactive contract absent; `price` equals the quote's single-session price for that slot. **Filters:** `coachId` and `type` each narrow correctly. **Privacy:** every public event's keys compared to the allowed set; `student` absent, `mine` false. **Parent:** own subscription's sessions `mine: true` with the child; a subscription whose `currentPeriodStart` is next month marks none of this month's sessions; another family's booking never appears; own private booking appears as `private-booked`. **Admin:** booked lessons carry the student; holidays appear as all-day events. **Guards:** `/calendar/mine` 403 for admin/coach, `/calendar` 403 for parent/coach, `/calendar/public` works logged out. **DST:** a private slot the week of Nov 1 is on the right `day`. **`coaches`:** lists a coach with rules but no events that month. |

### 1.7 Docs (same PR)

`docs/features/public-site.md` (new public endpoint), `docs/features/private-class.md` (routes table;
single-sources row: "Is this slot open?" → `openSlotsForRules`), `docs/features/admin.md` (calendar
endpoint), `docs/TESTING_STRATEGY.md` only if a new testing rule emerges.

---

## §2 PR 2 — Shared component + public page (`feature/calendar-public`)

### 2.1 Types and service

- `lib/types.ts` — `CalendarEventKind`, `CalendarEvent`, `CalendarResponse` (C5 shape, typed against
  the real controller response).
- `lib/services/calendar.ts` — `fetchPublicCalendar`, `fetchMyCalendar`, `fetchAdminCalendar`
  (queries: throw on failure, pair with `useLoadState`).

### 2.2 `lib/calendarView.ts` — the view's date logic, in one place

Pure functions on **calendar-day strings only** (built on `lib/formatDate.ts`'s existing
`CalendarDay` helpers — `addCalendarDays`, `lastDayOfMonth`, `todayInAcademyTZ`): `monthGrid(month)`
→ the 6×7 days to draw (leading/trailing days of the neighboring months), `monthRange(month)` → the
`from`/`to` to request (the grid's first and last day, ≤ 42 days), `parseCalendarQuery(params)` /
`calendarQueryString(state)` (C11 validation and defaults), `groupByDay(events)` (by the server's
`day` string — never from `startsAt`). No `Date` getters on instants anywhere in this file.

### 2.3 `app/components/calendar/` — the shared component

- `CalendarView` — `{ events, coaches, horizonTo, loading, error, onRetry, state, onStateChange,
  renderEvent?, showCoachFilter, typeOptions }`. Toolbar: previous / today / next month (**"next" is
  disabled once the next month's first day is past `horizonTo`; "previous" is disabled below the
  current month unless `horizonTo` is `null`**, i.e. admin), month title, coach `<select>` (from
  `coaches`, "All coaches" first), type pills, month/agenda toggle. Renders
  `MonthGrid` or `AgendaList`. Loading and `LoadError` (with retry) inside the view area — never a
  modal (design-system principle).
- `MonthGrid` — a `role="grid"` 7-column table; each day cell lists its events as buttons/links
  (time + short title); overflow beyond 3 shows "+N more" which switches to that day in the agenda.
  Today's cell marked (`aria-current="date"`); other-month days muted.
- `AgendaList` — day headings (`formatDateOnly`) with each event's time (`formatInstant`), title,
  coach, location, and price for an open private slot (`formatMoney`, backend value).
- `EventChip` — kind-specific styling via tokens: group (navy), private open (crimson accent), booked
  / mine (filled), holiday (muted). A text label always accompanies the color (accessibility — color
  is never the only signal).
- `CalendarView.module.css` — tokens only; responsive default view per C10 (the component picks the
  default view from a `matchMedia` check only when `view` is absent from the URL).

### 2.4 Public page `/calendar`

- New page under `AppShell` (public nav gains **Calendar** between "Private Lessons" and "Log In";
  `PUBLIC_NAV_LINKS` in `app/components/layout/AppShell.tsx`).
- Event links per C8; a logged-in parent goes straight to the wizard, anyone else via `/login?next=`.
- `/private-classes` gains a "View on calendar" link per coach → `/calendar?coach=<id>&type=private`.
- Uses `LoadError` normally (a utility page like `/classes`, not the home page's silent-failure
  exception — `docs/design-system.md`).

### 2.5 Tests (PR 2)

| Suite | Coverage |
|---|---|
| `lib/__tests__/calendarView.test.ts` | `monthGrid` for a month starting on Sunday, on Saturday, February 2027, and October 2026 (DST month) — always 42 days, correct leading/trailing days; `monthRange` never exceeds 42 days; `parseCalendarQuery` rejects bad month/type/view and falls back; `groupByDay` places an event by its `day` string even when `startsAt` is the next UTC day |
| `lib/services/__tests__/calendar.test.ts` | the query contract for all three fetchers (resolve typed data; reject on 500; send `from`/`to`/`coachId`/`type` as query params) |
| `app/components/layout/__tests__/AppShell.test.tsx` | the public-nav assertion (it lists every public link by name) gains **Calendar** → `/calendar` |
| `app/components/calendar/__tests__/CalendarView.test.tsx` | events render on the server's day (fixture with an 11:30 PM Central lesson whose UTC date is the next day); previous/next/today call `onStateChange` with the right month; "next" disabled at `horizonTo`, "previous" disabled below the current month, both enabled when `horizonTo` is `null`; coach select and type pills; month ↔ agenda toggle; "+N more"; empty month message; loading; `LoadError` + retry; today cell has `aria-current="date"`; each event chip has a text label; `userEvent.setup()` throughout |
| `app/calendar/__tests__/page.test.tsx` | MSW round trip: requests `/calendar/public` with the month's range; changing month or coach updates the URL (`router.replace`) and refetches; open-slot link is `/login?next=` + the wizard deep link when logged out and the wizard directly for a parent; group link to book-trial; frozen clock (`jest.useFakeTimers({ now })`) for the default month |
| `app/private-classes/__tests__/page.test.tsx` | the new "View on calendar" link per coach |
| `e2e/calendar.spec.ts` (new) | logged out: filter by coach → only that coach's events; click an open slot → lands on login with `next` = the wizard deep link carrying `slot` and `day`; logged in as parent: click → wizard with the date preselected; axe accessibility scan of `/calendar` (zero-tolerance, like `public-site.spec.ts`); clock pinned with `page.clock` |
| `e2e/fixtures/mock-api.ts` | `/calendar/public` fixture |

### 2.6 Docs (PR 2)

`docs/design-system.md` — move "discovery/calendar page patterns" out of the not-adopted list with a
dated reversal note; add a "Calendar" page pattern (toolbar, two views, URL state, server-placed
days) and the new components to the inventory. `docs/features/public-site.md` — the `/calendar` page.

---

## §3 PR 3 — Parent and admin calendars (`feature/calendar-portal-admin`)

- **Parent `/parent/calendar`** — portal nav gains **Calendar** in the ACADEMY group
  (`ParentPortalShell`); the mobile bottom nav stays 4 items (desktop sidebar only, like Payment
  History). Uses `fetchMyCalendar`; the family's own items are `mine` (filled chip, child's name
  shown); a legend explains the chips.
- **Admin `/admin/calendar`** — admin sidebar **Programs** section gains **Calendar** (first item;
  `NAV_SECTIONS` in `app/admin/layout.tsx`). Uses `fetchAdminCalendar`; shows booked lessons with the
  student, holidays as all-day chips, holiday-date group sessions greyed with the holiday name; may
  navigate into past months. Event links per C8.
- **Tests:** `app/parent/calendar/__tests__/page.test.tsx` (own items marked with the child's name;
  requests `/calendar/mine`; renders inside the real `ParentPortalProvider`), `app/admin/calendar/
  __tests__/page.test.tsx` (student names, holiday chips, past-month navigation allowed, attendance
  link), `app/components/portal/ParentPortalShell` test (new nav item), `e2e/admin-shell.spec.ts`
  (the Programs nav assertion gains Calendar — CLAUDE.md pre-read table: touching the admin nav
  updates this spec), `e2e/calendar.spec.ts` (admin calendar renders a booked lesson and a holiday).
- **Docs:** `docs/features/parent-portal.md` (nav + page inventory), `docs/features/admin.md`
  (Calendar page), `docs/TEST_COVERAGE.md` re-measured.

---

## §4 Files touched (planned)

Backend: `utils/dateShapes.js`; `services/{privateClassSchedule,calendar}.service.js`;
`controllers/calendar.controller.js`; `routes/calendar.routes.js`; `app.js` (mount). No model or
schema change; no migration.
Frontend: `lib/{types,calendarView}.ts`, `lib/services/calendar.ts`, `app/components/calendar/*`,
`app/calendar/page.tsx`, `app/parent/calendar/page.tsx`, `app/admin/calendar/page.tsx`,
`app/components/layout/AppShell.tsx`, `app/components/portal/ParentPortalShell/*`,
`app/admin/layout.tsx`, `app/private-classes/page.tsx`; E2E `calendar.spec.ts`, `admin-shell.spec.ts`,
`fixtures/mock-api.ts`.

---

## §5 Rollout

Three PRs to `develop`, merged in order, each after its own CI is green, then tested by the owner on
staging (the owner's chosen flow since 2026-09-25). No data change. Production only on the owner's
explicit approval to promote `develop` → `main`.

---

## §6 Risks and how the plan handles them

| Risk | Handling |
|---|---|
| Calendar shows a slot the wizard refuses | C2: one `openSlotsForRules`; C6: one `PRIVATE_BOOKING_HORIZON_DAYS` for the picker's window and the calendar's clip; the wizard's own checks still run at purchase (a race shows the existing inline 409 + "Pick another date") |
| One coach's booking hides another coach's same-time slot | §1.3: held set keyed `(scheduleId, startDate)`, matching the unique index; dedicated two-rule test |
| A next-month enrollment drawn as this month's class | §1.4: `mine` gated on `startsAt >= currentPeriodStart`; tested |
| An evening lesson drawn on the wrong day | C3/C4: server-side `day`; the component places by string; tested with an 11:30 PM Central fixture and the DST week |
| Another family's data on a public page | C5: public events never carry `student`; field-by-field key test |
| Slow month with many rules | C2: one holidays read and one held-sessions read per request; C6: ≤ 42 days |
| Stale view after a booking elsewhere | Every navigation refetches; no client caching (`useLoadState` has none by design) |

---

## §7 Owner decisions (DECIDED 2026-09-25)

| # | Question | Decision |
|---|---|---|
| O1 | Parent calendar shows the family's own booked lessons and class times? | **Yes**, with the `currentPeriodStart` gate (§1.4) |
| O2 | Taken private slots on the public calendar: hidden or greyed? | **Hidden** — less noise, and no hint about other families |
| O3 | How far ahead public/parent can browse | **2 months** (revised 2026-09-25 from 3 months, after PR 1 was built), as ONE shared constant `PRIVATE_BOOKING_HORIZON_DAYS = 62` — never shorter than two calendar months from any start day — that is also the wizard picker's default window (C6); the picker grows from 56 to 62 days as a consequence |
| O4 | A coach calendar now or later? | **Later**, as a small follow-up reusing the component |
| O5 | Public calendar shows group classes as well as private lessons? | **Both**, filterable by type; each group schedule has a coach (`GroupClassSchedule.coachId` is required), so the coach filter applies to both |

---

## §8 Review log (2026-09-25)

Reviewed against the tree before any code. Every named file, export, route guard, model field,
test helper and dependency count was confirmed present. Changes folded in:

| # | Finding | Where fixed |
|---|---|---|
| 1 | Calendar horizon (92) vs. the wizard's picker default (56): a day-57–92 slot deep-linked into a wizard that never offered that day | C6, §1.3, §7 O3 — one shared constant |
| 2 | Generalizing `heldTimes` to many rules must key on `(scheduleId, startDate)`, or one coach's booking hides another's same-instant slot | C2, §1.3, §1.6 test, §6 |
| 3 | An active subscription with a future `currentPeriodStart` ("Enroll for next month") would mark this month's sessions as the family's | §1.4, §1.6 test, §6 |
| 4 | C8 overstated what `/private-classes` builds (`slot` only; the wizard reads `day`) | C8 |
| 5 | The frontend had no way to know the horizon, so "next" could not stop at the edge | §1.1 `horizonTo`, §2.3, §2.5 |
| 6 | `AppShell.test.tsx` asserts the exact public nav and was missing from PR 2's test list | §2.5 |
| 7 | Service tests must live in `tests/services/`, not "or in the routes suite" | §1.6 |

---

## §9 As built — PR 1 (backend, 2026-09-25)

Files: `utils/dateShapes.js` (`instantDayString`), `services/privateClassSchedule.service.js`
(`openSlotsForRules`, `PRIVATE_BOOKING_HORIZON_DAYS`, `activeContractsByCoach`),
`services/calendar.service.js`, `controllers/calendar.controller.js`, `routes/calendar.routes.js`,
`app.js`. Tests: `tests/utils/dateShapes.test.js` (+5), `tests/services/privateClassSchedule.service.test.js`
(new, 10), `tests/routes/privateClassSchedule.routes.test.js` (unchanged + 1 horizon case),
`tests/routes/calendar.routes.test.js` (new, 33). Docs: `private-class.md`, `public-site.md`, `admin.md`.

Divergences from §1, each deliberate:

| # | Plan said | Built | Why |
|---|---|---|---|
| 1 | `student: { id, name } \| null` | `students: [{ id, name }]` | Two siblings in the same class share one session; one event per session with both names beats drawing the class twice. PR 2's type follows this. |
| 2 | "mine" gated on `startsAt >= currentPeriodStart` | `session.date >= subscription.currentPeriodStart` | `currentPeriodStart` is a calendar-day sentinel; ADR 009 forbids comparing a sentinel with an instant. Sentinel vs. sentinel gives the same answer. **Known coarseness:** for a future-month registration `currentPeriodStart` is the 1st of that month (ADR 007 D1), not the chosen start day, so a child starting on the 15th reads as "mine" from the 1st. No field records the start day (roster Visits are created for every future session too); acceptable for a display marker. |
| 3 | `from`/`to` = the range actually served, after clipping | `from`/`to` echo the request; `horizonTo` states the clip | A range wholly past the horizon has no valid clipped range to report; echo + `horizonTo` is unambiguous in every case. |
| 4 | Contract gate inline in the calendar | `activeContractsByCoach` extracted, used by `listPublic` and the calendar | One home for "is this coach selling private lessons" (same reason as C2). `currentRulesFilter` is now exported for the calendar. |
| 5 | — | `coachId` (not an ObjectId) and `type` (not all/group/private) → 400 | Explicit messages instead of a Mongoose cast error. |
| 6 | "confirmed `PrivateClassSession`s" | Confirmed only; `pending` is neither open nor drawn as booked | A pending row is a seconds-long hold during the charge. |
| 7 | `coaches` = every coach with an event source in range | Same, computed before the coach/type filters | So picking a coach or a type never empties the coach dropdown. |
| 8 | Horizon 92 days (3 months) | 62 days (2 months) | Owner revised O3 on 2026-09-25 after PR 1 was first built; applied as a second commit on the same PR. |

**Finding for PR 2/3 (not a PR 1 change):** group sessions are generated once, 8 weeks ahead, when a
schedule is created (`groupClassSession.service.js` `generateInitialSessions`), and nothing extends
them. The calendar draws exactly the sessions that exist, so group classes thin out and then vanish
8 weeks after each schedule was created — measured from the schedule's creation, not from today —
while private slots run the full 2 months. This predates the calendar (the trial picker has the same
edge). **Owner decision 2026-09-25:** a weekly cron will add one week at a time so each schedule stays
8 weeks ahead (the CKQ model); tracked in `docs/plans/deployment-launch-plan.md`'s deferred
follow-ups, not built in this plan. It must land before the calendar ships publicly.
