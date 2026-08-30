# Frontend polish + source-of-truth alignment — EXECUTABLE PLAN

**Status:** READY TO EXECUTE (owner-approved, verified against source 2026-08-29)
**Executor:** any Claude model; one PR at a time, no design decisions left open.
**Origin:** an external design review ("FRONTEND_POLISH_BRIEF.md") audited line-by-line against the
real backend and frontend on `develop` @ `d5bd12c`. Several of its fixes were **dropped** because
they contradicted shipped backend decisions or duplicated endpoints that already exist (§0c).
Everything below reflects the corrected plan — do not consult the original brief.

---

## 0a. Owner checklist — what ships, what was dropped

### Shipping (track each PR here)

| ✔ | PR | What you'll see change | Risk |
|---|---|---|---|
| ☐ | **PR 1** | Rounded corners everywhere via tokens (10/16/28px + pill buttons); buttons finally react to hover/keyboard focus/press; all fake-bold 900 text becomes true 700 (13 rules, 9 files, admin included) | Low — token + CSS only |
| ☐ | **PR 2** | Hero / CTA band / footer become inset rounded cards; sections get real breathing room (`72px` rhythm); stats become bordered cards; portal sidebar active item becomes a rounded pill; selected child/level cards get a ✓ badge | Low-med — needs visual pass at 3 widths |
| ☐ | **PR 3** | **Backend** decides each child's enrollment status. Fixes a real bug: a trial from months ago shows "Trial class scheduled" forever today. Dashboard **and** the child-detail page delete their client-side status logic (both derive it today — verified); every "Book a free trial" CTA gated by a server flag | Med — backend + frontend, full test coverage below |
| ☐ | **PR 4** | `/classes`: timezone comes per-schedule from its own location (no more "first location" guess); level filter comes from the admin's Level catalog in catalog order (Beginner→Advanced, includes empty levels); filter becomes a pill row on desktop, stays a dropdown on phones | Med — public endpoint + page + e2e spec |
| ☐ | **PR 5** | Tripwire test that the checkout quote always shows the server's numbers verbatim; written decision that marketing copy stays hardcoded (and which source wins); `Location` gains optional **phone/email** fields (editable on the admin Locations page — you fill the real values there whenever they're set), shown in the footer + a home-page contact block that survives a backend outage | Low |

**Owner inputs needed:** none blocking. After PR 5 merges, fill the real phone/email on the admin
Locations page — until then the fields stay empty and the public site simply doesn't render them
(no fake placeholder ever shows publicly).

### Dropped (decided, not deferred — see §0c for the full reasoning)

| ✘ | Idea from the design brief | Why dropped |
|---|---|---|
| ✘ | New `POST /registrations/quote` endpoint | Already exists as `GET /registrations/preview`; frontend already only formats its output |
| ✘ | `seatsAvailable` / `isFull` on public schedules | Contradicts the shipped premium-mode decision — per-slot seat counts would be misleading |
| ✘ | Backend sends pre-formatted display strings (`statusLine`, `displayTime`, quote `lines[]`) | Backend sends facts; frontend formats. Prose on the API couples presentation to the server |
| ✘ | Load 800/900 font weights | Two more webfont downloads to keep a synthetic bold nobody chose; going to 700 instead |
| ✘ | `SiteContent` model + admin CRUD for marketing copy | Over-engineering for a single-owner site; decision recorded in docs instead (PR 5.2) |
| ✘ | `--shadow-raised` token | Nothing uses it; no speculative tokens |
| ✘ | Rounding the marquee / polaroids; softening the admin shell | All deliberate design choices that stay |
| ✘ | jsdom unit test for the Button focus outline | CSS Modules aren't applied in jsdom; the test would assert nothing (see `docs/TESTING_STRATEGY.md` "What NOT to test") |
| ✘ | Admin setting for the sibling-discount rate (or scrubbing "10%" from UI labels) | Owner decision 2026-08-29: the 10% rate stays a backend constant per ADR 006; labels keep stating it as fixed copy; decision + future path recorded in PR 5.2 |

---

## 0b. Non-negotiable ground rules (from CLAUDE.md + docs/TESTING_STRATEGY.md)

1. One `feature/*` branch per PR, PR into `develop`. Never `git add .` / `git add -A` — stage
   files by name.
