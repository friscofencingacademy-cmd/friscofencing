# Database Schema — Frisco Fencing Academy

Planned schema — filled in with real fields as each model is built. Collections without a field list below are not yet implemented.

## `User` — implemented (`backend/src/models/user.model.js`)
| Field | Type | Notes |
|---|---|---|
| `role` | String enum | `student`, `parent`, `coach`, `admin`, `superadmin` — required |
| `firstName`, `lastName` | String | required |
| `email` | String | lowercase/trim, **unique + sparse** (not schema-required — students may not have one; sparse avoids a null-collision on the unique index) |
| `passwordHash` | String | not schema-required — only set for login-capable roles (parent/coach/admin/superadmin); stripped from all JSON output via a `toJSON` transform |
| `parentId` | ObjectId ref `User` | for students, links to the parent's account; not schema-required, enforced in application logic |
| `skillLevel` | String enum | `beginner`/`intermediate`/`advanced`, optional |

Login is email+password for `parent`/`coach`/`admin`/`superadmin` only — students don't log in in this MVP (no student portal). No public signup endpoint yet; the only account-creation path is `backend/scripts/seed-superadmin.js` (idempotent, env-driven). Parent self-registration is deferred to the trial-booking phase.

## `Location`, `Level`, `GroupClass`, `GroupClassSchedule`, `GroupClassSession` — implemented
| Collection | Key fields |
|---|---|
| `Location` | `name` (unique), `address`, `timezone` (default `America/Chicago`) |
| `Level` | `name` (unique), `order` (unique, for sorting) |
| `GroupClass` | `name`, `levelId` ref, `locationId` ref, `capacity`. **No price reference** — `Price` (Phase 4) is looked up dynamically by level at billing time, not stored as a foreign key here. |
| `GroupClassSchedule` | `classId` ref, `coachId` ref (must be a `User` with `role: 'coach'`), `dayOfWeek` (0–6, `Date.getDay()` convention), `startTime`/`endTime` (`"HH:mm"`), `students` (enrolled roster, array of ObjectId) |
| `GroupClassSession` | `scheduleId` ref, `date`, `students[].isPresent` (defaulted `false`) — unique on `(scheduleId, date)`. Generated synchronously (8-week initial window) when a schedule is created. Attendance marking: `PATCH .../attendance` — admin/superadmin can mark any session, a coach only sessions on their own assigned schedule (checked in the service against `schedule.coachId`, not by route-level role gating, since it's per-session); can only flip `isPresent` on existing roster entries, never add/remove them. |

Deleting a `Location` or `Level` still referenced by a `GroupClass` is rejected (409).

## `Price` — implemented
| Field | Type | Notes |
|---|---|---|
| `levelId` | ObjectId ref `Level` | required, **unique** — one price per level (fencing is in-person only, no online/in-person split) |
| `monthlyFee` | Number | required, min 0 |

## `TrialClass` — implemented
| Field | Type | Notes |
|---|---|---|
| `studentId` | ObjectId ref `User` | required, **unique** — one trial ever, platform-wide, backed by a service-layer pre-check + this index (same two-layer pattern as `Price.levelId`) |
| `sessionId` | ObjectId ref `GroupClassSession` | required — booking adds the student into this session's roster |

`POST /auth/register` is the platform's first public (unauthenticated) endpoint — parent self-signup. Students (`role: 'student'`) are created via `POST /students`; a parent's own `parentId` is forced server-side and cannot be overridden by the request body.

| Collection | Purpose |
|---|---|
| `PaymentMethod` | A parent's saved card (Stripe Customer + PaymentMethod IDs). |
| `Registration` | The enrollment record — student, class/schedule ref, status. |
| `Subscription` | Recurring billing state — status, current period, next billing date, `cancelAtPeriodEnd`, sibling-discount fields. |
| `WebhookEvent` | Dedup log of processed Stripe webhook event IDs. |
