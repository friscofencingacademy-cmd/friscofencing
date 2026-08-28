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

## `Service` — implemented (`docs/plans/service-registry-unified-ledger-plan.md`)
| Field | Type | Notes |
|---|---|---|
| `code` | String | required, unique, lowercase-kebab (`/^[a-z0-9]+(-[a-z0-9]+)*$/`) — the ONLY thing any code branches on or looks up by; never the display name |
| `name` | String | required — display only, freely renameable with zero data migration |
| `billingShape` | String enum | required — `subscription_cycle` \| `per_session` \| `one_time_event`; which `Registration` discriminator this service's charges are written as |
| `isActive` | Boolean | default true — owner/admin state, never touched by the seed script on an existing row |

Seeded (idempotent, `npm run seed:services` / `scripts/lib/seedServices.js`, also run as the
first step of every `refreshStagingData` sequence, before the legacy import): `group-classes`
(subscription_cycle), `private-lessons` (per_session), `camps` and `meets` (both
one_time_event, both `isActive: false` until those features are built). No admin CRUD UI —
four near-static rows managed by seed script; see the plan doc's D7 for the trigger that would
change that. Read via `serviceCatalog.service.js`'s `getServiceByCode(code, {requireActive})` —
no caching (re-verified every call, same principle as `Setting`, below), fails closed (500) if
the code isn't seeded at all, 409 if `requireActive` is set and the service is inactive.

## `Registration` — the unified payment ledger (implemented; restructured by `docs/plans/service-registry-unified-ledger-plan.md`, superseding Phase 7b's original 3-field shape and `docs/plans/registration-ledger-plan.md`'s PR 1 group-only schema)

ONE collection for every charge in the business — see ADR `docs/decisions/004-service-registry-and-unified-ledger.md` for the full design. Factored on two independent dimensions, never conflated:

| Base field (every row, every shape) | Type | Notes |
|---|---|---|
| `serviceId` | ObjectId ref `Service` | required, indexed — the BUSINESS dimension (which offering this money belongs to) |
| `billingShape` | String (Mongoose discriminator key) | required — `subscription_cycle` \| `per_session` \| `one_time_event` — the STRUCTURAL dimension (which fields/dedup index apply) |
| `studentId`, `parentId` | ObjectId ref `User` | required |
| `status` | String enum | `pending`/`completed`/`failed` — required |
| `amount` | Number | required — dollars, what was actually charged (or attempted) |
| `stripePaymentIntentId` | String | default null |
| `failureMessage` | String | default null |
| `attempt` | Number | default 1 — bumped on retry; the SAME row is updated in place, never duplicated |
| `paidAt` | Date | default null |
| `backfilled` | Boolean | default false — set only by a migration script reconstructing a row from another collection's snapshot, never by a normal charge path |

**Mutation contract**, every row regardless of shape: immutable after insert except the `pending -> completed|failed` transition and retry's own updates to `attempt`/`stripePaymentIntentId`/`failureMessage`/`paidAt`/`status`.

**Discriminator: `subscription_cycle`** (group classes) — `subscriptionId` ref `Subscription` (required); `scheduleId` ref `GroupClassSchedule` (required, a charge-time snapshot, never rewritten by a later schedule change); `eventType` enum `initial`/`renewal`/`legacy` (required); `breakdown` (`monthlyFee` required, `prorated`, `proratedAmount`, `siblingDiscountApplied`, `siblingDiscountAmount`, `registrationFeeCharged`); `periodStart`/`periodEnd` (required). Query index `{subscriptionId, createdAt: -1}`. **Guard B** — unique partial index `{subscriptionId, periodStart}`, scoped to `status ∈ {pending, completed}` AND `subscriptionId: {$exists: true}` (the `$exists` scoping is what keeps this index from colliding with rows of a different shape, which have no `subscriptionId` field at all) — at most one non-failed charge per subscription per period, CKQ's fourth double-charge protection layer.