2. Read every file before editing it. Pre-reads for this plan: `docs/design-system.md` (all PRs),
   `docs/TESTING_STRATEGY.md` (all PRs — it is the single source of truth for how tests are
   written), `docs/features/parent-portal.md` (PR 3), `docs/features/public-site.md` (PR 4, 5),
   `docs/features/admin.md` (PR 2's admin check).
3. Tests before commit; the owner tests locally before anything is committed; never auto-fix a
   test failure — report summary + root cause + fix plan, then stop.
4. Backend is the source of truth for anything billing/enrollment/status. The frontend **formats,
   never derives**: currency symbols, `HH:mm` → `5:30 PM`, `dayOfWeek` index → weekday word, and
   status-enum → label/color maps are formatting; comparisons, sums, cross-collection scans, and
   eligibility booleans are deriving and belong on the backend.
5. `tsc --noEmit` clean, no `console.log`, no `any` on domain data (code **or** test fixtures), no
   raw hex in `.module.css` (tokens only — design-system anti-pattern 1).
6. If a PR touches a flow covered by `frontend/e2e/*.spec.ts`, update the matching spec **in the
   same PR** — including its `page.route()` mocks in `frontend/e2e/fixtures/mock-api.ts`, which
   are hand-written snapshots of the API shape and will silently keep passing on a stale shape if
   forgotten (TESTING_STRATEGY calls this out explicitly).

### Testing rules that apply to every PR below (from `docs/TESTING_STRATEGY.md` — binding)

- **Mock at the network boundary, never the module boundary.** Backend suites run against a real
  ephemeral Mongo (`mongodb-memory-server`); frontend suites intercept real axios calls with MSW.
  Never `jest.mock('../../lib/services/...')` to stub an HTTP call; never assert "the service
  function was called with X" — assert on rendered results of a real MSW round-trip, and read
  request payloads from the MSW handler (`await request.json()`), not mock call args.
- **New tests drive interaction with `userEvent.setup()`**, not `fireEvent` (existing `fireEvent`
  tests stay as they are; don't retrofit).
- **Typed fixtures**: every frontend fixture satisfies the real type in `frontend/lib/types.ts`;
  backend fixtures are real Mongoose `.create()` calls so the schema validates them.
- **Date rules**: freeze time (`jest.useFakeTimers({ now })`) for anything "today"-relative;
  fixture instants at **midday UTC** (`T12:00:00Z`), never midnight; no `addDays(new Date(), n)`
  time bombs — fixed literals only; run suites as `TZ=UTC npm test`. Backend day-boundary math
  uses `utils/billingDates` helpers, never raw `setHours`/`setDate` on a real instant.
- **Placement/naming**: backend `tests/<layer>/<subject>.<layer>.test.js` mirroring `src/`;
  frontend colocated `__tests__/page.test.tsx` etc. One `describe` per subject; a **named nested
  `describe` for each regression** (e.g. `"stale trial status regression (bug fix)"`) so a
  reviewer sees which bug a test guards.
- **Isolation**: `afterEach` resets MSW handlers and mutable fixture state; backend `afterEach`
  calls `clearTestDB()`. Frontend render helpers wrap the **real** provider tree
  (`AuthProvider`, `ParentPortalProvider`) — never a hand-rolled fake context value.
- **Error-handling contract**: query functions throw (test: `rejects`); `useLoadState` pages
  render `LoadError` with a working retry (test: error handler → assert alert → swap handler to
  success → click "Try again" → content appears); mutations never throw and both branches get
  tested ("shows an inline error ... without crashing").
- **What NOT to test**: no CSS class-name assertions (assert text/ARIA/`href`/`disabled`
  instead — this is what lets a restyle like PR 1/2 break zero existing tests), no snapshot
  tests, no third-party-library behavior, no "mock was called" assertions.

---

## 0c. Dropped ideas — full reasoning (do NOT implement these)

If you find yourself building one of these, stop.

| Dropped | Why |
|---|---|
| `POST /registrations/quote` returning server-formatted `lines[]`/`total` strings | **Already exists as `GET /registrations/preview`** (`registration.routes.js:9`, `previewChargeAmount()` in `registration.service.js`). It returns a full server-computed breakdown incl. `savings`, reusing the exact `calculateChargeAmount()` the real charge uses so preview and charge can never structurally disagree. The register page already consumes it and only does `.toFixed(2)` formatting — verified, no client arithmetic in register, book-trial, or register-private. Server-formatted display strings would move presentation into the backend: worse, not better. |
| `seatsAvailable` / `isFull` on `GET /group-class-schedules/public` | Contradicts a shipped, documented decision: in premium mode (the live default) `listPublic()` deliberately omits availability because premium students attend any session of their level — a per-slot "seats left" would be misleading (`groupClassSchedule.service.js:105-116`). The existing conditional `availability` field stays exactly as-is. |
| `displayTime` (server-formatted "5:30 PM – 6:30 PM") on public schedules | `startTime`/`endTime` are wall-clock strings at the location; rendering them is formatting. `lib/formatTime.ts` stays the formatter. Backend sends data, not prose. |
| Server-sent `statusLine: "Tuesday 5:30 PM…"` prose on the parent dashboard | Same reason. The backend sends the enrollment **facts** (PR 3); the frontend formats them. |
| Adding 800/900 weights to the font loader | Two more webfont downloads to preserve a synthetic bold nobody chose. Weights go down to 700 instead (PR 1). |
| A `SiteContent` model + admin CRUD for marketing copy | Over-engineering for a single-owner site whose copy was captured from the owner's own WP site on 2026-08-29. Decision recorded as docs instead (PR 5.2); revisit only if the owner asks to edit copy without a deploy. |
| `--shadow-raised` token | Nothing in this plan uses it. Don't add speculative tokens. |
| Rounding `.marquee` or `.testimonialPolaroid`; softening the admin shell | All deliberate: the marquee is an infinite ticker, a polaroid has square corners, and the admin back-office intentionally contrasts with the marketing/portal surfaces (`docs/features/admin.md`). |
| A jsdom unit test asserting the Button `:focus-visible` outline | CSS Modules styles are not applied in jsdom; the test would assert nothing. The guards are the pre-merge greps + the e2e accessibility scans + the visual check. |
| An admin setting for the sibling-discount rate; scrubbing "10%" from UI labels | Owner decision 2026-08-29: the 10% rate is part of ADR 006's family rule and stays a backend constant in `calculateChargeAmount`. Every dollar amount and every discount `reason` string already arrives from the backend (the backend's own reason text states "10%" too); the four frontend labels stating "10%" (`parent/subscriptions/page.tsx:285,306`, `admin/subscriptions/page.tsx:334`, `parent/register/page.tsx:558`) are fixed copy of a fixed rule, not a drift risk worth plumbing today. If the rate ever becomes configurable: `Setting` gains `siblingDiscountPercent` (the `registrationFee` precedent), `calculateChargeAmount` reads it, API responses/reason strings carry it, and the labels switch to rendering it — backend first, labels second. PR 5.2 records this in the docs. |

---

# PR 1 — tokens, Button interaction states, synthetic-bold cleanup

Branch: `feature/polish-tokens-and-button`. Mechanical, wide, zero behavior change. Ship first so
later diffs read cleanly.

### 1.1 `docs/design-system.md` — update the decision record FIRST

The Tokens paragraph (currently line ~30) states radius `--radius-sm`/`--radius-md` are both `0`
(square corners matching the WP site). This PR reverses that deliberate decision — update the
paragraph in the same PR, recording: *owner requested a softer rounded treatment on 2026-08-29,
loosely aligned to the WP site rather than matched to it; scale is 10/16/28/pill.* Also document
the new tokens added below (`--radius-lg`, `--radius-pill`, `--color-accent-hover`,
`--color-border-soft`, `--space-7/8`, the new `--shadow-card` value).

### 1.2 `frontend/app/globals.css`

Read the whole file first (it carries load-bearing comments). Change **only** these tokens:

```css
/* Radius — rounded treatment, 2026-08-29. Replaces the square-corner WP match;
   see docs/design-system.md. */
--radius-sm: 10px;    /* was 0 — inputs, selects, small controls */
--radius-md: 16px;    /* was 0 — cards, flow sections, panels */
--radius-lg: 28px;    /* new — inset full-bleed bands: hero, CTA band, footer top */
--radius-pill: 999px; /* new — buttons, chips, status pills */

/* Elevation — tight contact shadow + wide soft ambient, so a card reads as
   lifted without the 1px border doing all the work. */
--shadow-card: 0 1px 2px rgba(14, 27, 42, 0.04),
               0 12px 28px -20px rgba(14, 27, 42, 0.30);

/* Hairline divider for rules INSIDE a card — --color-border stays the
   structural border between a surface and the page. */
--color-border-soft: #edeae4;

/* Darkened --color-accent for hover states (Button .accent). */
--color-accent-hover: #8e1220;

/* Spacing scale extended for marketing section rhythm. */
--space-7: 48px;
--space-8: 72px;
```

Nothing else in `globals.css` changes — palette, type scale, shell tokens, the h1–h6 block, and
the `overflow-x: hidden` body rule (it has its own verified-bug comment) all stay untouched.

### 1.3 `frontend/app/components/ui/Button/Button.module.css`

Verified current state: variants + sizes only — **no** hover/focus-visible/active states exist;
keyboard focus falls back to the UA outline (invisible on navy). This is an accessibility defect,
not just polish. The component has both `:disabled` and a `.disabled` class (for `as="a"`
anchors) — every state selector must exclude **both**.

```css
.button {
  border-radius: var(--radius-pill);   /* replaces var(--radius-sm) */
  transition: background 0.14s ease, border-color 0.14s ease, color 0.14s ease;
}

.button:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.primary:hover:not(:disabled):not(.disabled)   { background: var(--color-navy-deep); }
.accent:hover:not(:disabled):not(.disabled)    { background: var(--color-accent-hover); }
.secondary:hover:not(:disabled):not(.disabled) { background: var(--color-bg); }
.ghost:hover:not(:disabled):not(.disabled)     { background: var(--color-bg); color: var(--color-ink); }
.danger:hover:not(:disabled):not(.disabled)    { background: var(--color-error-bg); }

.button:active:not(:disabled):not(.disabled)   { transform: translateY(1px); }
```

No raw hex — `--color-accent-hover` comes from 1.2.

### 1.4 Kill every `font-weight: 900`

`app/layout.tsx` loads Big Shoulders Text at **500/600/700** and Inter at **400/500/600/700** —
900 does not exist in either face, so every `font-weight: 900` renders a synthetic (blurry,
platform-inconsistent) bold. Verified full list as of 2026-08-29 — **13 rules across 9 files**,
including admin surfaces (admin is in scope for *this* fix because it's a font-loading bug, not a
styling choice):

| File | Lines |
|---|---|
| `frontend/app/components/marketing/marketing.module.css` | 73, 327, 396, 681 |
| `frontend/app/components/admin/admin.module.css` | 23, 367 |
| `frontend/app/components/portal/flow/flow.module.css` | 48, 380 |
| `frontend/app/components/ui/shared.module.css` | 8 |
| `frontend/app/components/portal/ParentPortalShell/ParentPortalShell.module.css` | 15 |
| `frontend/app/parent/dashboard/dashboard.module.css` | 10 |
| `frontend/app/parent/child/[id]/child-detail.module.css` | 24 |
| `frontend/app/admin/layout.module.css` | 41 |

Re-run `grep -rn "font-weight: 900" frontend/` first — the list may have grown. Replace each with
`700`. Do not touch the font loader.

### 1.5 Testing & checks (CSS-only PR)

Per TESTING_STRATEGY's "What NOT to test", **no new unit tests** — CSS values aren't assertable in
jsdom, and the existing suites assert text/ARIA/attributes precisely so a restyle like this breaks
nothing. The guards are:

- [ ] `grep -rn "font-weight: 900" frontend/` → zero hits.
- [ ] No **new** raw hex in any touched `.module.css` (tokens only; `--color-accent-hover` and
      `--color-border-soft` are defined in `globals.css`).
- [ ] `TZ=UTC npm test` green in `frontend/` (zero failures expected — if a test breaks on a
      CSS-only change, that test was asserting a class name and the change should be reported, not
      the test silently "fixed").
- [ ] `npx tsc --noEmit` clean.
- [ ] `npm run test:e2e` green — `public-site.spec.ts`'s axe scans are zero-tolerance on `/` and
      ratcheted on the admin dashboard; the new focus outline and hover colors must not introduce a
      new contrast finding (crimson outline on `--color-bg` / white is fine; verify the scan agrees).
- [ ] Visual sanity: buttons are pills everywhere, hover/focus/press visibly work, disabled buttons
      (real `<button disabled>` **and** `as="a"` `.disabled`) show no hover reaction.

---

# PR 2 — radius adoption, spacing rhythm, selected-state checkmark

Branch: `feature/polish-radius-adoption`. Pre-reads: `docs/design-system.md`,
`docs/features/admin.md`. Needs a visual pass at 1440px / 1024px / 390px before handing to the
owner.

### 2.1 `frontend/app/components/marketing/marketing.module.css`

(Note: `.programCard` and `.levelCardPhoto` live **here**, not in `Card.module.css` — the original
brief pointed at the wrong file. `Card.module.css` needs no edit; it already uses
`var(--radius-md)`.)

- `.heroBand`, `.ctaBand` — `border-radius: var(--radius-lg)`, **inset**: these are `.fullBleed`
  (100vw re-centered) bands, and a radius flush against the viewport edge reads as an accident.
  Adjust each band's full-bleed sizing to leave a `var(--space-4)` gutter per side (e.g.
  `width: calc(100vw - 2 * var(--space-4))` with the matching re-center margin). Do not change
  `.fullBleed` itself — other sections (the marquee) must stay edge-to-edge.
