# Trial registration: phone, date of birth, and trial info copy

**Status: BUILT 2026-08-29, on branch `feature/trial-registration-required-fields`,
awaiting local testing before commit (CLAUDE.md Hard Rule 5 — not committed yet).** Written
and discussed with the owner before writing any code (Hard Rule 1). Source: the owner's
existing Kicksite trial signup page
(`https://friscofencingacademy.kicksite.net/public/landing_pages/.../submission/new`), whose
full form schema and info copy were extracted from JSON embedded in the page's own HTML (a
`<preact-component>` hydration prop), not guessed.

## Completion notes

Built exactly as spec'd below, with one real design fix caught during implementation, not
assumed: `trialClass.service.js`'s gate initially checked `requestingUser.phone` directly,
which is correct for a parent-initiated booking but WRONG for the admin-initiated branch —
`requestingUser` there is the admin, who has no reason to ever have a phone on file, so every
admin-initiated booking would have failed the gate regardless of the family's real data. Fixed
to resolve the student's own parent (`student.parentId`) as the phone to check when
`isAdmin`, proven by a dedicated test asserting an admin-initiated booking succeeds once the
FAMILY (not the admin) has both fields on file.

Also found and fixed along the way: `jest.useFakeTimers()` reliably hangs this backend's
route-level tests when combined with the real supertest+MongoDB stack (confirmed by an actual
hang, not assumed) — every new age-dependent route test instead uses a birthdate built from
real relative-date math (pushed safely past any year-boundary/timezone ambiguity), not a
frozen clock; `age.test.js` (a pure unit test with no supertest/Mongo involved) still uses
frozen time normally, per `docs/TESTING_STRATEGY.md`'s date rules.

Verified: backend Jest 510/538 (same 28 pre-existing failures already documented elsewhere in
this repo as unrelated — reproduced identically before this change too); `tsc --noEmit`
clean; frontend Jest 289/289; `next build` succeeds; Playwright e2e 19/19 (2 pre-existing
unrelated skips — neither `/register`'s new phone field nor the trial-booking gate are
exercised by any existing e2e spec, confirmed by checking, not assumed).

## Ground truth: what Kicksite's form actually collects

| Field | On | Type | Required |
|---|---|---|---|
| Athlete Name | student | text | yes |
| Email | student | email | yes |
| Phone Number | student | tel | yes |
| Birthdate | student | date | yes |
| Age | student | text (derived) | yes |
| Parent/Guardian Name | parent | text | yes |
| Email | parent | email | yes |
| Phone Number | parent | tel | yes |
| How did you hear about us? | parent | select | yes |

Kicksite is a single public, no-login lead-capture form (backed by a Cloudflare Turnstile
CAPTCHA). Our platform is account-first — a parent creates an account and adds a child before
ever reaching "Book a Trial." **Decision, confirmed with the owner: keep our account-first
flow** (do not build a public no-login form to match Kicksite structurally) — instead close
the actual field gaps and add the informational copy Kicksite shows.

