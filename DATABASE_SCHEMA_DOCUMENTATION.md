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

## `PaymentMethod` — implemented (Phase 7a — card save only, no charging yet)
| Field | Type | Notes |
|---|---|---|
| `parentId` | ObjectId ref `User` | required, **unique** — one saved card per parent for MVP |
| `stripePaymentMethodId` | String | required |
| `cardBrand`, `cardLast4` | String | required, display-safe (never the full card number, which we never touch) |
| `cardExpMonth`, `cardExpYear` | Number | required |

`User.stripeCustomerId` (String, unique + sparse — same null-collision-safe pattern as `email`) is created lazily on first card save. Replacing a saved card detaches the old Stripe PaymentMethod first — nothing orphaned is left attached to the Stripe customer.

## `Registration`, `Subscription` — implemented (Phase 7b)
| Collection | Key fields |
|---|---|
| `Registration` | `studentId` ref, `scheduleId` ref, `status` (`active`/`cancelled`) — the enrollment fact |
| `Subscription` | `studentId`, `scheduleId`, `parentId` refs; `status`; `cancelAtPeriodEnd`; `currentPeriodStart/End`; `nextBillingDate`; `lastChargeAmount`/`lastSiblingDiscountApplied` (record-keeping only — never read back as a source of truth) — the billing lifecycle, kept as a separate concern from `Registration` even though 1:1 today. **No unique index on `(studentId, scheduleId)`** — a student can legitimately re-register after a past cancellation; "no currently active enrollment" is a service-layer check, not a schema constraint. |

**Renewal + cancellation (Phase 9):** `POST /subscriptions/:id/cancel` sets `cancelAtPeriodEnd` only — `status` and roster access are untouched, access continues through the paid period. `backend/scripts/run-renewals.js` (`npm run renewals`, no real scheduler yet) processes due subscriptions one at a time via `renewOne`, which does its own fresh fetch before charging or finalizing. See `docs/decisions/001-in-house-subscription-billing.md` for the full design.

**Sibling discount (10%, Phase 8, in `calculateChargeAmount`):** dynamic lower-payer rule — whichever of two siblings has the live (never-cached) lower current price gets 10% off. Exact ties break deterministically by `studentId` comparison (prevents a double-discount if both siblings' charges are computed independently). Fully re-derived on every call, including future renewals — nothing about the discount is cached or trusted from a prior charge. **Known, accepted limitation:** two siblings' very first registrations at the exact same instant could each see "no active sibling yet" and neither gets the discount — would need a multi-document Mongo transaction to close; out of scope since real-world registration is always serial.

`POST /registrations` (parent-only) charges the saved card off-session via a Stripe `PaymentIntent` with a stable idempotency key (`initial-registration-{studentId}-{scheduleId}`) BEFORE creating anything — nothing is created unless the charge actually succeeds. No 3DS/`requires_action` handling (disclosed MVP limitation). On success, the student is added to the schedule's ongoing roster and backfilled into every already-generated future session (not just sessions generated from now on).

The charge-amount calculation lives in its own file, `backend/src/services/billing/calculateChargeAmount.service.js` — deliberately isolated so Phase 8 (sibling discount) can edit it in place and Phase 9 (renewal job) can reuse it without extraction.

## `WebhookEvent` — implemented (Phase 11, scoped)
| Field | Type | Notes |
|---|---|---|
| `stripeEventId` | String | required, **unique** — the dedup key; Stripe redelivers events, this makes redelivery a safe no-op |
| `type` | String | required |
| `paymentIntentId`, `status` | String | not required — only meaningful for `payment_intent.*` events |

`POST /api/v1/webhooks/stripe` verifies Stripe's signature (registered with its own `express.raw()` middleware BEFORE the global `express.json()` — the raw body is required for signature verification and would otherwise be destroyed). Only records `payment_intent.succeeded`/`payment_intent.payment_failed`; other event types are acknowledged but not stored. Deliberately scoped down from full reconciliation — every charge in this project is synchronous (`off_session`/`confirm: true`, no 3DS), so this is a safety net for a narrow crash-recovery window, not something the core flow depends on.