- `.siteFooter` — `border-radius: var(--radius-lg) var(--radius-lg) 0 0`, same inset; bottom
  corners stay square (last thing on the page).
- `.marquee` — untouched, stays full-bleed square.
- `.eyebrow`, `.heroChip`, `.programDuration` — `border-radius: var(--radius-pill)`.
- Section rhythm — the single biggest "cleaner" change: `padding: var(--space-6) 0` on
  `.introSection`, `.facilityBand`, `.stepsRow`, and the `margin-top/bottom: var(--space-6)` on
  the bands, all become `var(--space-8)`.
- `.statItem` — becomes a bordered card: `background: var(--color-white); border: 1px solid
  var(--color-border-soft); border-radius: var(--radius-md); padding: var(--space-5) var(--space-4);`.
- `.testimonialPolaroid` — untouched (square by design; tilt + tape carry the styling).
- `.programCard` — add `overflow: hidden`: `.levelCardPhoto` uses a negative-margin photo bleed,
  and without clipping the square photo corner pokes past the card's new 16px radius. Read the
  existing comments around lines 353–440 first — the clip-path shape there is deliberate; verify
  visually that `overflow: hidden` doesn't fight it.

### 2.2 `frontend/app/components/portal/PortalLayout/portal-shell.module.css`

Active nav item goes from 3px-left-border to a rounded pill:

