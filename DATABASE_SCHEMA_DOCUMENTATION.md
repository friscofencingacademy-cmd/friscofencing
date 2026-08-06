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

| Collection | Purpose |
|---|---|
| `Location` | Address/timezone for a physical training location. |
| `Level` | Skill-level lookup (beginner/intermediate/advanced). |
| `GroupClass` | A class offering — name, level ref, location ref, capacity, price ref. |
| `GroupClassSchedule` | A recurring weekly slot for a class — coach, day/time, roster. |
| `GroupClassSession` | One dated occurrence of a schedule — embeds `students[].isPresent` for attendance. |
| `Price` | Rate card by class/level. |
| `TrialClass` | Free one-time trial booking — no payment. |
| `PaymentMethod` | A parent's saved card (Stripe Customer + PaymentMethod IDs). |
| `Registration` | The enrollment record — student, class/schedule ref, status. |
| `Subscription` | Recurring billing state — status, current period, next billing date, `cancelAtPeriodEnd`, sibling-discount fields. |
| `WebhookEvent` | Dedup log of processed Stripe webhook event IDs. |
