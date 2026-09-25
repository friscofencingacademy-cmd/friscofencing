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
| `Location` | `name` (unique), `address`, `timezone` (default `America/Chicago`), `phone` (optional, default `''`, free-form), `email` (optional, default `''`, format-validated when non-empty — `docs/plans/frontend-polish-plan.md` PR 5.3) |
| `Level` | `name` (unique), `order` (unique, for sorting) |
| `GroupClass` | `name`, `levelId` ref, `locationId` ref, `capacity`. **No price reference** — `Price` (Phase 4) is looked up dynamically by level at billing time, not stored as a foreign key here. |
| `GroupClassSchedule` | `classId` ref, `coachId` ref (must be a `User` with `role: 'coach'`), `dayOfWeek` (0–6, `Date.getDay()` convention), `startTime`/`endTime` (`"HH:mm"`), `students` (enrolled roster, array of ObjectId) |
| `GroupClassSession` | `scheduleId` ref, `date` (**calendar-day sentinel** — a UTC-midnight `Date` with no real timezone meaning, built only via `dateShapes.js`'s `dateOnlyUTC`/`nextDateOnlyOnOrAfter`/`addDaysToDateOnly`, compared only against another sentinel like `todayDateOnly()`, rendered only with `timeZone: 'UTC'` — `docs/plans/utc-date-standard-plan.md`), `startsAt`/`endsAt` (**real UTC instants**, required — `date` + the schedule's `"HH:mm"` resolved in the academy timezone at generation time via `sessionInstantsFor`, the same shape `PrivateClassSession.startDate`/`endDate` store; every "has it started / is it upcoming" query reads `startsAt`, never `date` — `docs/plans/session-start-time-cutoff-plan.md`; re-resolved by `groupClassSchedule.service.js`'s `update()` for not-yet-started sessions when the schedule's times change), `students[].isPresent` (defaulted `false`) — unique on `(scheduleId, date)`, plus a non-unique index on `(scheduleId, startsAt)`. Generated synchronously (8-week initial window) when a schedule is created. Attendance marking: `PATCH .../attendance` — admin/superadmin can mark any session, a coach only sessions on their own assigned schedule (checked in the service against `schedule.coachId`, not by route-level role gating, since it's per-session); can only flip `isPresent` on existing roster entries, never add/remove them. |

Deleting a `Location` or `Level` still referenced by a `GroupClass` is rejected (409).

## `Holiday` — implemented (`docs/plans/holiday-blocking-plan.md`)
| Field | Type | Notes |
|---|---|---|
| `name` | String | required, **unique**, trimmed |
| `startDate` | Date | required — **calendar-day sentinel**, same shape as `GroupClassSession.date`, built only via `dateShapes.js`'s `dateOnlyUTC`, compared only against another sentinel |
| `endDate` | Date | required, inclusive — a one-day holiday has `startDate === endDate`. Range validated ≤31 days, no overlap with an existing holiday (409), enforced at the service layer, not the schema |

No `scope`/`locations` (single-location academy — CKQ's own Holiday has both), no `isMakeUpAllowed` (no billing interaction here — a deliberate simplification from CKQ, whose Holiday feeds its monthly-cost calculation), no soft-delete (hard delete like every other catalog model in this codebase — nothing else references a `Holiday` by id). Consumed read-only by `holiday.service.js`'s `getHolidaysInRange`/`findHolidayForDate` to: filter holiday-date sessions out of the parent trial/registration pickers (`groupClassSession.service.js`'s `listUpcomingByClass`), annotate `isHoliday`/`holidayName` on admin/coach session lists (`listBySchedule`/`getById`), and block attendance marking and the registration/trial-booking start-date guards (`resolveStartDate`, trial `create`) with a 400. Admin/superadmin only, on every route including list.

## `Price` — implemented
| Field | Type | Notes |
|---|---|---|
| `levelId` | ObjectId ref `Level` | required, **unique** — one price per level (fencing is in-person only, no online/in-person split) |
| `monthlyFee` | Number | required, min 0 |
| `registrationFee` | Number, nullable | optional per-level override of `Setting.registrationFee` (the academy-wide default), min 0. `null` (the default) means "inherit the academy-wide fee"; an explicit `0` means "this level charges no registration fee" — the two are deliberately distinct. See `registrationFee.service.js`'s `resolveRegistrationFee` (`docs/plans/per-level-registration-fee-plan.md`). |

## `TrialClass` — implemented
| Field | Type | Notes |
|---|---|---|
| `studentId` | ObjectId ref `User` | required, **unique** — one trial ever, platform-wide, backed by a service-layer pre-check + this index (same two-layer pattern as `Price.levelId`) |
| `sessionId` | ObjectId ref `GroupClassSession` | required — booking adds the student into this session's roster |

`POST /auth/register` is the platform's first public (unauthenticated) endpoint — parent self-signup. Students (`role: 'student'`) are created via `POST /students`; a parent's own `parentId` is forced server-side and cannot be overridden by the request body.

## `Visit` — the attendance ledger, every service (`backend/src/models/visit.model.js`, [ADR 010](./docs/decisions/010-universal-visit-ledger.md))

The single source of truth for "did this student attend this session," for group classes and private lessons alike. One row per student per session. Money never lives here (that is `Registration`). `visit.service.js` is the only writer.

| Field | Type | Notes |
|---|---|---|
| `studentId` | ObjectId ref `User` | required |
| `serviceId` | ObjectId ref `Service` | required — the business service the visit belongs to, resolved by `visit.service.js` from the Service `code` (`group-classes` / `private-lessons`), never caller-supplied. Rows predating ADR 010 were stamped by `scripts/backfill-visit-service.js`. |
| `groupClassSessionId` | ObjectId ref `GroupClassSession` | default null — set on a group visit |
| `groupClassScheduleId` | ObjectId ref `GroupClassSchedule` | default null — required when `groupClassSessionId` is set (denormalized for per-schedule history queries) |
| `privateClassSessionId` | ObjectId ref `PrivateClassSession` | default null — set on a private-lesson visit |
| `classType` | String enum | `regular`, `trial`, `private` — required. `private` exactly when `privateClassSessionId` is set. |
| `status` | String enum | `scheduled`, `attended`, `missed`, `cancelled` — default `scheduled` |
| `markedBy` / `markedVia` | ObjectId ref `User` / String enum `coach`, `admin` | default null |
| `isMakeupClass` | Boolean | default false — group walk-ins only |

A `pre('validate')` hook enforces exactly one session ref and a `classType` consistent with it. Uniqueness per (student, session) among non-cancelled rows is enforced by `visit.service.js`'s upserts, not an index, so a cancelled visit can be re-scheduled in place. Indexes: `{ studentId, groupClassSessionId }`, `{ groupClassSessionId, status }`, `{ studentId, groupClassScheduleId }`, `{ privateClassSessionId, status }`, `{ studentId, serviceId }`.

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
| `chargeMethod` | String enum | `card` (default) \| `manual` — how this charge was collected (`docs/plans/payment-airtight-plan.md` D5). Defaults `'card'` for every pre-existing row (no backfill needed); consumers branch on `=== 'manual'`, never `=== 'card'`. Set to `'manual'` only by `renewal.service.js`'s `recordManualPayment`. |
| `manualNote` | String | default null — required, non-empty (schema-validated) when `chargeMethod` is `'manual'`; the admin's own note on how the payment was collected outside Stripe |
| `recordedBy` | ObjectId ref `User` | default null — the superadmin who triggered this charge; set on a manual recording AND an admin-triggered card charge (audit only), null for the unscheduled cron's own calls |

**Mutation contract**, every row regardless of shape: immutable after insert except the `pending -> completed|failed` transition and retry's own updates to `attempt`/`stripePaymentIntentId`/`failureMessage`/`paidAt`/`status`.

**PDF invoice** (`docs/plans/manual-charge-and-pdf-invoice-plan.md` PR 2) — no new field or
collection. `GET /registrations/:id/invoice` (parent-own or admin/superadmin) regenerates a PDF
on demand from any `completed` row (either discriminator) via `invoice.service.js`; the same
generator attaches the PDF to the receipt email at charge time. `total` in the PDF is always
`row.amount` verbatim, never recomputed from `breakdown`.

**Discriminator: `subscription_cycle`** (group classes) — `subscriptionId` ref `Subscription` (required); `scheduleId` ref `GroupClassSchedule` (required, a charge-time snapshot, never rewritten by a later schedule change); `eventType` enum `initial`/`renewal`/`legacy` (required); `breakdown` (`monthlyFee` required, `prorated`, `proratedAmount`, `siblingDiscountApplied`, `siblingDiscountAmount`, `registrationFeeCharged`); `periodStart`/`periodEnd` (required — **calendar-day sentinels**, same shape/gate contract as `GroupClassSession.date` above; rendered in emails/invoices via `email/dates.js`'s `dateOnlyFull`, never `dateFull` — `docs/plans/utc-date-standard-plan.md`); `periodMonth` (String, required — `'YYYY-MM'`, derived from `periodStart`'s UTC calendar parts by a pre-validate hook, **never accepted from a caller**; `docs/plans/payment-airtight-plan.md` D7). Query index `{subscriptionId, createdAt: -1}`. **Guard B** — unique partial index `{subscriptionId, periodMonth}` (re-keyed from the exact `{subscriptionId, periodStart}` pair by the same plan — a prorated-from-today row anchors `periodStart` to a different day than a full-month row for the same calendar month, which the old exact-day key would not have caught), scoped to `status ∈ {pending, completed}` AND `subscriptionId: {$exists: true}` (the `$exists` scoping is what keeps this index from colliding with rows of a different shape, which have no `subscriptionId` field at all) — at most one non-failed charge per subscription per CALENDAR MONTH, across every charge pathway (cron, admin card charge either period, manual recording either period). Migrated via `scripts/migrate-period-month.js` (dry-run-first, backfills `periodMonth` + swaps the index, aborts with zero writes on any detected collision).

**Discriminator: `per_session`** (a private-lesson PURCHASE — [ADR 011](./docs/decisions/011-private-per-session-booking.md); absorbed the former standalone `PrivateClassCharge` collection) — `sessionId` ref `PrivateClassSession` (required — the booking the purchase came with); `enrollmentId` ref `PrivateClassEnrollment` (required — the purchase); `quantity` (Number ≥ 1, required); `unitPrice` (Number ≥ 0, required — the single-session price at purchase). `amount` = the chosen option's total (the single-session price, or the coach's fixed pack price — `docs/plans/coach-pack-pricing-plan.md`), set at purchase and never re-derived. **Savings are not stored**: always derived as `quantity × unitPrice − amount` by `privateClassPricing.js`'s `purchaseBreakdown`. The former `discountPercent` field was removed (no row ever had a non-zero value — plan §4). Unique partial indexes on `sessionId` and on `enrollmentId`, each scoped to `status ∈ {pending, completed}` AND the field `$exists` — one non-failed charge per booking (the money dedup) and per purchase; `failed` excluded so a failed attempt never blocks a new one. A booking paid with an existing credit writes no row.

**Discriminator: `one_time_event`** (camps/meets — schema-only today, no consumer yet; both Services seeded `isActive: false`) — `eventId` (ObjectId, `refPath: 'eventModel'` — standard Mongoose polymorphism); `eventModel` enum `Camp`/`Meet`. Unique partial index on `{eventId, studentId}`, scoped to `status ∈ {pending, completed}` AND `eventId: {$exists: true}` — one non-failed payment per student per event.

## `Subscription` — implemented (Phase 7b)
| Collection | Key fields |
|---|---|
| `Subscription` | `studentId`, `scheduleId`, `parentId` refs; `status`; `cancelAtPeriodEnd`; `currentPeriodStart/End`/`nextBillingDate` (**calendar-day sentinels** — same shape/gate contract as `GroupClassSession.date`, `docs/plans/utc-date-standard-plan.md`); `lastChargeAmount`/`lastSiblingDiscountApplied` (record-keeping only — never read back as a source of truth; `lastChargeAmount` stays `null` until the FIRST successful charge, which distinguishes "never successfully paid, currently in dunning" from a renewal's dunning, where it reflects the last successful period — `docs/decisions/008-registration-create-pending-first.md`); `registrationFeeCharged` (one-time fee actually charged at creation, `0` default — captured once, never re-read/re-charged by renewals or a later change to the fee setting); `firstChargeProrated` (Boolean, default `false` — permanent audit record of whether *this* subscription's first charge was prorated; never touched again, including by renewals) — the enrollment fact, kept as a separate collection/concern from `Registration` (the money fact) even though 1:1 today. **Guard A — unique partial index on `{studentId}` alone, scoped to `status: 'active'`** (`docs/decisions/005-one-active-subscription-per-student.md`; tightened from `{studentId, scheduleId}` — a student may hold at most ONE active group-class subscription at all, on any schedule; cancelled docs excluded, so re-registration after a past cancellation still works). |

**Renewal + cancellation (Phase 9):** `POST /subscriptions/:id/cancel` sets `cancelAtPeriodEnd` only — `status` and roster access are untouched, access continues through the paid period. `backend/scripts/run-renewals.js` (`npm run renewals`, no real scheduler yet) processes due subscriptions one at a time via `renewOne`, which does its own fresh fetch before charging or finalizing. See `docs/decisions/001-in-house-subscription-billing.md` for the full design.

**Sibling discount (10%, Phase 8, in `calculateChargeAmount`):** dynamic lower-payer rule — whichever of two siblings has the live (never-cached) lower current price gets 10% off. Exact ties break deterministically by `studentId` comparison (prevents a double-discount if both siblings' charges are computed independently). Fully re-derived on every call, including future renewals — nothing about the discount is cached or trusted from a prior charge. **Known, accepted limitation:** two siblings' very first registrations at the exact same instant could each see "no active sibling yet" and neither gets the discount — would need a multi-document Mongo transaction to close; out of scope since real-world registration is always serial.

`POST /registrations` (parent-only) charges the saved card off-session via a Stripe `PaymentIntent` with a stable idempotency key (`initial-registration-{studentId}-{scheduleId}`) BEFORE creating anything — nothing is created unless the charge actually succeeds. No 3DS/`requires_action` handling (disclosed MVP limitation). On success, the student is added to the schedule's ongoing roster and backfilled into every already-generated future session (not just sessions generated from now on).

The charge-amount calculation lives in its own file, `backend/src/services/billing/calculateChargeAmount.service.js` — deliberately isolated so Phase 8 (sibling discount) can edit it in place and Phase 9 (renewal job) can reuse it without extraction.

## `Setting` — implemented (registration-fee plan)
| Collection | Key fields |
|---|---|
| `Setting` | Singleton (exactly one document, enforced by `setting.service.js` always querying/upserting via `findOne()`, not a unique-key index). (The former `privateClassPackages` field was removed — private-lesson packs live on each `CoachContract.privateLessonPacks`, `docs/plans/coach-pack-pricing-plan.md` D10.) `registrationFee` (Number, default `0`) — the **academy-wide default**, overridden per level by `Price.registrationFee` when set (`docs/plans/per-level-registration-fee-plan.md`); `returningStudentGracePeriodMonths` (Number, default `0`); `prorationEnabled` (Boolean, default `false`) — **deprecated**, field kept on the schema but no longer read/written by any code path (see below). |

Superadmin-only (`GET`/`PATCH /api/v1/settings`) — same trust bar as `/audit-runs`, since these values change the charge on every future registration immediately, with no confirmation step. No caching — read fresh on every call, consistent with `calculateChargeAmount`'s "never cached" principle.

**Registration fee** (`backend/src/services/billing/registrationFee.service.js`): a one-time fee bundled into the same Stripe `PaymentIntent` as the first month's charge (one charge, the existing idempotency key) — never a second, separate charge. Never discounted by the sibling rule (a flat enrollment fee, not recurring tuition). Two-source resolution (`docs/plans/per-level-registration-fee-plan.md`): the registering class's level's own `Price.registrationFee` wins when set — including an explicit `0` — and `Setting.registrationFee` (the academy-wide default) applies only when the level's fee is unset. `$0` (the default on both) means no charge to anyone until an admin explicitly sets a positive fee somewhere.

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
| `effectiveTo` | Date | unset while current; when the version was replaced or deactivated (`docs/plans/coach-pack-pricing-plan.md` §8) |
| `endReason` | String enum `revised`/`deactivated` | unset while current; `revised` = replaced by an edit (the next version's `effectiveFrom` equals this `effectiveTo`) |
| `privateLessonPacks` | `[{ _id, sessionDurationMinutes ≥ 15, quantity ≥ 2, price ≥ 0.01 }]` | default `[]` — this coach's fixed-price private-lesson packs (`docs/plans/coach-pack-pricing-plan.md`). A pack is offered only on slots of its own length. Its `_id` is the `packId` a purchase request carries. Validated only by `privateClassPricing.js`'s `validatePacks`: whole-cent price inside the band `[ceil(subtotal × 0.5), subtotal − $0.01]` where `subtotal = quantity × single-session price`; no duplicate length + quantity. |

Index: `{ coachId: 1, isActive: 1 }`. **Versioned** (`docs/plans/coach-pack-pricing-plan.md` §8): a document is never changed in place. Add creates a coach's first current version (409 if one exists); Edit ends the current version (`isActive: false`, `effectiveTo`, `endReason: 'revised'`) and creates the next from the same instant, with new pack ids; Deactivate ends it with no successor. One active version per coach, enforced in the service layer. Every purchase's `coachContractId` points at the exact version it was bought under, and a purchase whose quoted version is no longer current is refused. Past purchases are unaffected by any edit — each one's price is pinned on its `Registration` row.

## `PrivateClassSchedule` — availability rule ([ADR 011](./docs/decisions/011-private-per-session-booking.md))
| Field | Type | Notes |
|---|---|---|
| `coachId` | ObjectId ref `User` | required |
| `dayOfWeek` | Number 0–6 | required — `Date.getDay()` convention, matches `GroupClassSchedule` |
| `startTime` | String `"HH:mm"` | required, 24h Central wall-clock, format-validated |
| `durationMinutes` | Number | default 60, min 15 |
| `startDate`, `endDate` | Date | required — **calendar-day sentinels**, inclusive bookable range; `endDate >= startDate` validated |
| `isActive` | Boolean | default true — `false` = retired (removed after it had bookings, so their `scheduleId` stays valid) |

Indexes: `{ coachId, isActive }`, `{ coachId, dayOfWeek, startTime }`. No student is ever stored on a rule. Created in bulk (one per weekday × slot in a time window). Overlap rule (same coach + weekday, intersecting time window AND date range) is a service-level 409 — an index cannot express range intersection.

## `PrivateClassEnrollment` — one purchase of credits (ADR 011)
| Field | Type | Notes |
|---|---|---|
| `studentId`, `parentId`, `coachId` | ObjectId ref `User` | all required |
| `coachContractId` | ObjectId ref `CoachContract` | required — which contract priced the purchase |
| `agreedHourlyRate` | Number | required, pinned at purchase, immutable |
| `sessionDurationMinutes` | Number | required, min 15 — a credit books only a slot of this length |
| `quantity` | Number | required, min 1 |
| `sessionsUsed` | Number | required, default 0, validated `<= quantity`; moves only through atomic guarded `$inc` |
| `status` | String enum | `pending` (charge unresolved), `active` (paid — holds credits), `failed` (declined or abandoned) |

Remaining credits = `quantity - sessionsUsed`, always derived. There is deliberately no price or discount field (the former `discountPercent` was removed, `docs/plans/coach-pack-pricing-plan.md` D5) — what was paid lives only on its `Registration` row; `scripts/check-private-credit-ledger.js` reconciles the two. Indexes: `{ studentId, coachId, status, createdAt }` (oldest-first credit lookup), `{ parentId, createdAt }`.

## `PrivateClassSession` — one booking (ADR 011)
| Field | Type | Notes |
|---|---|---|
| `scheduleId` | ObjectId ref `PrivateClassSchedule` | required |
| `enrollmentId` | ObjectId ref `PrivateClassEnrollment` | required — the purchase whose credit it uses |
| `coachId`, `studentId`, `parentId` | ObjectId ref `User` | required — the booking names its student |
| `startDate`, `endDate` | Date | required — **real instants** built only by `dateShapes.js`'s `combineDayAndTimeInTZ` from the booked day + the rule's `startTime` |
| `status` | String enum | `pending`, `confirmed`, `cancelled`, `released` |
| `releaseReason` | String enum, nullable | `payment_failed`, `abandoned` — default null |
| `cancelledAt`, `cancelledBy` | Date / ObjectId ref `User` | default null |

**Unique partial index `{ scheduleId, startDate }` where `status ∈ {pending, confirmed}`** — the atomic slot claim; a cancelled or released booking frees the slot and keeps its history. Also `{ coachId, startDate }`, `{ enrollmentId }`, `{ parentId, startDate }`. No attendance field — attendance is the `Visit`.

## `PrivateClassCharge` — RETIRED (`docs/plans/service-registry-unified-ledger-plan.md`)

Absorbed into the unified `Registration` ledger as the `per_session` discriminator — see the
`Registration` section above for the current field list and index. The standalone collection
was dropped by `scripts/lib/migrateToUnifiedLedger.js` after verifying every row copied across
(preserving `_id`, so a charge's identity never changes). Since ADR 011 a `per_session` row is a
purchase, not a per-attended-session charge — see `docs/features/private-class.md`.

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

**No longer rendered on the home page** (2026-08-29) — `TeamBand`/`SpotlightCard` were replaced there by `TestimonialsSection` below. The model, admin CRUD, `/coaches` page, and backend routes are all untouched; only the home page stopped using coach/student spotlights. See `docs/plans/wordpress-ui-alignment-plan.md`'s testimonials addendum.

## `Testimonial` — implemented (2026-08-29, replaces Spotlight on the home page)
| Field | Type | Notes |
|---|---|---|
| `quote` | String | required |
| `authorName` | String | required |
| `caption` | String | optional — short handwriting-style pull-quote shown under the photo, e.g. "More than a sport, an environment for growth" |
| `imageUrl` | String | optional — either a manually-pasted URL, or one returned by `POST /testimonials/upload-image` (uploads to Vercel Blob, admin/superadmin only) |
| `isPublished` | Boolean | default `false` |
| `order` | Number | default `0` — display order among published testimonials |

Same standalone, hand-published pattern as `Spotlight` (not linked to `User` by ObjectId). `GET /testimonials/public` (no auth) returns published testimonials only, ordered, as a thin `{quote, authorName, caption?, imageUrl?}` projection. See `docs/features/public-site.md` and `docs/features/admin.md`.
