# Parent portal

Shell structure, context contract, and page inventory for the parent-facing portal (`frontend/app/parent/`). Shell CSS/tokens live in `docs/design-system.md`'s "Portal shell" section — this doc covers the shell's data contract and per-page behavior.

## Shell (`app/parent/layout.tsx`)

Role-gated (parent only — mirrors the admin layout's gate: redirects to `/` for any other role or a logged-out visitor) and wraps every `/parent/*` page in `<ParentPortalProvider><ParentPortalShell>{children}</ParentPortalShell></ParentPortalProvider>`. No parent page wraps itself in `<ProtectedRoute>`/`<AppShell>` any more — `AppShell` now serves coach + logged-out visitors only.

## `ParentPortalContext` (`app/context/ParentPortalContext.tsx`)

Fetches the household's `students`, `subscriptions` (`/registrations/mine`), `trialClasses` (`/trial-classes/mine`), and (CKQ parity Phase 4) `privateEnrollments` (`/private-class-enrollments/mine`) via `Promise.allSettled` — **not** `Promise.all` — so a temporary billing/trial/private-class outage never blocks the children list from rendering, and a students-only household isn't held hostage by a flaky secondary endpoint.

Contract: `{ students, subscriptions, trialClasses, privateEnrollments, loading, error, reload }`.

- `error` is set **only** when the PRIMARY fetch (`students`) fails. An empty household (zero children, no fetch failure) is explicitly NOT an error.
- A failed secondary fetch (subscriptions, trial classes, or private enrollments) silently degrades to `[]` — the rest of the portal still renders with whatever data did load.
- `reload()` re-runs all four fetches (used after a mutation like adding a child).

Every `/parent/*` page that needs household data consumes this context — **no page-level fetching** for students/subscriptions/trials any more (the book-trial/register/payment-method pages still do their own local fetches for page-specific option lists like classes/schedules/prices, which are out of this context's scope).

## `ParentPortalShell` (`app/components/portal/ParentPortalShell/`)

Wraps the generic `PortalLayout` with parent-specific nav groups:

- **HOME** — Dashboard (`/parent/dashboard`).
- **CHILDREN** — custom content: one row per student (initial-letter avatar with a deterministic per-child palette from `lib/childPalette.ts`, 4 navy/crimson-harmonious gradient pairs assigned by index) showing a status line — `Enrolled` / `Trial booked` / `Not enrolled` — plus a "+ Add child" row. Each child row links to `/parent/child/[id]` (Phase 5); "+ Add child" is a button that opens `AddChildModal` in place (Phase 5) rather than navigating.
- **ACADEMY** — Book Trial, Register, Private Lessons (`/private-classes`, CKQ parity Phase 4), Billing (`/parent/subscriptions`), Payment Method.

Header: "Welcome back, {firstName}" + today's date, plus a children-count chip. Mobile bottom nav (≤768px, 4 items): Home, Children, Register, Billing.

## `PortalLayout` (`app/components/portal/PortalLayout/`)

The reusable shell primitive: `{ navGroups, header?, bottomNavItems, children }`. Renders a **light** sidebar (white background, `--color-border` divider, ink text, crimson active-left-border — never the admin shell's dark treatment), a right area (optional sticky header + main), and a fixed bottom tab bar on mobile. Active state = longest-href-prefix match of the current pathname, computed independently for the sidebar item set and the bottom-nav item set (they aren't always the same items). Breakpoints: ≥1025px full 220px sidebar; 769–1024px icon-only 64px sidebar; ≤768px sidebar hidden, bottom nav shown.

## Flow kit (`app/components/portal/flow/`, Phase 4)

Shared building blocks for the multi-step registration/trial wizards:

- **`FlowMain`** — `{ crumbs, eyebrow?, title, steps?, current, summary?, singleColumn?, children }`. Renders an inline breadcrumb (Home → flow name), title block, an optional `FlowStepper`, and a two-column layout (content + sticky summary rail) that collapses to a single centered column when `singleColumn` is set (used for the terminal confirmation step, where a summary rail no longer makes sense).
- **`FlowStepper`** — numbered circles; crimson-filled + active label for the current step, a checkmark for completed steps, plain outline + number for upcoming ones.
- **`FlowSection`** — a bordered card with an optional title, used to group one logical piece of a step's form.
- **`ChildPickerCards`** — `{ students, selectedId, onSelect }`, a `radiogroup` of radio-cards (palette avatar + name + skill level), one per household child.
- **`PillRow<T>`** — `{ items, selectedKey, onSelect, getKey, getLabel, getSub?, ariaLabel }`, a `radiogroup` of pill buttons (generic, crimson-accented selected state — CKQ-style picker, adapted to Frisco's tokens and `ChildPickerCards`' own `radiogroup`/`radio` a11y pattern rather than CKQ's `aria-pressed` buttons). Currently used only by Book a Trial's session picker.
- **`OrderSummary`** — `{ lines, cta?, ctaDisabled?, ctaLoading?, onCta?, note? }`. **The advance/submit button for a step lives here, never duplicated elsewhere on the page** — every wizard step's CTA sits in the sticky summary rail so the reviewer's eye never has to leave the summary to know what happens next. The one exception is Register's own "Who" step (below) — selecting a child auto-advances immediately, since there's nothing else to configure on that step and a rail click would just be an extra step for its own sake.
- **`FlowConfirmation`** — the terminal success panel: a check icon, title/subtitle, a small label/value detail grid, and next-step links.

## Wizards

Both wizards keep local step state (`useState(0)`) — no URL-driven step routing — so back-navigation via the in-page "Back" button preserves every prior selection for free (nothing is refetched or reset on a step change). Both support a `?child=<studentId>` deep link (used by the dashboard's per-child "Book a free trial" CTA and the child detail page): Book a Trial preselects the "Who" step's child; Register's own auto-advance means its deep link skips "Who" entirely and lands straight on "Level".

**Payment-critical guarantee**: both wizards call the exact same Phase-0 mutation services (`bookTrialClass({ studentId, sessionId })` → `POST /trial-classes`; `createRegistration({ studentId, scheduleId })` → `POST /registrations`) with the exact same payload shape as the pre-wizard single-page forms — only the surrounding UI changed. The existing payload-assertion tests were adapted (not weakened) to drive the new step UI before asserting the same `expect(postPayload).toEqual(...)`.

### Book a Trial (`/parent/book-trial`) — 3 steps

`Who` (`ChildPickerCards` from `ParentPortalContext`) → `Pick a Class` (class → session — **no separate schedule step**: picking a class fetches every upcoming session across ALL of that class's schedules via `GET /group-class-sessions/by-class/:classId`, next 30 days, today-inclusive, server-filtered — the parent picks a session directly via `PillRow`, not a recurring weekly schedule first) → `Confirmation` (`FlowConfirmation` with child + session date/time, links to Dashboard/Register). The summary rail's CTA reads "Continue" on step 0 and "Book Trial Class" on step 1. Register (below) still has an explicit schedule step — payload/wire-shape unchanged — but its copy now reflects premium billing (see below).

### Register (`/parent/register`) — 3 steps

`Who` (`ChildPickerCards` — selecting a child **auto-advances** straight to Level; no separate "Continue" click, and a `?child=` deep link lands here directly too) → `Level` (`LevelPickerCards` — level cards, same visual language as `ChildPickerCards`; a level's price shows on its card. Picking one reveals a `PillRow` of that level's available times, the same session-picker component Book-a-Trial uses, with a live `GET /registrations/preview` sibling-discount preview fetched as soon as both are picked — read-only, best-effort: a failed preview is swallowed silently, never a step error, since the real charge is always correctly computed server-side at submit time regardless. Once a time is picked, a **Payment Method** section appears in the same step, no separate "Review & Pay" step: an existing card shows as "Card on file: X ending in Y — this card will be charged"; no card on file shows the same `PaymentMethodCardForm` `/parent/payment-method` uses, inline — saving it immediately unblocks the summary rail's "Register & Pay" CTA without leaving the page, and it's the exact same `PaymentMethod` record the standalone page reads) → `Done` (`FlowConfirmation` with the charged amount, and the real applied sibling discount if any — from the actual charge response, not the preview).

**Premium copy** (docs/plans/premium-registration-and-attendance-plan.md) — the time-pill section's slot is just the parent's usual/home time; they can attend any of the level's scheduled sessions once enrolled. The summary rail's line is labeled "Usual time," not "Schedule." `createRegistration({ studentId, scheduleId })`'s payload is byte-identical to before — the flag only ever changes what `Subscription.isPremium` gets set to server-side, never the request shape.

**Prorated first-month billing** (docs/plans/prorated-first-month-billing-plan.md, admin-gated via `Setting.prorationEnabled`, off by default) — when enabled, the Level step's preview and its summary rail both show the real class-day breakdown ("X of Y class days remain this month → $Z/day → $W due today") plus the date full-price billing starts, all read verbatim from `GET /registrations/preview` — the wizard never computes any of this itself. `Done`'s confirmation shows the same breakdown from the real charge response. None of this UI renders when proration is off.

**Start-date window** (owner-directed refinement, 2026-08-27, addendum §8 of the plan doc above) — the "Choose your start date" picker no longer lists every upcoming session. It shows only sessions from today through 14 days out, capped earlier at the last calendar day of the current month if 14 days would spill into next month (pure calendar-day filtering of the already-fetched real session list — never a re-derivation of anything financial). Below the picker, a single "Enroll for next month" button anchors to the earliest real session dated in the next calendar month (found in the same fetched list, never invented or separately fetched — the backend's session endpoint keeps its existing default window; this button simply reaches for a date already present, and shows an honest "not posted yet" disabled state on the rare occasion it isn't) and displays that session's real date/time read-only underneath. Clicking it selects that session exactly the way a pill click does — same `scheduleId`/`startDate` payload, same preview/submit flow. The math needs no special-casing (verified against `computeProration()`): anchoring to a month's true first class day always yields `remainingClassDays === totalClassDays`, i.e. the full monthly price, from the existing backend logic. The wizard's only frontend judgment call is cosmetic — whether to show the "X of Y class days" sentence or a plain full-price line — decided by which button was clicked, never by a computed amount.

### Payment Method (`/parent/payment-method`)

Its Stripe `CardElement` form is `app/components/portal/PaymentMethodCardForm.tsx` — extracted out to a shared component so this page and the register wizard's inline "add a card at checkout" step both call the exact same save path (`stripe.createPaymentMethod` → `POST /payment-methods`), never two copies of the same Stripe integration. This page's own logic (loading the saved card, the "Update card" toggle) is otherwise unchanged; it just renders the shared form instead of a local copy.

### Register for Private Lessons (`/parent/register-private`, CKQ parity Phase 4) — 3 steps

`Who` (`ChildPickerCards`, honors `?child=`) → `Review & Pay` (slot summary — coach, day/time/duration, `$X per session`, first session date, all server values from the public availability payload; `?slot=` preselects; the same saved-card guard as the group wizard; consent line "You'll be charged **$X after each completed session** to your saved card") → `Done` (`FlowConfirmation`). Submits `createPrivateEnrollment({ studentId, scheduleId })`; a 409 slot-taken (another parent won the race) renders the backend message with a "Refresh available slots" action that refetches and returns to step 0. No upfront charge is ever made here — private lessons are billed per completed session, triggered by the coach marking attendance (see `docs/features/private-class.md`).

## `AddChildModal` (`app/components/portal/AddChildModal/`, Phase 5)

Extracted from the children page's former inline form into a reusable dialog: `{ onClose, onSuccess }`. `onClose` fires on Cancel/backdrop-click with no side effect; `onSuccess` fires only after a successful `createStudent` mutation, and every caller's `onSuccess` handler closes the modal and calls `ParentPortalContext.reload()`. Client-side validates that both names are non-blank before submitting; a mutation failure shows the backend message inline and keeps the dialog open. Used by three call sites: the children page's "Add Child" button, `ParentPortalShell`'s sidebar "+ Add child" row, and the dashboard's empty-state "Add Child" CTA — all three previously navigated to `/parent/children`'s inline form and now open the modal in place instead.

## Child detail page (`app/parent/child/[id]/page.tsx`, Phase 5)

Reads the child straight out of `ParentPortalContext` (`students.find(s => s._id === id)`) — **no new fetch**. If the id doesn't match any of the household's children (once loading has finished), shows an inline "Child not found." message with a link back to `/parent/children`. Header: palette avatar (same index-based palette as the sidebar), name, skill level (if set), and a status pill (`Enrolled` / `Trial booked` / `Not enrolled`).

Two tabs, driven by a `?tab=` URL param (real `<Link>`s with `role="tab"`/`aria-selected`, not client-only state) validated against a fixed `Set(['overview', 'schedule'])` — any other or missing value falls back to `overview`:

- **Overview** — a trial-status card (if a trial is booked and there's no active subscription yet), an active-registration card (schedule days/times, next billing date, and a "Manage / Cancel in Billing" link into `/parent/subscriptions` as the cancel entry point — cancellation itself still only happens on the Billing page), or a "Not Enrolled" card with a Book-a-Trial CTA when neither applies.
- **Schedule** — display-only. For a non-premium subscription (schedule-based mode only — see docs/plans/premium-registration-and-attendance-plan.md), shows the **recurring day/time pattern** from `scheduleId` alone ("Every Wednesday, 16:00 - 17:00") — still no enumerated session-date list, per the original plan's instruction. For a **premium** subscription (`isPremium: true`, the live default), the page does its own page-specific fetch of every `GroupClassSchedule` (same exception this doc already carries for book-trial/register/payment-method), filters to the ones sharing the subscription's `scheduleId.classId`, and lists all of them — "attend any of these scheduled sessions," not just the one it's anchored to.

Sidebar child rows and dashboard child cards both now link here instead of to `/parent/children`.

## Page inventory

| Page | Behavior |
|---|---|
| `/parent/dashboard` | Three states, all driven by `ParentPortalContext` (no page-level fetching): loading spinner; `students.length === 0` → onboarding stepper (Account Created ✓ → Add Your Child, current, CTA opens `AddChildModal` → Book a Trial, upcoming); else a 2-column grid — left: one at-a-glance card per child (palette avatar + name linking to `/parent/child/[id]`, status line, and a "Book a free trial →" CTA only on not-yet-enrolled children), right: a Quick Actions card (Book Trial / Register / Payment Method). |
| `/parent/child/[id]` | New in Phase 5 — see "Child detail page" above. |
| `/parent/children` | Consumes `students` from context (no own fetch); each row's name links to `/parent/child/[id]`; "Add Child" opens `AddChildModal` (Phase 5) instead of an inline form. |
| `/parent/book-trial` | Rebuilt as a 3-step wizard (Phase 4) — see "Wizards" above. Payload byte-identical to the pre-wizard form. |
| `/parent/register` | Rebuilt as a 3-step wizard (Phase 4, later collapsed from 4 steps — see "Register" above). Payment-critical: payload/sequencing byte-identical to the pre-wizard form. |
| `/parent/subscriptions` | Group-subscription logic unchanged (unwrapped from `ProtectedRoute`/`AppShell` in Phase 3). CKQ parity Phase 4 adds a **Private Lessons** section below the group table: per enrollment — coach, slot line, `$X/hr`, status, a recent-charges list (date · amount · Paid/Failed chip), and a Cancel button (confirm dialog: "All upcoming sessions will be removed and the weekly slot released. Completed sessions already charged are unaffected."). Fetches `privateEnrollments` independently of `ParentPortalContext` (its own `fetchMyPrivateEnrollments`/loading state) so a cancel can reload just this section. A muted "Prorated first month" chip shows next to Last Charge when `Subscription.firstChargeProrated` is true (docs/plans/prorated-first-month-billing-plan.md). |
| `/parent/payment-method` | Unchanged logic (Stripe CardElement flow). Only unwrapped from `ProtectedRoute`/`AppShell` (Phase 3). |
| `/private-classes` | New (CKQ parity Phase 4) — public (no auth) browse page; see `docs/features/private-class.md`. |
| `/parent/register-private` | New (CKQ parity Phase 4) — 3-step wizard; see "Register for Private Lessons" above. |