- `.sidebarLink` — add `margin: 0 var(--space-2); border-radius: 12px;` and remove the
  `border-left: 3px solid transparent` (line ~61); keep the existing padding and hover.
- `.sidebarLinkActive` — remove the `border-left-color` rule; keep background/color/weight.
- The `@media (max-width: 1024px)` icon-rail block already switches to `border-right` — keep that
  indicator (a pill has no room in a 64px rail) and **reset the new `margin` and `border-radius`
  to 0** inside that block.

### 2.3 `frontend/app/components/ui/shared.module.css`

`.availabilityPill` and `.chip` currently hardcode `border-radius: 20px` — change both to
`var(--radius-pill)`. `.formInput`/`.formSelect` inherit the new `--radius-sm` with no edit.

### 2.4 `frontend/app/components/portal/flow/flow.module.css` (+ checkmark, audit finding B9)

- `.stepConnector` — add `border-radius: 2px`.
- `.section`, `.confirmCard`, `.summary`, `.childCard`, `.pill` — inherit tokens, no edits, no new
  one-off radii. Internal `.summaryRow` dividers stay as-is (translucent white on navy).
- **Selected-state checkmark:** `.childCardSelected` / `.pillSelected` mark selection with
  border-color + a faint wash only — easy to miss. Add a small crimson `✓` badge in the top-right
  corner of the selected state via a CSS pseudo-element (`::after`, `content: '✓'`, absolutely
  positioned; parent gets `position: relative` if it lacks one). CSS only — **no markup or aria
  changes**: verified `ChildPickerCards`, `LevelPickerCards`, and `PillRow` already render real
  `<button role="radio" aria-checked>` inside `role="radiogroup"`, with existing tests asserting
  it (`flow.test.tsx:143-144, 207-208`). Those tests must still pass untouched.

### 2.5 Admin containment check

The admin shell keeps its square, dense back-office treatment — that contrast is deliberate
(`docs/features/admin.md`). After the token change, click through the admin pages: if any admin
card/table/dialog now reads rounded-and-wrong, override radius to `0` locally in the admin module
CSS with a one-line comment naming the deliberate contrast. Do not "fix" admin by softening it.

### 2.6 Testing & checks (CSS-only PR)

Same regime as PR 1 — no new unit tests; existing ARIA-based flow tests are the behavioral guard.

- [ ] Visual pass at 1440 / 1024 / 390: hero + CTA band + footer insets (the 100vw-radius combo is
      the most likely breakage), program-card photo clipping, sidebar pill at desktop + icon rail
      at ≤1024px, ✓ badge on the register wizard's child/level/date pickers.