**Scope, as refined in conversation:**
- Parent side: collect **phone** (email is already required — it's the login field). "How
  did you hear about us?" is **not** in scope for this change.
- Student side: collect **date of birth** (and derive **age** from it) — moved to the Add
  Child flow, not the trial-booking step. Email stays optional for students (existing,
  deliberate MVP behavior — unchanged).

## Hard rule check

- Age is a **derived display value**, computed server-side from `dateOfBirth` (never trusted
  from the client, never recomputed inconsistently across pages) — same principle as this
  codebase's other date-sensitive service functions (`docs/decisions/001-in-house-subscription
  -billing.md`'s own repeated timezone/date-correctness addenda).
- No billing/pricing logic touched. No frontend arithmetic introduced.
- `docs/features/admin.md` and `docs/features/parent-portal.md` are both pre-read requirements
  here (admin's user dialog and the parent portal's Add Child modal are both touched).

## 1. Backend

### 1.1 `User` model (`backend/src/models/user.model.js`)

Two new fields, both **not** schema-`required` — same pattern already used for `email`
(comment: "students may not have an email yet in this MVP... enforced at the service layer
instead"). Neither field applies to every role, so a blanket schema-level `required` would be
wrong; enforcement happens exactly where each ask actually applies (see 1.2/1.3 below).

```js
phone: {
  type: String,
  trim: true,
},
dateOfBirth: {
  type: Date,
},
```

### 1.2 Phone — hard-required at signup (`backend/src/services/auth.service.js`)

`register({ firstName, lastName, email, password })` gains `phone`. Validate non-empty
(trimmed) the same way `email`/`password` presence is already implicitly relied on by the
route layer — add an explicit `badRequestError('Phone number is required')` check alongside
whatever the existing missing-field handling is, store `phone` on the created `User`.

No format validation beyond "non-empty" — this codebase has no phone-format validator
anywhere yet, and building one is out of scope for this change.

### 1.3 Date of birth — required on Add Child's own path, NOT hard-required at the shared service layer

`student.service.js`'s `create()` is called from **two** places: a parent adding their own
child, and admin creating a student on a specific parent's behalf (`/admin/users`'s dialog).
Hard-requiring `dateOfBirth` in the shared service would block the admin path too, which may
not always have a birthdate in hand (e.g. bulk/legacy entry) — **decision: don't add a 400
there.** `dateOfBirth` is accepted and stored when present:

```js
return User.create({
  role: 'student',
  firstName: data.firstName,
  lastName: data.lastName,
  skillLevel: data.skillLevel,
  dateOfBirth: data.dateOfBirth,
  parentId,
});
```

The frontend makes it required on the **parent-facing** Add Child modal (§2.2) — admin's
dialog gets the field too (§2.4) but doesn't force it, matching the "don't block admin data
entry" decision above.

### 1.4 The actual backstop: `POST /trial-classes` validation gate (`backend/src/services/trialClass.service.js`)

This is what makes "mandatory for trial class registration" literally true — including for
any account/child created **before** this change ships (there is currently no self-service
way for an existing parent to add a missing phone, or an existing child's missing birthdate,
after the fact; an admin can patch either via the existing `PUT /users/:id`). Add near the top
of `create()`, after resolving `student` and before the duplicate-trial check:

```js
if (!requestingUser.phone) {
  throw badRequestError('Add a phone number to your account before booking a trial class.');
}

if (!student.dateOfBirth) {
  throw badRequestError(`Add ${student.firstName}'s date of birth before booking a trial class.`);
}
```

(`badRequestError` doesn't exist yet in this file — add the same small local helper
`registration.service.js`/`student.service.js` already each define, rather than importing
across service files.) Admin-initiated trial bookings (`isAdmin` branch, already in this
function) are **not exempted** — an admin booking a trial on a family's behalf should still
be told the same missing-field story, since the gap is in the family's own data either way.

### 1.5 Age — `calculateAge()` utility + where it's returned

New small utility, colocated with the other date helpers this codebase already keeps
separate from business logic (`backend/src/utils/billingDates.js`'s pattern) —
`backend/src/utils/age.js`:

```js
const { todayDateOnly } = require('./billingDates');

// Whole years between `dateOfBirth` and "today" (Central time, matching every
// other "today" in this codebase — docs/decisions/001-in-house-subscription-
// billing.md's timezone-correctness addendum) — never the requesting browser's
// own clock/timezone. Returns null when there's no dateOfBirth to compute
// from, never 0 or a guess.
function calculateAge(dateOfBirth) {
  if (!dateOfBirth) return null;

  const today = todayDateOnly();
  let age = today.getFullYear() - dateOfBirth.getFullYear();
  const hasHadBirthdayThisYear =
    today.getMonth() > dateOfBirth.getMonth() ||
    (today.getMonth() === dateOfBirth.getMonth() && today.getDate() >= dateOfBirth.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;

  return age;
}

module.exports = { calculateAge };
```

`student.service.js`'s `listMine()` (and `student.controller.js`'s `create` response) both
return `{ ...student.toJSON(), age: calculateAge(student.dateOfBirth) }` per row — computed
fresh on every read, never stored (the same "derived, never cached" instinct as `Registration
.currentCharge`). Admin's student-listing/response path (`user.service.js`/`user.controller.js`,
wherever `/admin/users` lists students) gets the same treatment for consistency.

## 2. Frontend

### 2.1 `/register` — phone field + trial info section

Add a required `phone` field to the signup form (`frontend/app/register/page.tsx`), between
Email and Password. `useAuth()`'s `register()` signature and the `POST /auth/register` call
both gain the `phone` argument/field.

**Trial info section**, shown above the signup card — copy adapted from the owner's own,
already-live Kicksite page content (not invented; lightly reworded for our platform's voice,
same content/claims):

> **Your First Class Is Free**
>
> Our free trial class gives new students the chance to experience Olympic fencing at Frisco
> Fencing Academy before enrolling in a program.
>
> During your trial, you'll join a coach-led beginner class and be introduced to:
> - Basic fencing movements and footwork
> - Fundamental rules and safety guidelines
> - Introductory drills and blade work
>
> No prior fencing experience is required — it's designed to be fun, engaging, and
> beginner-friendly.
>
> **What to bring:** comfortable athletic clothing, athletic shoes, and a water bottle. All
> fencing equipment is provided by the academy.

Layout: a new small presentational component in `app/components/marketing/` (e.g.
`TrialInfoCard`) rendered above the existing signup `Card`, both inside the same centered
column — not a `Card` fork, not inline-styled prose (matches this repo's own anti-pattern list
in `docs/design-system.md`).

### 2.2 Add Child (`AddChildModal`) — required Date of Birth

Add a `dateOfBirth` field (`<input type="date">`, required) between Last Name and Skill
Level. `createStudent()` (`lib/services/parent.ts`) and its `SkillLevel`-adjacent input type
both gain `dateOfBirth: string` (ISO date). Client-side: reject an empty value the same way
first/last name are already rejected before the request is even sent.

### 2.3 Displaying age

Wherever a child's info already renders (child cards on the dashboard, `ChildPickerCards`,
`/parent/child/[id]`), show the backend-computed `age` next to name/skill level when present
— e.g. "Kid One · Age 8 · Beginner." Never computed client-side from `dateOfBirth`; if `age`
is `null` (a child created before this change, no birthdate on file), the age simply doesn't
render — same "no data, don't render a placeholder" instinct as the rest of this app.

### 2.4 Admin's user dialog (`/admin/users`) — Date of Birth, not required

Add the same `dateOfBirth` input to the student-creation branch of admin's create/edit
dialog, wired to the same `createStudent`/update payload — but without a client-side
`required` attribute, matching the backend's "don't force it here" decision (§1.3).

### 2.5 `lib/types.ts`

`Student` gains `dateOfBirth?: string` and `age?: number | null`. `AuthUser`/parent-shaped
types gain `phone?: string` where a parent's own profile fields are typed.

## 3. Tests (per file, non-exhaustive — exact cases decided during implementation)

- `auth.service.test.js` / the register route test: phone required (400 without it), stored
  on success.
- `student.service.test.js`: `dateOfBirth` accepted and stored when present; creation still
  succeeds without it (admin path).
- `trialClass.service.test.js` / route test: 400 with the specific message when the parent has
  no phone; 400 with the specific message when the student has no `dateOfBirth`; unchanged
  (200/201) success path once both are present — including the admin-initiated-booking branch.
- `age.test.js` (new, small, pure-function unit test): whole-years-under/over-birthday cases,
  `null` for no `dateOfBirth`, frozen-clock per `docs/TESTING_STRATEGY.md`'s date rules (never
  the real wall clock).
- Frontend: `/register` page test — phone required, submitted in the payload, trial info
  section renders; `AddChildModal` test — DOB required, submitted in the payload; any child-card
  test asserting the new age display (and its absence when `age` is `null`).

## 4. Explicitly out of scope (confirmed with the owner)

- A public, no-login trial signup page matching Kicksite structurally.
- "How did you hear about us?" — not requested.
- Self-service parent profile editing / child editing (the backfill gap for pre-existing
  accounts) — a real gap, left open on purpose; admin's existing `PUT /users/:id` is the
  stop-gap. Revisit if it becomes a real problem once real families are using the platform.
- Phone format validation (any non-empty string is accepted).
