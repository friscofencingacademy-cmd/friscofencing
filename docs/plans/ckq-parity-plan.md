# CKQ Parity Plan — Staging Email Block · Email Design System · Admin Subscriptions · Private Classes

**Status: APPROVED FOR AUTONOMOUS EXECUTION (2026-08-21)**
Owner directive: all four phases execute in ONE uninterrupted run (no per-phase check-ins), same
model as the shipped `ckq-ui-adoption-plan.md`. The executing agent follows §0 (Execution
Protocol) exactly.

This plan copies four proven features from the Chess Kings & Queens (CKQ) platform — the same
academy business model — adapted to Frisco Fencing's smaller, cleaner codebase. It was produced
from a full code-level audit of both codebases. Where CKQ has known bugs, this plan **fixes them
instead of copying them** (each is flagged inline as `CKQ-BUG-FIX`).

CKQ reference files (read-only, for verbatim porting — they live on this machine):

| What | CKQ path |
|---|---|
| Email layout renderer (the design system) | `C:\Users\mages\chesskqwebsite\backend\backend-2.0\src\email\layout.js` |
| Plain-text twin renderer | `C:\Users\mages\chesskqwebsite\backend\backend-2.0\src\email\text.js` |
| Design tokens | `C:\Users\mages\chesskqwebsite\backend\backend-2.0\src\email\tokens.js` |
| Template registry (structure reference) | `C:\Users\mages\chesskqwebsite\backend\backend-2.0\src\email\templates.js` |
| Subject/preheader interpolation | `C:\Users\mages\chesskqwebsite\backend\backend-2.0\src\email\interpolate.js` |
| Session pricing util | `C:\Users\mages\chesskqwebsite\backend\backend-2.0\src\utils\pricing.js` |
| Offline preview script | `C:\Users\mages\chesskqwebsite\backend\backend-2.0\scripts\preview-emails.js` |

---

## 0. EXECUTION PROTOCOL (binding on the executing agent)

1. **Pre-reads (mandatory, before any edit):** `CLAUDE.md`, `docs/TESTING_STRATEGY.md`,
   `docs/design-system.md`, `docs/features/admin.md`, `docs/features/parent-portal.md`,
   `docs/decisions/001-in-house-subscription-billing.md`, `DATABASE_SCHEMA_DOCUMENTATION.md`,
   plus every existing file this plan tells you to modify. Read every file before editing it.
2. **Branch first:** `git checkout develop && git pull origin develop && git checkout -b feature/ckq-parity`.
   Verify with `git branch --show-current` before the first edit and before every commit.
3. **Order:** Phase 1 → 2 → 3 → 4. Later phases depend on earlier ones (3 and 4 send emails
   through the Phase 2 system, gated by Phase 1).