- [ ] `TZ=UTC npm test` (frontend) green untouched; `npx tsc --noEmit` clean.
- [ ] `npm run test:e2e` fully green — `parent-register.spec.ts` exercises the real wizard DOM the
      checkmark touches; `public-site.spec.ts` + `admin-shell.spec.ts` run their axe scans (the ✓
      pseudo-element is decorative CSS content — confirm the scan raises nothing new).
- [ ] No new raw hex; no `font-weight: 900` reintroduced.

---

# PR 3 — enrollment status becomes a backend fact (audit finding B1 — the blocker)

Branch: `feature/enrollment-status-backend`. Pre-reads: `docs/features/parent-portal.md`,
`docs/TESTING_STRATEGY.md`. This is where the frontend currently *derives* business truth, in
**two** pages (verified 2026-08-29, not assumed): `app/parent/dashboard/page.tsx:16-29`
cross-references the portal context's `subscriptions` array for `status === 'active'`, falls back
to scanning `trialClasses`, and derives a `notEnrolled` flag that gates the "Book a free trial"
CTA — and `app/parent/child/[id]/page.tsx:56-63` repeats the same derivation for its status pill
("Enrolled"/"Trial booked"/"Not enrolled"), its "Not Enrolled" card, and its own CTA gate
(line 129).

It also contains a real bug the original brief missed: `TrialClass` has **no status field** (one
trial ever per student, unique-indexed on `studentId`) and `hasTrial` is a bare existence check —
so a student whose trial happened months ago still shows **"Trial class scheduled"** forever.
Only the backend can distinguish upcoming from past (it owns the session date and the Central-tz
"today" — `docs/plans/timezone-consistency-plan.md`).

### 3.1 Backend — extend `GET /students/mine`

In `student.service.js` `listMine()`, attach to each returned student:

```js
enrollment: {
  status: 'enrolled' | 'trial_scheduled' | 'trial_completed' | 'not_enrolled',
  canBookTrial: Boolean,   // the CTA gate — frontend must NOT infer it from status
  schedule: { dayOfWeek, startTime, endTime } | null,  // only when status === 'enrolled'
}
```

Derivation (server-side, batched — **no per-student queries**):

1. One `Subscription.find({ studentId: { $in: ids }, status: 'active' })` populated with the
   schedule's `dayOfWeek/startTime/endTime`. A hit → `enrolled` + `schedule`.
2. One `TrialClass.find({ studentId: { $in: ids } })` populated with `sessionId`'s date. A trial
   whose session date is on-or-after today **in Central time** — compare using the tz-aware
   helpers in `utils/billingDates` (`todayDateOnly()` against the session's date-only value; see
   TESTING_STRATEGY's real-instant vs date-only-sentinel distinction), never raw
   `new Date()`/`setHours` math — → `trial_scheduled`; earlier → `trial_completed`.
3. Neither → `not_enrolled`.
4. `canBookTrial` = no active subscription **and** no `TrialClass` row exists. This mirrors the
   one-trial-ever rule already enforced by `trialClass.service.js`'s pre-check + the unique index —
   reference that rule in a comment rather than restating it, so the two can't drift.

Handle orphaned references the way `listPublic()` does — a trial/subscription whose populated
schedule or session is missing degrades (treat as absent), never crashes
(`docs/plans/orphaned-coach-reference-fix-plan.md` pattern).

### 3.2 Frontend

- `lib/types.ts` — add the `enrollment` object to `Student`. No `any`, no optional-and-guessed:
  the field is always present on `/students/mine` responses.
- `app/parent/dashboard/page.tsx` — **delete** `statusLine()`, the local `DAY_LABELS`, the
  `subscriptions.find(...)` / `trialClasses.some(...)` scans, and the derived `notEnrolled`.
  Render from `student.enrollment`:
  - status → label map (presentation, stays client-side): `enrolled` →
    `` `Enrolled — ${DAY_LABELS[schedule.dayOfWeek]} ${formatTime(start)}-${formatTime(end)}` ``,
    `trial_scheduled` → "Trial class scheduled", `trial_completed` → "Trial completed",
    `not_enrolled` → "Not enrolled". Import `DAY_LABELS` from `lib/constants` (it already exists —
    `ScheduleTable` uses it) and keep `formatTime`. Index-to-weekday and HH:mm-to-clock are
    formatting; the *choice of status* is the backend's.
  - CTA renders iff `student.enrollment.canBookTrial` — nothing else.
- `app/parent/child/[id]/page.tsx` — same treatment as the dashboard for the *derived* parts:
  the status pill label/class, the "Not Enrolled" card, and the "Book a Free Trial" CTA gate all
  switch to `student.enrollment` (`status` for the pill via the same presentation map,
  `canBookTrial` for the CTA — delete the local `activeSubscription`/`hasTrial` scans that feed
  them). What **stays untouched**: the Trial Class card's date, the Active Registration card's
  schedule/next-billing details, and the Schedule tab's premium session list — those render
  fields of subscription/trial rows the backend returned, which is display, not derivation. (The
  page still reads `subscriptions`/`trialClasses` from context for those cards; only the
  status/CTA decisions move to `enrollment`.)
- Dedup only, no behavior change: `app/parent/child/[id]/page.tsx:14` and
  `app/parent/subscriptions/page.tsx:15` each define their own local `DAY_LABELS` — switch both to
  the `lib/constants` import. The subscriptions page's rendering is otherwise legitimate (it
  displays fields of the subscription rows themselves) and stays untouched.

### 3.3 Tests (write per TESTING_STRATEGY — layers named exactly)