**Discriminator: `per_session`** (private lessons — absorbs the former standalone `PrivateClassCharge` collection) — `sessionId` ref `PrivateClassSession` (required); `enrollmentId` ref `PrivateClassEnrollment` (required). Unique partial index on `sessionId`, scoped to `status ∈ {pending, completed}` AND `sessionId: {$exists: true}` — a session may have at most one non-failed charge at a time; `failed` deliberately excluded so a retry is never blocked.

**Discriminator: `one_time_event`** (camps/meets — schema-only today, no consumer yet; both Services seeded `isActive: false`) — `eventId` (ObjectId, `refPath: 'eventModel'` — standard Mongoose polymorphism); `eventModel` enum `Camp`/`Meet`. Unique partial index on `{eventId, studentId}`, scoped to `status ∈ {pending, completed}` AND `eventId: {$exists: true}` — one non-failed payment per student per event.

## `Subscription` — implemented (Phase 7b)
| Collection | Key fields |
|---|---|
| `Subscription` | `studentId`, `scheduleId`, `parentId` refs; `status`; `cancelAtPeriodEnd`; `currentPeriodStart/End`; `nextBillingDate`; `lastChargeAmount`/`lastSiblingDiscountApplied` (record-keeping only — never read back as a source of truth); `registrationFeeCharged` (one-time fee actually charged at creation, `0` default — captured once, never re-read/re-charged by renewals or a later change to the fee setting); `firstChargeProrated` (Boolean, default `false` — permanent audit record of whether *this* subscription's first charge was prorated, see `Setting.prorationEnabled` below; never touched again, including by renewals) — the enrollment fact, kept as a separate collection/concern from `Registration` (the money fact) even though 1:1 today. **No unique index on `(studentId, scheduleId)`** — a student can legitimately re-register after a past cancellation; "no currently active enrollment" is a service-layer check, not a schema constraint. |

**Renewal + cancellation (Phase 9):** `POST /subscriptions/:id/cancel` sets `cancelAtPeriodEnd` only — `status` and roster access are untouched, access continues through the paid period. `backend/scripts/run-renewals.js` (`npm run renewals`, no real scheduler yet) processes due subscriptions one at a time via `renewOne`, which does its own fresh fetch before charging or finalizing. See `docs/decisions/001-in-house-subscription-billing.md` for the full design.

**Sibling discount (10%, Phase 8, in `calculateChargeAmount`):** dynamic lower-payer rule — whichever of two siblings has the live (never-cached) lower current price gets 10% off. Exact ties break deterministically by `studentId` comparison (prevents a double-discount if both siblings' charges are computed independently). Fully re-derived on every call, including future renewals — nothing about the discount is cached or trusted from a prior charge. **Known, accepted limitation:** two siblings' very first registrations at the exact same instant could each see "no active sibling yet" and neither gets the discount — would need a multi-document Mongo transaction to close; out of scope since real-world registration is always serial.

`POST /registrations` (parent-only) charges the saved card off-session via a Stripe `PaymentIntent` with a stable idempotency key (`initial-registration-{studentId}-{scheduleId}`) BEFORE creating anything — nothing is created unless the charge actually succeeds. No 3DS/`requires_action` handling (disclosed MVP limitation). On success, the student is added to the schedule's ongoing roster and backfilled into every already-generated future session (not just sessions generated from now on).

The charge-amount calculation lives in its own file, `backend/src/services/billing/calculateChargeAmount.service.js` — deliberately isolated so Phase 8 (sibling discount) can edit it in place and Phase 9 (renewal job) can reuse it without extraction.

## `Setting` — implemented (registration-fee plan)
| Collection | Key fields |
|---|---|
| `Setting` | Singleton (exactly one document, enforced by `setting.service.js` always querying/upserting via `findOne()`, not a unique-key index). `registrationFee` (Number, default `0`); `returningStudentGracePeriodMonths` (Number, default `0`); `prorationEnabled` (Boolean, default `false`) — **deprecated**, field kept on the schema but no longer read/written by any code path (see below). |

Superadmin-only (`GET`/`PATCH /api/v1/settings`) — same trust bar as `/audit-runs`, since these values change the charge on every future registration immediately, with no confirmation step. No caching — read fresh on every call, consistent with `calculateChargeAmount`'s "never cached" principle.

**Registration fee** (`backend/src/services/billing/registrationFee.service.js`): a one-time fee bundled into the same Stripe `PaymentIntent` as the first month's charge (one charge, the existing idempotency key) — never a second, separate charge. Never discounted by the sibling rule (a flat enrollment fee, not recurring tuition). `$0` (the default) means no charge to anyone until an admin explicitly sets a positive fee.

**Returning-student waiver**: if a student has a prior `Subscription` with `status: 'cancelled'`, and `now` is within `returningStudentGracePeriodMonths` of that subscription's `currentPeriodEnd` (when their access actually ended, not when cancellation was requested — see the two-stage cancellation note above), the fee is waived for this registration. `returningStudentGracePeriodMonths: 0` (the default) means the fee always applies, even to a returning student.

**Prorated first-month billing** (`backend/src/services/billing/proration.service.js`, originally
`docs/plans/prorated-first-month-billing-plan.md`, made unconditional by `docs/decisions/007-
calendar-month-billing.md`): every registration's first charge is prorated to the class days
remaining, this calendar month, at the student's level — `Setting.prorationEnabled` is deprecated;
proration is no longer optional, since a full-month charge for a partial calendar month would be an
overcharge under calendar-month billing (every subscription period now ends on the 1st).
`computeProration()` is the single function this math ever runs in — resolves every
`GroupClassSchedule` at the level, dedupes their `dayOfWeek` values, counts matching calendar days in
the registration month vs. remaining from the registration date, and returns a daily rate + prorated
amount + the calendar-month boundary (`firstOfNextMonth` of the registration date) that becomes the
first `Subscription.currentPeriodEnd`. That *result* (not the raw list price) is what feeds into
`calculateChargeAmount()`, unmodified — sibling-discount eligibility compares the prorated amount
against a sibling's own current rate. A level with zero configured schedules falls back to the full,
unprorated fee rather than dividing by zero, still anchored to the calendar-month boundary.

## `WebhookEvent` — implemented (Phase 11, scoped)
| Field | Type | Notes |
|---|---|---|
| `stripeEventId` | String | required, **unique** — the dedup key; Stripe redelivers events, this makes redelivery a safe no-op |
| `type` | String | required |
| `paymentIntentId`, `status` | String | not required — only meaningful for `payment_intent.*` events |

`POST /api/v1/webhooks/stripe` verifies Stripe's signature (registered with its own `express.raw()` middleware BEFORE the global `express.json()` — the raw body is required for signature verification and would otherwise be destroyed). Only records `payment_intent.succeeded`/`payment_intent.payment_failed`; other event types are acknowledged but not stored. Deliberately scoped down from full reconciliation — every charge in this project is synchronous (`off_session`/`confirm: true`, no 3DS), so this is a safety net for a narrow crash-recovery window, not something the core flow depends on.

## `CoachContract` — implemented (CKQ parity Phase 4, `backend/src/models/coachContract.model.js`)
| Field | Type | Notes |
|---|---|---|
| `serviceId` | ObjectId ref `Service` | required — always the 'private-lessons' Service today (CoachContract has no other consumer yet); set internally by `coachContract.service.js`'s `create()`, never accepted from the client |
| `coachId` | ObjectId ref `User` | required |
| `studentBillingRate` | Number | required, min 0 — $/HOUR billed to the parent |
| `coachCompensationRate` | Number | required, min 0 — $/hour paid to the coach; stored for audit/future payroll only, **no payout UI** (D11) |
| `sessionDurationMinutes` | Number | default 60, min 15 — the default slot length new schedules inherit |
| `effectiveFrom` | Date | default now |
| `isActive` | Boolean | default true |
| `notes` | String | optional |

Index: `{ coachId: 1, isActive: 1 }`. Creating a new contract for a coach deactivates their previous active one (service layer, not a schema constraint) — one active contract per coach. A contract is never edited or deleted once created — only deactivated — it's an immutable rate-audit record.

## `PrivateClassSchedule` — implemented (CKQ parity Phase 4)
| Field | Type | Notes |
|---|---|---|
| `coachId` | ObjectId ref `User` | required |
| `dayOfWeek` | Number 0–6 | required — `Date.getDay()` convention, matches `GroupClassSchedule` |
| `startTime` | String `"HH:mm"` | required |
| `durationMinutes` | Number | default 60, min 15 |
| `studentId` | ObjectId ref `User` | default null — **null = the slot is available** for self-registration |
| `enrollmentId` | ObjectId ref `PrivateClassEnrollment` | default null |
| `isActive` | Boolean | default true |

Indexes: `{ coachId: 1, isActive: 1 }`, `{ studentId: 1 }`. Duplicate rule (same `coachId` + `dayOfWeek` + `startTime`) is a service-level 409, not a unique index — a duplicate slot at the exact same coach/day/time is what the rule blocks, not a schema shape.

## `PrivateClassEnrollment` — implemented (CKQ parity Phase 4)
| Field | Type | Notes |
|---|---|---|
| `studentId`, `parentId`, `coachId` | ObjectId ref `User` | all required |
| `coachContractId` | ObjectId ref `CoachContract` | required — audit trail: which contract set the rate below |
| `agreedHourlyRate` | Number | required, min 0 — **pinned at self-registration time from the coach's contract, immutable afterward** (D7); a later contract-rate change affects only future enrollments |
| `status` | String enum | `active`, `cancelled` — default `active` (born active — D4, no admin-created-then-parent-accepts step) |
| `endDate` | Date | default null — set at cancellation; also the cutoff for the delivered-before-cancellation charge check |

## `PrivateClassSession` — implemented (CKQ parity Phase 4)
| Field | Type | Notes |
|---|---|---|
| `scheduleId` | ObjectId ref `PrivateClassSchedule` | required |
| `enrollmentId` | ObjectId ref `PrivateClassEnrollment` | required |
| `coachId`, `studentId`, `parentId` | ObjectId ref `User` | required — denormalized from the schedule/enrollment at generation time, since this is the money-relevant fact record and must stay correct even if the schedule/enrollment is later reassigned |
| `startDate`, `endDate` | Date | required — `endDate = startDate + the slot's durationMinutes` at generation time |
| `attendance` | String enum | `scheduled`, `attended`, `missed` — default `scheduled` |
| `markedBy`, `markedAt` | ObjectId ref `User` / Date | default null |

**Unique index `{ scheduleId: 1, startDate: 1 }`** — generator idempotency: one session per schedule per start instant, so re-running `generateSessions`/`extend-private-sessions.js` can never create a duplicate.

## `PrivateClassCharge` — RETIRED (`docs/plans/service-registry-unified-ledger-plan.md`)

Absorbed into the unified `Registration` ledger as the `per_session` discriminator — see the
`Registration` section above for the current field list and index. The standalone collection
was dropped by `scripts/lib/migrateToUnifiedLedger.js` after verifying every row copied across
(preserving `_id`, so a charge's identity never changes). Full charge-pipeline walkthrough
(three idempotency layers, the cancel-then-charge race guard, the four CKQ-BUG-FIXes) is
unchanged and still lives in `docs/features/private-class.md` — only the storage moved.

## `Spotlight` — implemented (public-site plan, GAP-2)
| Field | Type | Notes |
|---|---|---|
| `type` | String enum | `coach`, `student` — required |
| `name` | String | required — display name |
| `title` | String | optional, e.g. "Head Coach" |
| `body` | String | optional, one paragraph |
| `bullets` | [String] | default `[]`, schema-validated max 3 |
| `imageUrl` | String | optional — either a manually-pasted URL, or one returned by `POST /spotlights/upload-image` (uploads to Vercel Blob, admin/superadmin only) |
| `isPublished` | Boolean | default `false` |
| `order` | Number | default `0` — display order within a type |

Deliberately **not** linked to `User` by ObjectId — editorial content with a consent decision, kept out of the account model on purpose. See `docs/features/public-site.md`.