4. **Per-phase gate (all must pass before the phase's commit):**
   - `cd backend && TZ=UTC npm test` — all green
   - `cd frontend && TZ=UTC npm test` — all green
   - `cd frontend && npx tsc --noEmit` — 0 errors
   - `cd frontend && npm run build` — clean
   - No `console.log` in production code (backend `logger`-less codebase uses `console.error`
     in the established mail pattern only — match existing convention). No `any` on domain data.
5. **Commit per phase**, files staged explicitly by name (never `git add .`). Message format:
   `feat(<area>): <summary> [ckq-parity phase N]`. **Never push, never open a PR** — the owner
   tests locally after the run and ships via the normal flow.
6. **Test failures in code you wrote this run:** diagnose and fix properly, then re-run.
   **Pre-existing tests:** you may update a pre-existing test ONLY when this plan changes the
   behavior it asserts (each such case is listed in the phase spec). Never delete, skip, or
   weaken a test to get green.
7. **New tests follow `docs/TESTING_STRATEGY.md` to the letter:** mock at the network boundary
   only (mongodb-memory-server backend / MSW frontend), real Stripe TEST-mode calls on charge
   paths, `userEvent` not `fireEvent`, fixture instants at midday UTC, no now-relative dates,
   typed fixtures, cancel-then-charge race coverage for every new charging path.
8. **Docs are part of the run** (final commit, may be combined with Phase 4's): update every doc
   listed in §6.
9. **Final report-back format:** per phase — files created/modified, suite/test counts
   (backend + frontend, real numbers from the runs), gates passed, anything deviating from this
   plan and why. Plus the exact commands the owner should run to test locally.

---

## 1. LOCKED DECISIONS (do not reopen)

| # | Decision |
|---|---|
| D1 | Staging email gate = new `APP_ENV` env var, **fail-closed** (`!== 'production'` blocks). `NODE_ENV` cannot be used — Vercel sets `production` on Preview deployments too. |
| D2 | Email templates are **V2-only from day one** — no `EMAIL_V2` flag, no legacy fallback (Frisco is greenfield; CKQ's flag exists only because it had 16 legacy templates). |
| D3 | Templates emit **blocks, never HTML** (CKQ's core email invariant). Brand change = one edit in `tokens.js`. |
| D4 | Private-class registration: **public browse page, login-required registration** through the parent-portal flow kit (needs child + saved card — same guard as the group wizard). No guest checkout. |
| D5 | Marking a private session **`attended` charges immediately** (one step — Frisco has no CKQ notes/tags requirement). A confirm dialog shows the exact amount first. |
| D6 | Admin schedule change is **same-level only** → always price-neutral (Frisco prices are per level). No delta charge, no proration, sibling discount untouched. Level change (promotion) is a future feature. |
| D7 | `agreedHourlyRate` is **pinned at enrollment and immutable** (CKQ's consent-record invariant). Contract rate changes affect only future enrollments. |
| D8 | Cancellations: **no refunds, no proration, ever** — group cancel stays end-of-period (existing `cancelAtPeriodEnd` model); private cancel frees slots + deletes future (money-free) sessions. |
| D9 | New env vars: `APP_ENV`, `ADMIN_EMAIL` (CC target, default `friscofencingacademy@gmail.com`), `LOGO_URL` (optional — email header falls back to a styled text wordmark). |
| D10 | Private-class charges are **outside** the sibling-discount system (CKQ parity). `calculateChargeAmount.service.js` is not touched by this plan. |
| D11 | Coach compensation rate is stored on the contract (audit/future payroll) but gets **no payout UI** in this plan. |
| D12 | Attendance marking on group sessions is unchanged. The private-class attendance→charge trigger is a **separate route/service** — it does not touch `groupClassSession.service.js`. |

---

## 2. PHASE 1 — Block outbound email in staging

**Problem:** staging (Vercel Preview + `friscofencing-staging` DB) sends real email to real
parents through the same Brevo SMTP creds as production. Zero gating exists today.

**Design (CKQ's, adapted):** CKQ hard-blocks at the provider with Brevo API's
`X-Sib-Sandbox: drop` header behind a fail-closed `APP_ENV !== 'production'` predicate, keeping
full render/dispatch parity in staging. Frisco uses Nodemailer SMTP, so the equivalent is:
**render everything, then skip the transport send** when blocked — same single choke point, same
fail-closed predicate.

### 2.1 `backend/src/services/mail.service.js` (modify)

- Add, next to `FROM_ADDRESS` (same read-at-call-time style — the test suite uses
  `jest.resetModules()`, so never capture env at module load):

```js
// Staging email gate (fail-closed): anything other than APP_ENV=production blocks real
// SMTP sends. Ethereal (no SMTP_HOST) is exempt — it never delivers to real inboxes and
// is the local-dev preview loop. Mirrors CKQ's X-Sib-Sandbox design.
const isEmailBlocked = () =>
  Boolean(process.env.SMTP_HOST) && process.env.APP_ENV !== 'production';
```

- In `sendMailSafely`, after the message is fully built (so staging still exercises rendering)
  and before `transporter.sendMail`:

```js
if (isEmailBlocked()) {
  console.warn(`[mail] blocked (APP_ENV=${process.env.APP_ENV || 'unset'}): to=${to}, subject="${subject}"`);
  return { blocked: true };
}
```

- Contract preserved: `sendMailSafely` still never throws, still returns falsy-equivalent
  semantics for callers (all call sites ignore the return value or treat truthy as sent —
  verify each of the three call sites; `{ blocked: true }` is truthy, which is correct: a
  deliberate block is not a failure).

### 2.2 Config/docs

- `backend/.env.example`: add `APP_ENV` with a comment block explaining production vs staging
  vs unset (blocked by default), plus `ADMIN_EMAIL` and `LOGO_URL` (used from Phase 2 on).
- `docs/plans/deployment-launch-plan.md`: add `APP_ENV` (backend, Production scope only =
  `production`; Preview scope = `staging`), `ADMIN_EMAIL`, `LOGO_URL` rows to the §4a env table,
  and a note in the follow-ups that the owner must set them in Vercel.

### 2.3 Tests (extend `backend/tests/services/mail.service.test.js`)

New nested describe `staging email gate`:
1. `SMTP_HOST` set + `APP_ENV` unset → `sendMail` NOT called, returns `{ blocked: true }`.
2. `SMTP_HOST` set + `APP_ENV='staging'` → blocked.
3. `SMTP_HOST` set + `APP_ENV='production'` → `sendMail` called (real send path).
4. No `SMTP_HOST` (Ethereal) + `APP_ENV` unset → NOT blocked (local dev unaffected).
5. Block happens after render: assert the warn log contains the real subject.

---

## 3. PHASE 2 — CKQ email design system + all templates

**Problem:** the three existing emails are bare, unescaped `<p>` string concatenation — no
layout, no brand, no escaping, no CC support. Cancellation sends nothing at all.

**Design:** port CKQ's block-based V2 system. Three strictly separated layers: a template
registry that composes **blocks** from data (pure functions, no HTML), one layout file that owns
every visual decision, and a text renderer that derives the plain-text twin **from the same
blocks** so HTML and text can never drift.

### 3.1 New files — `backend/src/email/`

**`tokens.js`** — Frisco brand (frozen literal hex; email clients support no CSS vars/webfonts):

```js
const C = {
  bg: '#FAF9F6', white: '#ffffff', panel: '#F4F2EC',
  border: '#E2E0DB', borderSoft: '#EEECE6',
  ink: '#1B1A17', soft: '#44423C', muted: '#6B6B63', muted2: '#9C9A90',
  gold: '#C8A000', goldHover: '#A08000', goldSoft: '#FBF6E3', goldBorder: '#EDDFA6',
  goldInk: '#8A6D00',            // legible gold TEXT on goldSoft — raw gold fails contrast
  green: '#0e9f6e', greenSoft: '#f0fdf4', greenBorder: '#bbf7d0',
  red: '#dc2626', redSoft: '#fef2f2', redBorder: '#fecaca',
  blue: '#1565c0', blueSoft: '#eff6ff', blueBorder: '#dbeafe',
};
const FONT = "'Saira',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const LOGO_URL = () => process.env.LOGO_URL || null;   // null → text wordmark in the header
const ORG = () => ({
  name: 'Frisco Fencing Academy',
  fromEmail: process.env.MAIL_FROM_ADDRESS || 'noreply@friscofencing.local',
  supportEmail: process.env.ADMIN_EMAIL || 'friscofencingacademy@gmail.com',
  portalUrl: (process.env.FRONTEND_URL || 'http://localhost:3000') + '/parent/dashboard',
});
```

(`LOGO_URL`/`ORG` as functions — read env at call time, same testability rule as Phase 1.)

**`layout.js`** — port from the CKQ reference file, mechanical changes only:
- Swap every hex through the token map above; class prefix `ckq-` → `ffa-`; `<title>` and
  alt text → Frisco Fencing Academy.
- Header: if `LOGO_URL()` render the `<img width="172">` exactly as CKQ; else render a text
  wordmark: `FRISCO <span gold>FENCING</span>` — 20px, weight 800, letter-spacing .08em,
  uppercase, ink + gold.
- Keep verbatim: the 600px table skeleton, hidden preheader, light-only color-scheme metas, the
  single 3-rule mobile media query, bulletproof buttons (radius on both `<td>` and `<a>`;
  variants `primary` → gold bg/ink text, `green`, `danger`, `ghost` → 1.5px gold border), the
  three footer modes (transactional/operational — drop `marketing`, nothing sends it), and
  `escapeHtml` applied to every plain-label field.
- Block vocabulary to keep: `spacer, divider, eyebrow, heading, subheading, text, badge, button,
  link, card, detailList, steps, breakdown`. Drop CKQ's digest-only blocks
  (`statStrip, sectionHead, rowList, notice`) and `orderSummary`/`table`/`image`.
- `card` tone map: `gold → [goldSoft, goldBorder]`, `green`, `red`, `blue`, `neutral → [panel,
  border]`. Eyebrow/badge tone colors follow the same names.
- **`breakdown` block, simplified for flat monthly pricing** (Frisco has no per-session
  group math): uppercase label `PAYMENT BREAKDOWN`, bordered 14px-radius table with rows —
  `Monthly fee $X` → optional green `Sibling discount (10%) −$Y` → hairline → `Total charged`
  at 22px/800. Input shape: `{ monthlyFee, siblingDiscountAmount|null, total }`.

**`text.js`** — port from the CKQ reference: walk the same blocks; eyebrow → UPPERCASE,
button/link → `label: href`, detailList → `Key: value` lines, breakdown → indented lines ending
`TOTAL CHARGED`, blocks joined by blank lines, footer with support email + portal URL + org name.

**`interpolate.js`** — port verbatim ( `{{token}}` substitution for subject/preheader only;
unresolved tokens stay visible and are `console.warn`ed).

**`dates.js`** — small, no new dependency: `dateFull(date)` → `Monday, Aug 25, 2026`,
`timeOfDay('HH:mm')` → `4:00 PM`, both via `Intl.DateTimeFormat`/string parsing with
`timeZone: 'America/Chicago'` (matches `Location.timezone` default). These are the ONLY
date/time formatters emails may use.

**`index.js`** — `renderEmail(key, data)` → `{ subject, preheader, html, text }` (build blocks →
interpolate subject/preheader → renderHtml/renderText), `hasTemplate`, `listTemplates`. Pure —
data in, strings out.

**`sampleData.js`** — one realistic `SAMPLE_DATA[key]` entry per template (feeds the preview
script and tests).

**`templates.js`** — 9 templates. Every `build(data)` is pure; all money/dates arrive
pre-computed in `data` (backend-source-of-truth applies to emails too).

| Key | Subject | Content spec |
|---|---|---|
| `trialConfirmation` | `{{studentName}}'s free trial class is confirmed` | green `⚔` badge → eyebrow "Free trial class" (green) → H1 `{student}'s trial is confirmed` → intro → green card `detailList` [Student, Class, Level, Coach, When (`Day · date · time` via dates.js), Location] → muted sm "Need a different time? Just reply to this email and we'll reschedule." |
| `registrationConfirmation` | `{{studentName}} is enrolled — Frisco Fencing Academy` | green `✓` badge → eyebrow "Enrollment confirmed" → H1 `{student} is enrolled` → intro naming class + coach → green card `detailList` [Class, Level, Coach, Schedule (`Day, time`), Location] → `breakdown` → `steps` "What happens next" [first class date, monthly auto-renewal on saved card, manage anytime in portal] → primary portal button. |
| `renewalReceipt` | `Payment receipt — {{studentName}}'s {{monthLabel}} classes` | eyebrow "Payment receipt" (neutral) → H1 "Your renewal receipt" → text naming student + class → neutral card `detailList` [Student, Class, Billing period] → `breakdown` → muted sm "Charged to your saved card." → ghost portal button. |
| `cancellationConfirmation` | `Your cancellation is confirmed — Frisco Fencing Academy` | NO badge — eyebrow "Cancellation confirmed" (**blue** — acknowledgement, not celebration) → H1 → "We've received the cancellation request for {student}'s classes. No further action is needed." → blue card `detailList` [Student, Class, Schedule, **Classes continue through** {endDate}] → muted sm no-proration/no-refund note → muted sm "Changed your mind? Reactivate any time before the end date from your portal." → ghost portal button. |
| `reactivationConfirmation` | `{{studentName}}'s classes will continue` | green badge `✓` → eyebrow "Subscription reactivated" → text "the pending cancellation has been removed; renewals continue as normal — nothing was charged today" → green card [Student, Class, Schedule, Next billing date] → ghost portal button. |
| `scheduleChangeConfirmation` | `{{studentName}}'s class schedule has been updated` | green badge → eyebrow "Schedule updated" → card `detailList` [Previous class, Previous schedule, divider, New class, New schedule, New coach] → text "Your monthly fee is unchanged." → ghost portal button. |
| `privateClassConfirmation` | `{{studentName}}'s private lessons with Coach {{coachName}} are confirmed` | green badge `⚔` → eyebrow "Private lessons confirmed" → gold card `detailList` [Student, Coach, Slot (`Day · time · N min`), Rate (`$X/hr — $Y per session`), First session] → `steps` [sessions recur weekly, **you're charged $Y after each completed session** on the saved card, cancel anytime from the portal] → ghost portal button. |
| `privateClassSessionReceipt` | `Private lesson receipt — {{studentName}}` | eyebrow "Session receipt" (neutral) → neutral card `detailList` [Student, Coach, Session date, Duration, **Amount charged**] → muted sm "Charged to your saved card after the completed session." |
| `privateClassPaymentFailed` | `Action needed — payment failed for {{studentName}}'s private lesson` | red badge `!` → eyebrow "Payment failed" (red) → red card `detailList` [Student, Session date, Amount] → text "We couldn't charge your saved card. Please update your payment method — the coach can retry the charge afterward." → primary button "Update payment method" → `{portalUrl}/../payment-method` link target passed in data. |
| `privateClassCancellation` | `Private lessons cancelled — {{studentName}}` | eyebrow "Cancellation confirmed" (blue) → blue card `detailList` [Student, Coach, Slot] → text "All upcoming sessions have been removed. Completed sessions already charged are unaffected. The weekly slot is now released." |

(That's 10 keys listed — `reactivationConfirmation` included; count = 10.)

### 3.2 Rewire `backend/src/services/mail.service.js`

- `sendMailSafely({ to, cc, subject, text, html })` — add optional `cc` (array; filter falsy;
  pass to nodemailer). Keep never-throw + Phase 1 gate.
- Rewrite the three existing send functions to render via `renderEmail` and add the new ones.
  Every send function: assemble the template's data (using `dates.js` formatters), render, send
  with the CC list below, own try/catch (never throws). Signatures:

| Function | Template | To | CC |
|---|---|---|---|
| `sendTrialConfirmationEmail({ parent, student, session, schedule, groupClass, level, location, coach })` | `trialConfirmation` | parent | `[ADMIN_EMAIL, coach.email]` |
| `sendRegistrationConfirmationEmail({ parent, student, schedule, groupClass, level, location, coach, chargeAmount, monthlyFee, siblingDiscountAmount })` | `registrationConfirmation` | parent | `[ADMIN_EMAIL, coach.email]` |
| `sendRenewalReceiptEmail({ parent, student, schedule, groupClass, monthLabel, chargeAmount, monthlyFee, siblingDiscountAmount })` | `renewalReceipt` | parent | none |
| `sendCancellationConfirmationEmail({ parent, student, groupClass, schedule, coach, endDate })` | `cancellationConfirmation` | parent | `[coach.email]` — deliberately no admin (CKQ pattern) |
| `sendReactivationConfirmationEmail(...)` | `reactivationConfirmation` | parent | none |
| `sendScheduleChangeConfirmationEmail({ parent, student, old: {...}, next: {...} })` | `scheduleChangeConfirmation` | parent | `[newCoach.email]` |
| `sendPrivateClassConfirmationEmail(...)` | `privateClassConfirmation` | parent | `[ADMIN_EMAIL, coach.email]` |
| `sendPrivateClassSessionReceiptEmail(...)` | `privateClassSessionReceipt` | parent | `[ADMIN_EMAIL]` |
| `sendPrivateClassPaymentFailedEmail(...)` | `privateClassPaymentFailed` | parent | `[ADMIN_EMAIL]` |
| `sendPrivateClassCancellationEmail(...)` | `privateClassCancellation` | parent | `[ADMIN_EMAIL, coach.email]` |

- Update the three existing call sites (`trialClass.service.js`, `registration.service.js`,
  `renewal.service.js`) to pass the richer data (they must fetch/populate coach + class +
  level + location where they don't already — keep the fetch inside the email-assembly step so
  a populate failure can never fail the mutation). Phases 3/4 wire the rest.
- CC emails that resolve to `undefined` (coach with no email) are filtered silently.

### 3.3 `backend/scripts/preview-emails.js` (new)

Port CKQ's: renders every registry key with `SAMPLE_DATA` to `backend/email-preview/*.html` +
`*.txt` + an `index.html`. Add `email-preview/` to `.gitignore`. This is the QA loop that makes
a hard-blocked staging workable.

### 3.4 Tests

- `backend/tests/email/renderEmail.test.js` (new): every registry key renders with its sample
  data (non-empty subject/html/text, no `{{` leftovers, no `undefined` in output); escaping test
  (student name `<b>X&Y</b>` arrives entity-escaped in html); breakdown math renders the passed
  strings verbatim (no arithmetic in templates); text twin contains detailList labels and
  button URLs.
- `mail.service.test.js`: update the three rewired send-function tests for the new signatures
  (**allowed pre-existing update** — behavior deliberately changed); add: CC passed through and
  falsy-filtered; send functions never throw when transport rejects.

---

## 4. PHASE 3 — Admin "Group Class Subscriptions"

**Problem:** no admin visibility of who's subscribed; no admin UI to change a student's
schedule or cancel/reactivate; cancellation sends no email. (Backend cancel is *already*
admin-authorized — it just has no UI or email.)

### 4.1 Backend

**`subscription.service.js` (modify) + `subscription.controller.js` + `subscription.routes.js`:**

- **`GET /api/v1/subscriptions`** (admin, superadmin) → `listAll({ status, q, page = 1, limit = 25 })`.
  Populate `studentId`, `parentId`, `scheduleId → classId → { levelId, locationId } + coachId`.
  Filters: `status=active|cancelled|pending_cancel` (`pending_cancel` = `status:'active',
  cancelAtPeriodEnd:true`; `active` excludes pending-cancel). `q` = case-insensitive substring
  over student/parent first/last/email — academy scale (hundreds of rows), filter in the service
  after populate; note this in a comment. Sort `createdAt:-1`. Return
  `{ subscriptions, total, totalPages, currentPage }`.
- **`POST /api/v1/subscriptions/:id/reactivate`** (parent-own | admin | superadmin) →
  `reactivate(id, requestingUser)`: subscription exists; parent may only touch own (403);
  requires `status==='active' && cancelAtPeriodEnd===true` else 409; write
  `{ cancelAtPeriodEnd: false }`. Send `sendReactivationConfirmationEmail` after the write
  (log-only try/catch). Mirror `cancel()`'s permission shape exactly.
- **`PATCH /api/v1/subscriptions/:id/schedule`** (admin, superadmin) `{ newScheduleId }` →
  `changeSchedule(id, newScheduleId)`. Validation order:
  1. subscription exists, `status === 'active'` (409 otherwise — a pending-cancel sub CAN move,
     matching CKQ),
  2. `newScheduleId` exists, differs from current,
  3. **same level**: resolve both schedules' `classId → levelId`; mismatch → 409
     `"Schedule changes must stay within the same level"` (D6),
  4. capacity: target class's `capacity` vs target schedule's `students.length` → 409 if full,
  5. no other active Subscription for this student on the target schedule (409).
  Writes, in order (Frisco materializes rosters — unlike CKQ this MUST move the student):
  a. `Subscription.scheduleId = newScheduleId`,
  b. the student's active `Registration` for the old schedule → `scheduleId = newScheduleId`,
  c. old schedule: `$pull` student from `students[]`; future sessions
     (`date >= todayAtMidnight()`) of the old schedule: `$pull` from embedded `students`
     (prior art: `renewal.service.js removeStudentFromRoster` — extract that logic into a
     shared helper in `groupClassSchedule` or a `roster.service.js` and reuse it in BOTH
     places rather than duplicating),
  d. new schedule: `$addToSet` student to `students[]`; future sessions of the new schedule:
     push `{ studentId, isPresent: false }` where absent.
  Then `sendScheduleChangeConfirmationEmail` (log-only try/catch). Return the repopulated
  subscription. **Billing untouched** — same level = same price; `lastChargeAmount`,
  `nextBillingDate`, sibling discount all unaffected.
- **`cancel()` (existing):** add `sendCancellationConfirmationEmail` after the
  `cancelAtPeriodEnd` write (populate parent/student/schedule→class→level + coach for the email;
  log-only try/catch; endDate = `currentPeriodEnd`). No other behavior change.
- **Doc note:** this deliberately un-defers the narrow "move a student between schedules" case
  from `docs/features/admin.md`'s schedule-edit deferral; editing a schedule's own
  day/time/coach stays deferred.

### 4.2 Frontend

- **Nav:** new `Billing` section in `frontend/app/admin/layout.tsx` `NAV_SECTIONS` with one item
  `{ href: '/admin/subscriptions', label: 'Subscriptions', icon: <CreditCard size={15} /> }`.
- **`frontend/app/admin/subscriptions/page.tsx`** (new). Not plain Pattern A CRUD — a list +
  action dialogs page using the same primitives (`AdminPageHeader`, `AdminLoadingRow`,
  `AdminEmptyRow`, `admin.module.css` dialog classes):
  - Toolbar: search input (client debounce 400ms → `q`), status select
    (All/Active/Pending cancel/Cancelled).
  - Columns: Student | Parent (email as sub-line) | Class (name + level chip) | Schedule
    (`Day · start–end` + coach name sub-line) | Next billing | Last charge (`$X` + `10% sibling`
    chip when `lastSiblingDiscountApplied`) | Status chip (`Active` / gold
    `Cancels <dateFull(currentPeriodEnd)>` / muted `Cancelled`) | Actions.
  - Actions per row: **Change Schedule** (active or pending-cancel), **Cancel** (active,
    not pending-cancel), **Reactivate** (pending-cancel only).
  - **Change Schedule dialog** — 2 steps, CKQ's shape: step *pick* shows a read-only "Current
    schedule" info box + a "New schedule" select populated from schedules client-filtered to
    the **same level** and excluding the current one (hint text when none match); step
    *confirm* shows before → after (class, day/time, coach) + the line "Monthly fee unchanged —
    same level." Errors render inline and keep the dialog open; success closes + reloads.
  - **Cancel dialog** — small confirm: "Cancel {student}'s subscription? Classes continue
    through {date}; nothing is refunded and the subscription will not renew." Red confirm button.
  - **Reactivate dialog** — "Remove the pending cancellation? Renewals continue as normal;
    nothing is charged now."
  - Pagination: simple Prev/Next on `totalPages`.
- **Services:** new `frontend/lib/services/subscriptionsAdmin.ts` — `fetchSubscriptions(params)`
  (query, throws), `changeSubscriptionSchedule`, `cancelSubscriptionAdmin`,
  `reactivateSubscription` (mutations, `MutationResult`, never throw). Types added to
  `frontend/lib/types.ts` (`AdminSubscriptionRow` etc. — typed against the real populate shape).

### 4.3 Tests

- Backend `tests/routes/subscription.routes.test.js` (extend) + a new
  `tests/services/subscription.service.test.js` section:
  - list: role guard (parent 403, admin 200), status filters (incl. `pending_cancel` split), `q`
    match on parent email, populate shape.
  - changeSchedule: happy path asserts ALL FOUR writes (subscription pointer, registration
    pointer, old roster/sessions pulled, new roster/sessions pushed); same-level 409;
    capacity 409; duplicate-sub 409; inactive-sub 409; **email failure never fails the change**
    (regression describe); email carries old + new schedule.
  - cancel/reactivate: cancel now sends the email (mock nodemailer per convention), rejected
    send still cancels; reactivate guards (not pending → 409; parent-own vs other-parent 403);
    reactivate leaves billing fields untouched.
- Frontend `frontend/app/admin/subscriptions/__tests__/page.test.tsx` (MSW): renders rows from
  handler data; status chips; change-schedule dialog filters to same level; confirm step posts
  correct payload (assert in MSW handler via `await request.json()`); backend 409 message shown
  inline, dialog stays open; cancel + reactivate flows.

---

## 5. PHASE 4 — Private class flow

**The CKQ pipeline with one substitution:** CKQ's *admin creates enrollment → parent accepts*
becomes *coach publishes slots → parent self-registers on a public page* — enrollment is born
active with the rate pinned. Everything downstream (session generation, attendance, per-session
off-session charge, cancellation) is CKQ's design, with four `CKQ-BUG-FIX`es.

### 5.1 New models — `backend/src/models/`

**`coachContract.model.js`** — `CoachContract` (collection `coachcontracts`):
```js
coachId:                ObjectId ref User, required
studentBillingRate:     Number, required, min 0        // $/HOUR billed to the parent
coachCompensationRate:  Number, required, min 0        // $/hour paid to coach — stored only (D11)
sessionDurationMinutes: Number, default 60, min 15     // default slot length
effectiveFrom:          Date, default now
isActive:               Boolean, default true
notes:                  String
// index { coachId: 1, isActive: 1 }
```
Service rule: creating a contract deactivates the coach's previous active one (one active
contract per coach).

**`privateClassSchedule.model.js`** — `PrivateClassSchedule`:
```js
coachId:          ObjectId ref User, required
dayOfWeek:        Number 0–6, required            // Date.getDay() convention, matches group
startTime:        String 'HH:mm', required
durationMinutes:  Number, default 60, min 15
studentId:        ObjectId ref User, default null  // null = AVAILABLE
enrollmentId:     ObjectId ref PrivateClassEnrollment, default null
isActive:         Boolean, default true
// indexes { coachId: 1, isActive: 1 }, { studentId: 1 }
```
Duplicate rule (service-level 409): same `coachId + dayOfWeek + startTime`.

**`privateClassEnrollment.model.js`** — `PrivateClassEnrollment`:
```js
studentId / parentId / coachId: ObjectId ref User, all required
coachContractId:  ObjectId ref CoachContract, required   // audit: which contract set the rate
agreedHourlyRate: Number, required, min 0                 // PINNED at registration — immutable (D7)
status:           enum ['active','cancelled'], default 'active'
endDate:          Date, default null                      // set at cancellation
```

**`privateClassSession.model.js`** — `PrivateClassSession`:
```js
scheduleId:   ObjectId ref PrivateClassSchedule, required
enrollmentId: ObjectId ref PrivateClassEnrollment, required
coachId / studentId / parentId: ObjectId ref User, required (denormalized)
startDate / endDate: Date, required          // endDate = startDate + slot durationMinutes
attendance:   enum ['scheduled','attended','missed'], default 'scheduled'
markedBy:     ObjectId ref User, default null
markedAt:     Date, default null
// UNIQUE index { scheduleId: 1, startDate: 1 }   ← generator idempotency (CKQ pattern)
```

**`privateClassCharge.model.js`** — `PrivateClassCharge` (the per-session money ledger —
Frisco has none today):
```js
sessionId:    ObjectId ref PrivateClassSession, required
enrollmentId / parentId / studentId: ObjectId, required
amount:       Number, required               // dollars, what was actually charged
status:       enum ['pending','completed','failed'], required
stripePaymentIntentId: String, default null
attempt:      Number, default 1
failureMessage: String, default null
paidAt:       Date, default null
// UNIQUE PARTIAL index (CKQ's Layer-1 dedup):
// index({ sessionId: 1 }, { unique: true,
//   partialFilterExpression: { status: { $in: ['pending','completed'] } } })
// 'failed' excluded on purpose — a failed charge must not block retry.
```

### 5.2 Pricing util — `backend/src/utils/privateClassPricing.js` (new)

Port CKQ's `pricing.js` semantics verbatim, fail-closed:
```js
computeSessionPrice(hourlyRate, durationMinutes)  // round(rate * min / 60, 2); throws on
                                                  // null/NaN/negative/non-positive — never 0-guess
sessionDurationMinutes(startDate, endDate)
```
**Every price shown or charged — backend routes, emails, the public page payload — comes from
this file. No pricing math anywhere else, frontend included** (Hard Rule 7).

### 5.3 Backend routes/controllers/services

New route files mounted in `app.js` (after existing mounts):
`coachContract.routes.js` → `/api/v1/coach-contracts`,
`privateClassSchedule.routes.js` → `/api/v1/private-class-schedules`,
`privateClassEnrollment.routes.js` → `/api/v1/private-class-enrollments`,
`privateClassSession.routes.js` → `/api/v1/private-class-sessions`.

| Endpoint | Guard | Behavior |
|---|---|---|
| `POST /coach-contracts` | admin, superadmin | validate coach exists + `role==='coach'`; deactivate previous active; create |
| `GET /coach-contracts?coachId=` | admin, superadmin | list, populated coach |
| `POST /coach-contracts/:id/deactivate` | admin, superadmin | `isActive=false` (a coach with no active contract publishes nothing) |
| `POST /private-class-schedules` | coach (self) \| admin (any, body `coachId`) | coach must have an active contract (400 with clear message); duplicate slot 409 |
| `GET /private-class-schedules/mine` | coach | own slots + populated student/enrollment (registered **before** `/:id`-style routes) |
| `GET /private-class-schedules` | admin, superadmin | all slots, filters `coachId`, `available=true` |
| `DELETE /private-class-schedules/:id` | coach-own \| admin | **only if `studentId === null`** else 409 "Slot has an enrolled student" |
| `GET /private-class-schedules/public` | **no auth** | see §5.4 |
| `POST /private-class-enrollments` | parent | selfRegister — see §5.5 |
| `GET /private-class-enrollments/mine` | parent | own enrollments + slots + last 10 charges each |
| `GET /private-class-enrollments` | admin, superadmin | all, filters `status`, `coachId` |
| `POST /private-class-enrollments/:id/cancel` | parent-own \| admin | see §5.7 |
| `GET /private-class-sessions/mine?window=upcoming\|unmarked\|past` | coach | own sessions, populated student; `unmarked` = `startDate <= now && attendance === 'scheduled'` |
| `PATCH /private-class-sessions/:id/attendance` | auth (check in service) | see §5.6 |
| `POST /private-class-sessions/:id/retry-charge` | assigned coach \| admin | only when latest charge for the session is `failed`; re-runs §5.6's charge step |

### 5.4 Public availability — `GET /private-class-schedules/public`

Unauthenticated. Returns coaches who have an active contract AND ≥1 available slot:
```json
[{ "coachId", "coachName",
   "slots": [{ "scheduleId", "dayOfWeek", "dayName", "startTime", "displayTime",
               "durationMinutes", "sessionPrice", "hourlyRate", "firstSessionDate" }] }]
```
- `sessionPrice` = `computeSessionPrice(contract.studentBillingRate, slot.durationMinutes)`.
- `firstSessionDate` = next occurrence of `dayOfWeek` **strictly after today** (America/Chicago) —
  server-computed; the frontend never does date or price math.
- Excludes slots with `studentId != null` or `isActive: false`. No student/parent data leaks.

### 5.5 Self-registration — `privateClassEnrollment.service.js create(parentUser, { studentId, scheduleId })`

Order (mirrors `registration.service.js create()`'s validation style):
1. student exists, `role === 'student'`, `parentId` matches requesting parent (403);
2. slot exists, `isActive`, populated coach; coach has an active contract (else 409
   "This coach is not currently accepting private students");
3. parent has a `PaymentMethod` (400 "Add a payment method before registering");
4. `ensureStripeCustomer(parent)` (existing service — needed later for charges);
5. create the enrollment: `status:'active'`, `agreedHourlyRate: contract.studentBillingRate`,
   `coachContractId`;
6. **`CKQ-BUG-FIX` (atomic slot claim — CKQ's read-then-write races):**
   ```js
   const claimed = await PrivateClassSchedule.findOneAndUpdate(
     { _id: scheduleId, studentId: null, isActive: true },
     { $set: { studentId, enrollmentId: enrollment._id } },
     { new: true });
   if (!claimed) { await PrivateClassEnrollment.deleteOne({ _id: enrollment._id });
                   throw conflictError('This time slot was just taken — please pick another'); }
   ```
7. generate sessions (§5.8) for this enrollment;
8. `sendPrivateClassConfirmationEmail` (log-only try/catch).
Returns enrollment + claimed slot + `sessionPrice` + `firstSessionDate`.
**No upfront charge** — pay-per-completed-session (CKQ model).

### 5.6 Attendance → charge — `privateClassSession.service.js markAttendance(sessionId, status, requestingUser)`

1. session exists, populated schedule + enrollment;
2. **`CKQ-BUG-FIX` (ownership — CKQ lets any coach mark any session):** requester must be
   admin/superadmin OR the session's `coachId` (403 "You are not the coach for this session") —
   same service-level pattern as `groupClassSession.service.js`;
3. `startDate <= now` else 400 "Cannot record attendance for a session that has not yet occurred";
4. `status ∈ ['attended','missed']` (no un-marking to `scheduled`);
5. if a **completed** charge exists for this session: any change away from `attended` → 409
   "This session has already been charged" (attendance and money must not contradict);
6. write `attendance`, `markedBy`, `markedAt`;
7. if `status === 'attended'` → `chargeSession(session)`:
   a. **fresh re-fetch** of the enrollment; charge only if `status === 'active'` OR
      (`cancelled` AND `session.startDate <= endDate`) — the delivered-before-cancellation case.
      Otherwise: attendance stays recorded, no charge, response carries
      `{ charged: false, reason: 'enrollment_cancelled' }` (this is the mandatory
      **cancel-then-charge race** guard);
   b. pre-check: existing `pending|completed` charge → return it (idempotent — double-save of
      the same attendance never double-charges);
   c. `amount = computeSessionPrice(enrollment.agreedHourlyRate,
      sessionDurationMinutes(session.startDate, session.endDate))` — the session's own stored
      duration, not the slot's current one;
   d. `attempt = (count of failed charges for session) + 1`; create `PrivateClassCharge`
      `pending` (an `E11000` on the unique partial index → treat as already-charged, return
      existing);
   e. parent's `PaymentMethod` required (fail the charge cleanly if missing: charge → `failed`,
      message "No payment method on file");
   f. Stripe off-session PaymentIntent — the exact shape of `registration.service.js`:
      `{ amount: Math.round(amount*100), currency:'usd', customer, payment_method,
      off_session:true, confirm:true }` with idempotency key
      **`pcs_${sessionId}_${attempt}`** (**`CKQ-BUG-FIX`** — CKQ's un-suffixed key made Stripe
      replay a cached decline for 24h, blocking same-day retry);
   g. success → charge `completed` + `paidAt` + `stripePaymentIntentId`;
      `sendPrivateClassSessionReceiptEmail` (log-only);
   h. `StripeCardError` → charge `failed` + `failureMessage`;
      `sendPrivateClassPaymentFailedEmail` (log-only, **`CKQ-BUG-FIX`** — CKQ sends nothing on
      failure). Attendance stays `attended`; the route returns 200 with
      `{ charged: false, chargeStatus: 'failed' }` — a payment failure is a billing state, not
      a request error.
Response always returns the session + its latest charge so the UI can render chips without a
second fetch.

### 5.7 Cancellation — `cancel(enrollmentId, requestingUser)`

parent-own (403 otherwise) | admin. Requires `status === 'active'` (409). In order:
1. enrollment → `{ status:'cancelled', endDate: now }`;
2. free every slot: `updateMany({ enrollmentId }, { $set: { studentId: null, enrollmentId: null } })`;
3. hard-delete future sessions (`startDate > now`) — provably money-free: charging requires
   attendance, attendance requires `startDate <= now` (CKQ's argument, keep the comment);
4. `sendPrivateClassCancellationEmail` (log-only). Past sessions and completed charges are
   untouched (immutable ledger).

### 5.8 Session generation — `backend/src/services/privateClassSession.service.js generateSessions({ enrollmentId })`

For each claimed active slot of the enrollment: create sessions for the next **8 weeks**
starting from the first occurrence of `dayOfWeek` **strictly after today** (America/Chicago —
compute the local date, then store `startDate` as the UTC instant of the slot's local
`startTime`; `endDate = startDate + durationMinutes`). Skip dates that already have a session
(the unique index is the backstop; also dedup in-memory). Mirrors group's
`generateInitialSessions` (8 weeks) rather than CKQ's 10 — consistency wins.
Also: `backend/scripts/extend-private-sessions.js` (new, npm script `extend-private-sessions`) —
re-runs generation for all active enrollments, same manual-run model as `run-renewals.js`; add
both to the deployment plan's deferred-cron note.

### 5.9 Frontend

**Public page — `frontend/app/private-classes/page.tsx`** (new, no auth): hero line + one card
per coach: name, then slot rows (`Monday · 4:00 PM · 60 min`, `$65 / session`, `First session
Mon, Aug 25`) each with a **Book this slot** button → `/parent/register-private?slot=<scheduleId>`
(unauthenticated users hit the existing login redirect and return). Data from
`GET /private-class-schedules/public` via a new `frontend/lib/services/privateClass.ts`. Empty
state: "No private lesson slots are open right now — check back soon." Add a "Private Lessons"
link to the public home page's offer section and to `AppShell`'s logged-out nav if one exists
(match existing home-page patterns; do not restructure the home page).

**Parent wizard — `frontend/app/parent/register-private/page.tsx`** (new): flow-kit 3 steps,
same skeleton as `parent/register`:
1. *Who* — `ChildPickerCards` (honors `?child=` deep-link like the group wizard);
2. *Review & Pay* — slot summary (coach, day/time/duration, `$X per session`, first session
   date — all server values from the public payload; `?slot=` preselects), the saved-card guard
   (identical to group wizard: inline notice + disabled CTA when no payment method), and the
   consent line: "You'll be charged **$X after each completed session** to your saved card.";
3. *Done* — `FlowConfirmation` with slot + "you'll get a confirmation email".
Submit `createPrivateEnrollment({ studentId, scheduleId })`; a 409 slot-taken renders the
backend message with a "Refresh available slots" action (refetch + back to the public list).
CTA lives only in `OrderSummary`'s rail (flow-kit rule).

**Parent portal:**
- `ParentPortalContext`: add `privateEnrollments` to the `Promise.allSettled` set (secondary —
  failure degrades to `[]`), expose on the context, reload via the existing `attempt` counter.
- `frontend/app/parent/subscriptions/page.tsx`: add a **Private Lessons** section below group
  subscriptions — per enrollment: coach, slot line, `$X / session`, status chip, recent charges
  list (date · amount · Paid/Failed chip), and a Cancel button (confirm dialog: "All upcoming
  sessions will be removed and the weekly slot released. Completed sessions already charged are
  unaffected."). Sidebar nav: add "Private Lessons" under ACADEMY → `/private-classes` (browse).
- Child status rows in `ParentPortalShell` are untouched (group-status semantics stay as-is).

**Coach page — `frontend/app/coach/private-students/page.tsx`** (new): uses the legacy
`ProtectedRoute` + `AppShell` (consistent with the existing coach pages; the coach shell rebuild
is explicitly out of scope). Add `{ href: '/coach/private-students', label: 'Private Students' }`
to `NAV_LINKS_BY_ROLE.coach` in `AppShell.tsx`. Content:
- **Needs attention** (top): unmarked past sessions (`window=unmarked`) — student, date/time,
  `$X`, buttons **Attended** / **Missed**. *Attended* opens the confirm dialog: "Mark attended
  and charge {parent}'s card ${X}?" → PATCH; result chip `Charged` / red `Charge failed` with a
  **Retry charge** button (→ retry endpoint). *Missed* confirms without a money warning.
- **Upcoming** list (read-only) grouped by student.
- Charge failure renders the message inline; attendance still shows as marked (matches backend
  semantics).

**Admin pages:**
- `frontend/app/admin/coach-contracts/page.tsx` (new, Pattern A minus edit): list (coach,
  $/hr billed, $/hr comp, default duration, status, since) + Add dialog (coach select from
  `?role=coach`, rates, duration; hint "Creating a contract replaces the coach's current active
  contract") + Deactivate action (confirm dialog; the delete-style guard messaging pattern).
- `frontend/app/admin/private-classes/page.tsx` (new): `?tab=` (default `enrollments`) —
  *Enrollments*: student/parent/coach/slot/`$X/hr`/status + **Cancel** action (same confirm copy
  as parent-side); *Schedules*: all slots (coach, day/time/duration, Available or student-name
  chip) + Add Slot dialog (coach, day, time, duration — admin creating on a coach's behalf) +
  Delete on free slots (409 verbatim on occupied, Pattern A cannot-delete state).
- Nav: extend the `Programs` section (or add a `Private Classes` section — match the sidebar's
  visual balance) with items **Private Classes** and **Coach Contracts**.

Types for all of the above in `frontend/lib/types.ts`, typed against the real backend payloads.

### 5.10 Tests

Backend (new files mirroring `src/`):
- `coachContract.routes.test.js` — CRUD, previous-contract deactivation, non-coach 400, role guards.
- `privateClassSchedule.routes.test.js` — create (coach self / admin any / no-contract 400 /
  duplicate 409), `mine`, delete-free-ok / delete-occupied-409, **public endpoint**: no auth
  needed, excludes taken + inactive slots and contract-less coaches, `sessionPrice` matches
  `computeSessionPrice`, `firstSessionDate` strictly after "today" (fake timers, midday UTC).
- `privateClassEnrollment.routes.test.js` — selfRegister full happy path (enrollment active,
  rate pinned from contract, slot claimed, 8 sessions generated, email sent — assert data);
  not-my-child 403; no-payment-method 400; **slot race regression describe**: pre-claim the slot
  → 409 AND no orphan enrollment left behind; cancel (frees slots, deletes only future sessions,
  keeps past ones, email; double-cancel 409; other-parent 403); rate-pin regression: contract
  rate changed after enrollment → charge still uses pinned rate.
- `privateClassSession.routes.test.js` (real Stripe TEST-mode, per strategy):
  attended → charge `completed` + correct amount (rate×duration/60) + receipt email;
  future-session 400; **ownership regression**: another coach 403, assigned coach ok, admin ok;
  missed → no charge; **idempotency describes**: double-mark attended → exactly ONE charge;
  E11000 path returns existing; **cancel-then-charge race** (mandatory): enrollment cancelled
  with `endDate` before the session's start → attendance recorded, `charged:false`, zero
  Stripe calls; delivered-before-cancellation → charges; declined card (Stripe test PM
  `pm_card_visa_chargeDeclined`) → charge `failed` + failure email + retry endpoint succeeds
  with a fresh `attempt` (assert attempt=2); attended→missed after completed charge → 409.
- `privateClassPricing.test.js` — util: rounding, fail-closed throws.

Frontend:
- `app/private-classes/__tests__/page.test.tsx` — renders coaches/slots/prices from MSW,
  empty state, book-button href carries scheduleId.
- `app/parent/register-private/__tests__/page.test.tsx` — wizard steps, saved-card guard
  disables CTA, submit payload asserted in MSW handler, 409 slot-taken branch renders message
  without crashing.
- `app/coach/private-students/__tests__/page.test.tsx` — unmarked list, confirm dialog shows the
  amount, attended PATCH payload, failed-charge → Retry visible, retry POST fires.
- `app/admin/coach-contracts/__tests__/page.test.tsx`, `app/admin/private-classes/__tests__/page.test.tsx`
  — Pattern A behaviors, cancel/delete guards render backend messages verbatim.
- `ParentPortalContext` test (extend): private enrollments fetched; its failure degrades to `[]`
  without setting `error`.

---

## 6. DOCS TO UPDATE (same run, final commit)

| Doc | Change |
|---|---|
| `CLAUDE.md` | Doc map: this plan row → SHIPPED-pending-review wording left to the owner; add rows for `docs/features/private-class.md` and `docs/modules/email.md`; Platform Scope: move private classes out of "explicitly deferred"; pre-read table: add private-class + email rows. |
| `DATABASE_SCHEMA_DOCUMENTATION.md` | Add the 5 new collections (full field tables + indexes, incl. the partial unique index rationale). |
| `docs/modules/email.md` (new) | Block system architecture, tokens, template registry table, CC pattern table, the `APP_ENV` gate, preview-script usage. |
| `docs/features/private-class.md` (new) | Lifecycle diagram, model map, charge pipeline + idempotency layers, the four CKQ-BUG-FIXes, route table, page inventory. |
| `docs/features/admin.md` | Subscriptions page spec (columns/actions/dialogs), coach-contracts + private-classes pages, and amend the schedule-edit deferral note (student *moves* now supported; schedule field edits still deferred). |
| `docs/features/parent-portal.md` | register-private wizard, subscriptions-page private section, context contract change. |
| `docs/plans/deployment-launch-plan.md` | §4a env rows (`APP_ENV`, `ADMIN_EMAIL`, `LOGO_URL`); follow-ups: owner sets them in Vercel; add `extend-private-sessions` to the future-cron note. |
| `docs/TEST_COVERAGE.md` | Re-run both suites, record REAL counts + new per-layer rows. |
| `CLAUDE_HISTORY.md` | One entry for the run (phases, headline decisions, bug-fixes vs CKQ). |

---

## 7. OUT OF SCOPE (explicitly)

Refunds of any kind · level promotion / premium tiers · private-class trials or reschedule
requests · coach payout UI / timesheets · membership or credit systems · dunning/auto-cancel
retries for private charges (retry is manual via the coach button) · Stripe webhooks for
private charges (synchronous result is recorded; webhook reconciliation can come with the
group-webhook hardening later) · guest checkout · editing a group schedule's own fields ·
renewals cron automation.