**Backend service layer** — `backend/tests/services/student.service.test.js` (extend or create,
mirroring `src/`; real `mongodb-memory-server`, fixtures via real `.create()` so Mongoose
validates them, `afterEach` → `clearTestDB()`):

- All four statuses, seeded through real `Subscription` / `TrialClass` / `GroupClassSession`
  documents — never `jest.mock('../models/...')`.
- The Central-tz boundary: freeze time with `jest.useFakeTimers({ now })` at a **midday-UTC**
  instant (`T12:00:00Z` — the strategy's anti-flake rule) and seed a session dated "today" in
  Central → expect `trial_scheduled`; dated yesterday → `trial_completed`. Fixed literal dates
  only, no `addDays(new Date(), n)` time bombs. Put the stale-trial case under a named nested
  `describe('stale "Trial class scheduled" regression (bug fix)')`.
- `canBookTrial`: false when a `TrialClass` exists even with no active subscription
  (trial-completed-but-unenrolled), false when enrolled, true only when neither exists.
- Batching: two students, assert one result set is correct for both (and keep the implementation
  to the two batched queries — no per-student loop).
- Orphaned refs: a subscription whose schedule was deleted / a trial whose session was deleted →
  degrades to the no-hit branch, never throws.

**Backend route-integration** — `backend/tests/routes/student.routes.test.js`: Supertest
round-trip on `GET /students/mine` asserting the `enrollment` shape arrives per student, and that
another parent's students still 40x per the existing auth tests.

**Frontend** — `app/parent/dashboard/__tests__/page.test.tsx` (existing file):

- Update MSW handlers to serve the new `/students/mine` shape — handlers, not
  `jest.mock('.../services/parent')` (explicitly banned). Fixtures must type-check against the
  updated `Student` type.
- Keep rendering through the real `ParentPortalProvider` (the existing render helper) so the
  context-contract change is exercised, not faked.
- New cases: each of the four statuses renders its label (assert on text, not class names);
  `trial_completed` shows "Trial completed" — named regression `describe`; the CTA appears iff
  `canBookTrial: true`, including the previously-impossible combination
  `{ status: 'trial_completed', canBookTrial: false }` → no CTA.
- New interactions (if any) use `userEvent.setup()`.
- Error contract unchanged: the provider already `allSettled`s its fetches; keep the existing
  failed-students-fetch test passing.

**Frontend** — `app/parent/child/[id]/__tests__/page.test.tsx` (existing file): same MSW-shape
update; status pill renders from `enrollment.status` for all four statuses (assert text, and the
`trial_completed` case under the same named regression `describe`); the "Not Enrolled" card + CTA
appear iff `canBookTrial`; the Trial Class / Active Registration / premium Schedule cards still
render from the subscription/trial fixtures exactly as before (regression guard that moving the
status logic didn't break the display cards).

**Run:** `TZ=UTC npm test` in `backend/` and `frontend/`; `npx tsc --noEmit`. E2E: no spec mocks
`/students/mine` with enrollment-dependent assertions today, but grep
`frontend/e2e/fixtures/mock-api.ts` for the endpoint and update its mock to the new shape in this
PR (stale-mock drift is the exact gap TESTING_STRATEGY warns e2e cannot self-detect).

### 3.4 Docs

Update `docs/features/parent-portal.md` (context/response contract). No schema change — this is a
response shape, so `DATABASE_SCHEMA_DOCUMENTATION.md` is untouched.

---

# PR 4 — public schedule timezone + catalog-ordered filter (findings B2 + B4, classes-page A5)

Branch: `feature/classes-page-catalog`. Pre-read: `docs/features/public-site.md`. One PR because
all three changes land in `GET /group-class-schedules/public` + `app/classes/page.tsx`.

### 4.1 Backend — `groupClassSchedule.service.js` `listPublic()`

Add one field to the projection: `timezone: schedule.classId.locationId.timezone`. The location is
already populated on that query — zero extra DB work. `Location.timezone` exists, defaults to
Central, and is IANA-validated at write time; this is its **first real consumer**, so update the
"Not wired into any date computation yet" comment on `location.model.js` (and the matching D8 note
in `docs/plans/timezone-consistency-plan.md`) to point here.

**Nothing else changes.** The conditional `availability` field keeps its exact premium-mode
behavior (see §0c). No `displayTime`, no seat counts.

### 4.2 Frontend — `app/classes/page.tsx`

- **Timezone (B2 — blocker):** delete `const timezone = data?.locations[0]?.timezone;` — the
  guess-from-first-location. Compute the distinct set of `timezone` values across the returned
  rows: exactly one → keep the page-level "All times shown in {tz}." line; more than one → drop
  the page line and append the row's timezone to each row's detail line in `ScheduleTable` instead.
  Keep `fetchPublicLocations()` in the loader — the footer still needs it; it just no longer
  supplies a timezone.
- **Filter options (B4):** the current `useMemo` derives options from whatever rows arrived —
  levels with no schedules vanish and `.sort()` presents the progression backwards
  (Advanced/Beginner/Intermediate). Replace: add `fetchPublicLevels()` (already exists in
  `lib/services/catalog.ts`; backend returns `{name, order, monthlyFee}` sorted by the admin's
  `order`) to the page loader and build the options from it, in backend order. Filtering the
  already-loaded rows client-side stays exactly as-is — that part is presentation.
  Known edge, accept and comment it: a level with schedules but no configured `Price` is excluded
  from `/levels/public` (deliberate backend rule), so its rows show only under "All levels" —
  that's a config error surfacing, not a bug to code around.
  Degradation decision (explicit, not improvised): if the levels fetch fails but schedules load,
  render the table with the filter collapsed to "All levels" only — never a `LoadError` for a
  progressive-enhancement control, never a crash.
- **Filter control (A5):** at >600px, a pill-toggle row ("All levels" + one pill per level) using
  the same `role="radiogroup"` / `role="radio"` + `aria-checked` button pattern the flow kit's
  `PillRow` uses (don't import the portal component into a marketing page — replicate the pattern
  with marketing/shared styles, pills using `var(--radius-pill)`). At ≤600px keep the existing
  `<select>` (a pill row wraps badly on phones). Both drive the same `levelFilter` state.
- **Table framing (A5):** `ScheduleTable`'s per-day groups render in `Card`s already; inside each
  card, switch row separators from `--color-border` to `--color-border-soft` and bump row padding
  from `var(--space-3) 0` to `var(--space-4) var(--space-5)`. While in there, move
  `ScheduleTable`'s inline `style={{...}}` blocks into `shared.module.css` classes (the design
  system's no-inline-styles direction) — mechanical, same values.

### 4.3 Tests (per TESTING_STRATEGY)

**Backend** — `backend/tests/services/groupClassSchedule.service.test.js` (existing suite):
`listPublic()` returns `timezone` per row sourced from that schedule's own location — seed two
locations with different IANA zones and assert each row carries its own; the orphaned-reference
filter still drops broken rows. Route-integration: extend the existing `/public` test with the
new field. Real `mongodb-memory-server`, `clearTestDB()` — as ever.

**Frontend** — `app/classes/__tests__/page.test.tsx` (extend; MSW handlers for
`/group-class-schedules/public`, `/levels/public`, `/locations/public` — never service mocks;
fixtures type-check against the updated `PublicGroupClassSchedule` + `PublicLevel`):

- Options come from the levels response in catalog order (seed levels whose alphabetical and
  catalog orders differ — e.g. Advanced order 3, Beginner order 1 — and assert render order), and
  include a level with zero schedule rows.
- Single distinct timezone → page-level line with that zone; two zones → no page line, per-row
  zone text. (Named `describe` for the first-location-guess regression.)
- Pill row and `<select>` drive the same filter state — click a pill with `userEvent`, assert the
  filtered rows; assert `aria-checked` moves (ARIA, not class names).
- Levels-fetch failure (MSW 500 on `/levels/public` only) → schedules still render, filter shows
  "All levels" only, no `LoadError`, no crash. Schedules-fetch failure → existing `LoadError` +
  retry behavior stays (assert the retry round-trip per the error-contract recipe: error handler →
  alert → swap to success handler → click "Try again" → rows appear).

**E2E (same PR — mandatory per the pre-read table):** update `frontend/e2e/public-site.spec.ts` +
`fixtures/mock-api.ts`: add `timezone` to the mocked `/public` schedules and a mocked
`/levels/public`; drive the new pill filter in the spec (it's on `/classes`, which the spec
already loads); the axe scan on `/classes` is zero-tolerance — the pill row's real-button
radiogroup must scan clean.

**Run:** `TZ=UTC npm test` both repos, `npx tsc --noEmit`, `npm run test:e2e`.

### 4.4 Docs

Update `docs/features/public-site.md`'s endpoint table with the new `timezone` field and the
filter's data source.

---

# PR 5 — close-outs: quote-guard test, marketing-copy decision, outage fallback (B3/B5/B8)

Branch: `feature/polish-closeouts`. Small: two tests + docs + one contained schema addition
(`Location.phone`/`Location.email`, 5.3). No owner input blocks it — the owner fills the real
contact values on the admin Locations page after it ships.

### 5.1 Quote-path tripwire — no code change to the quote path itself

Verified: the register wizard's summary is fed exclusively by `GET /registrations/preview`;
book-trial has no money lines; register-private renders the slot's server-sent `sessionPrice`.
Two guards so it stays that way:

- Add one regression test to `app/parent/register/__tests__/page.test.tsx` under a named
  `describe('server-verbatim quote regression guard')`: the MSW `/registrations/preview` handler
  returns distinctive, non-round values (e.g. `totalChargeAmount: 123.47`,
  `siblingDiscountAmount: 11.03`, `registrationFeeCharged: 87.21`) and the test asserts the
  rendered summary shows exactly `$123.47` / `$11.03` / `$87.21` — any client-side arithmetic
  creeping in breaks it immediately. MSW handler, not a service mock; assert rendered text, not
  calls.
- Add a line to `docs/design-system.md`'s anti-patterns (or the `OrderSummary` header comment):
  *every money line in an `OrderSummary` comes from a backend response field; a new quote line
  means a new backend field, never a computation.*

### 5.2 Marketing-copy decision — stays static, and the decision gets written down

**Decision: keep `STATS` / `PROGRAMS` / hero copy / `VALUES_ROW_*` hardcoded** (the owner's own
WP-site copy, captured 2026-08-29; testimonials are already DB-driven via the `Testimonial`
model). A content model + admin CRUD is over-engineering for a single-owner site — revisit only
if the owner asks to edit copy without a deploy.

Execute: ensure each constant block carries a source comment (`owner-authored, captured from
friscofencingacademy.com 2026-08-29` — most already do; add where missing), and add a short
section to `docs/features/public-site.md`: `PROGRAMS` is **intentionally decoupled** from the
`Level` catalog; for anything transactional (pricing, registration, level names in flows) the
catalog wins; the marketing card copy is prose that may lag it, and updating it is a deploy.

**Also record the sibling-discount-rate decision** (owner, 2026-08-29 — full reasoning in §0c):
add a short addendum to `docs/decisions/006-sibling-discount-family-rule.md`: *the 10% rate is a
fixed backend constant of this rule; the frontend labels that state "10%" are fixed copy of it,
kept deliberately (no admin setting, no label scrub); if the rate ever becomes configurable, the
sequence is `Setting.siblingDiscountPercent` → `calculateChargeAmount` → API responses/reason
strings → labels render the server value — never labels first.* No code changes for this item.

### 5.3 Public contact info on `Location` + a home page that survives a backend outage

**Owner decision 2026-08-29: public phone/email live on the `Location` collection** — it's
location data, the backend stays the source of truth, and the owner edits it in the admin
Locations page rather than via a deploy. Nothing in the repo or DB carries a public phone/email
today; the fields ship **empty** and the public site renders them only when set — a placeholder
belongs in the admin form's input hints, never in public output.

**Backend** (pre-read `DATABASE_SCHEMA_DOCUMENTATION.md` — this is a schema change):

- `location.model.js` — two optional fields: `phone: { type: String, default: '', trim: true }`
  and `email: { type: String, default: '', trim: true }`. Email gets a minimal loud-failure
  validator on non-empty values (simple `\S+@\S+\.\S+` shape — same philosophy as the field's
  neighbor `timezone`: a data-entry typo fails at write time instead of silently shipping a
  broken `mailto:`). Phone stays free-form (display-only; formats vary) — no validator.
- `location.service.js` `listPublic()` — add `phone` and `email` to the projection (the
  authenticated list/getById return full documents already; no change there).
- Update `DATABASE_SCHEMA_DOCUMENTATION.md` with the two fields.

**Admin** (pre-read `docs/features/admin.md`):

- `app/admin/locations/page.tsx` — add optional Phone and Email inputs to the existing dialog
  (form state, `EMPTY_FORM`, create/update payloads, edit-prefill). **Not required fields** — the
  name/address required-check stays as-is. Give each input a `placeholder` hint (e.g.
  `(XXX) XXX-XXXX` / `contact@example.com`) — this is the "placeholder" the owner fills in later;
  it lives in the form UI only.

**Public site:**

- `lib/types.ts` — `Location` and `PublicLocation` gain `phone: string; email: string;`.
- `SiteFooter.tsx` — per location, render `tel:` / `mailto:` links when the value is non-empty;
  render nothing for an empty string (no dead links, no fake placeholders).
- Home page (`app/page.tsx`) — one contact block after the hero with two layers:
  - **Static, fetch-independent, always renders:** academy name + the existing YouTube link + a
    "call or email us to book" line — so a total backend outage still shows a way to reach the
    academy instead of hero-marquee-nothing.
  - **Fetch-driven enrichment:** when the locations fetch succeeded, the block also shows each
    location's phone/email/address. Accepted, explicit limit: in a full outage the DB-driven
    contact details are unavailable by construction — that's the cost of keeping contact info in
    the DB, chosen deliberately over hardcoding a copy that could drift from the admin's values
    (the exact contradiction risk finding B5 warns about).
- The silent-section rule for failed marketing fetches stays (the documented exception to
  LoadError-always). No error-reporting system in this PR; `console.*` in page code is barred by
  Hard Rule 9 — reporting stays out, noted here so it isn't "discovered" later.

### 5.4 Tests (per TESTING_STRATEGY)

- 5.1's tripwire test (above).
- **Backend** — `backend/tests/services/location.service.test.js` (extend): create/update persist
  `phone`/`email`; the email validator rejects a malformed non-empty value and accepts `''`;
  `listPublic()` includes both fields. Real `mongodb-memory-server` + `clearTestDB()`; route
  suite: extend the existing `/locations/public` test with the new projection fields.
- **Admin frontend** — `app/admin/locations/__tests__/page.test.tsx` (extend): fill the new
  Phone/Email inputs with `userEvent`, assert the payload the MSW handler received
  (`await request.json()` capture — never mock-call args) carries them on create and update; and
  that submitting with both empty still succeeds (they're optional).
- **Public frontend** — home/footer tests: locations fixture **with** phone/email → `tel:`/
  `mailto:` links render with correct `href`s (ARIA/attribute assertions); fixture with empty
  strings → no dead links rendered. Outage case: MSW error handlers on `/locations/public` **and**
  `/testimonials/public` → the static contact block's text still renders and the page doesn't
  crash (the error-contract "without crashing" phrasing). All fixtures type-check against the
  updated `Location`/`PublicLocation`.
- `npm run test:e2e` — `public-site.spec.ts` loads `/`; add phone/email to the mocked
  `/locations/public` in `fixtures/mock-api.ts` (stale-mock rule), assert the block renders, axe
  scan stays clean. `admin-shell.spec.ts` is unaffected (its CRUD round-trip is Levels, not
  Locations) — verify, don't assume.
- `TZ=UTC npm test` both repos; `npx tsc --noEmit`.

---

## Sequencing & dependency notes

1. **PR 1** (tokens/Button/weights) — no dependencies. Everything later inherits it.
2. **PR 2** (radius adoption) — needs PR 1's tokens.
3. **PR 3** (enrollment backend) — independent of PR 1/2; can run in parallel with them.
4. **PR 4** (classes page) — needs PR 1's tokens (pill filter) but not PR 2/3.
5. **PR 5** (close-outs) — last; nothing blocks it. After it merges, the owner fills the real
   phone/email on the admin Locations page.

Every PR individually: `TZ=UTC npm test` green in both repos, `npx tsc --noEmit` clean,
`npm run test:e2e` green, owner local-tests before commit, explicit file staging, feature branch →
`develop`.
