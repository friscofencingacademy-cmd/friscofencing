# Implementation plan: Service registry + unified two-dimension payment ledger

**Status:** Approved for implementation. Written 2026-08-27 (owner-directed architecture
decision, superseding the earlier "unified ledger via per-service discriminators" idea discussed
the same day). **Builder: intended for a Sonnet implementation session.** Read §7 (Builder
instructions) before touching any file.

**Testing strategy:** this repo HAS one — `docs/TESTING_STRATEGY.md`. It governs every test in
this plan (layers, real `mongodb-memory-server`, real Stripe TEST-mode for billing suites, MSW on
the frontend, no raw index/E11000 assertions, date rules, `TZ=UTC`). Do not invent conventions;
§5 below flags the specific traps.

---

## 0. Context and the two decisions this plan implements

Frisco Fencing offers multiple services — group classes, private lessons, and (real but not yet
built in software) **camps** and **meets**. Two owner decisions:

1. **A `Service` registry exists**, like CKQ's `service.model.js` — but with two deliberate
   fixes over CKQ (see D1): referenced by **id/stable code**, never by display-name string, and
   carrying its own declared billing shape.
2. **One immutable payment ledger** — `Registration` — for ALL services. `PrivateClassCharge`
   (the separate private-lesson ledger) is absorbed and retired. Every charge in the business is
   one row in one collection.

**The key architectural insight (owner + review, 2026-08-27): a row's SHAPE and a row's SERVICE
are two different dimensions, and CKQ conflates them.** CKQ discriminates its ledger per-service
(`'Group Class'`, `'Private Class'` — display-name strings as discriminator keys), so every new
service needs a new near-duplicate sub-schema. Frisco separates them:

- **`serviceId`** (on every ledger row) — the *business* dimension: which offering the money
  belongs to. Reporting, revenue-by-service, future QBO mapping.
- **`billingShape`** (the Mongoose discriminator key) — the *structural* dimension: which fields
  and dedup index apply. There are only three shapes, ever: `subscription_cycle`,
  `per_session`, `one_time_event`.

Camps and meets prove the factoring: different services, same shape (`one_time_event`). Adding
meets once camps exist = one new `Service` row, **zero schema changes**.

**Source-of-truth doctrine (unchanged, extended):** enrollment facts and money never share a
document.

| Service | Enrollment fact (who's in) | Money (`Registration` rows) |
|---|---|---|
| Group classes | `Subscription` | `subscription_cycle` |
| Private lessons | `PrivateClassEnrollment` + slot pointers | `per_session` (absorbs `PrivateClassCharge`) |
| Camps / meets (future) | a future enrollment doc — NEVER the ledger row itself (CKQ violates this for camps; we deliberately do not import that) | `one_time_event` |

---

## 1. Design decisions

### D1 — `Service` model (`backend/src/models/service.model.js`, new)

```js
const BILLING_SHAPES = ['subscription_cycle', 'per_session', 'one_time_event'];

{
  // Stable machine key — the ONLY thing code ever branches on or looks up by.
  // Lowercase-kebab, unique. Deliberately NOT a schema enum: adding a service
  // must be a seed-data change, not a schema change.
  code: { type: String, required: true, unique: true, trim: true,
          match: /^[a-z0-9]+(-[a-z0-9]+)*$/ },
  // Display only — freely renameable with zero data migration (the fix for
  // CKQ's name-string-as-key wart).
  name: { type: String, required: true, trim: true },
  // Which ledger discriminator this service's charges use. Enum'd — shapes
  // ARE a code-level concept (each has a sub-schema + dedup index).
  billingShape: { type: String, enum: BILLING_SHAPES, required: true },
  isActive: { type: Boolean, default: true },
}
// timestamps: true. No isDeleted — this repo has no soft-delete convention,
// and services are near-static config rows, not user data.
```

Export `BILLING_SHAPES` from the model (single definition — the Registration base schema imports
it, never redeclares it).

### D2 — Seed data (four services, two dormant)

| code | name | billingShape | isActive |
|---|---|---|---|
| `group-classes` | Group Classes | subscription_cycle | true |
| `private-lessons` | Private Lessons | per_session | true |
| `camps` | Camps | one_time_event | **false** (no camp feature built yet) |
| `meets` | Meets | one_time_event | **false** (ditto) |

Seeding follows the repo's script convention (`scripts/lib/*.js` + thin wrapper —
`seedSuperadmin` is the precedent): `backend/scripts/lib/seedServices.js` exporting
`seedServices()` — **idempotent upsert by `code`** (re-running corrects `name`/`billingShape`
drift back to this canonical list, never duplicates, never flips `isActive` — that's an admin/
owner action, not a seed concern) — plus wrapper `backend/scripts/seed-services.js`, and a new
npm script `"seed:services"`. **Also wire `seedServices()` into
`scripts/lib/refreshStagingData.js`'s sequence — as the FIRST step after the wipe, BEFORE the
legacy import** (the import writes ledger rows from PR B onward, which need `serviceId` — see
D5.4 and trap 3) — a staging refresh
that leaves zero Service rows would break every registration; this is exactly the
"new collections keep going missing from reset/refresh scripts" failure mode this repo has
already been bitten by (see the orphaned-coach plan's findings on `reset-customer-data.js`).

### D3 — Service catalog accessor (`backend/src/services/serviceCatalog.service.js`, new)

One function to start: `getServiceByCode(code)` — fresh read every call (no module-level cache;
ADR 001's "re-verified every time" convention, same as `setting.service.js`'s own documented
reasoning), **throws a 500-shaped error if the service is missing** (fail closed: a missing
Service row is a deployment/seed defect, never a silently-skipped charge) and a 409
`conflictError` if `isActive: false` when the caller requires an active service. Charge-path
callers pass `{ requireActive: true }`; read/report paths don't.

### D4 — `Registration` restructured: shared base + three shape discriminators

`backend/src/models/registration.model.js` is reorganized (the schema shipped in
`registration-ledger-plan.md` PR 1 moves its group-specific fields down into a discriminator —
that schema is a day old and PR 2/3 of that plan are unbuilt, which is exactly why now is the
cheap moment).

**Base schema** (options: `{ discriminatorKey: 'billingShape', timestamps: true }`) — the
universal, immutable money contract:

```js
{
  serviceId: { type: ObjectId, ref: 'Service', required: true, index: true },
  studentId: { type: ObjectId, ref: 'User', required: true },
  parentId:  { type: ObjectId, ref: 'User', required: true },
  status:    { type: String, enum: ['pending', 'completed', 'failed'], required: true },
  amount:    { type: Number, required: true },
  stripePaymentIntentId: { type: String, default: null },
  failureMessage:        { type: String, default: null },
  attempt:               { type: Number, default: 1 },
  paidAt:                { type: Date, default: null },
  backfilled:            { type: Boolean, default: false },
}
```

The mutation contract from the ledger plan's D1 lives here, stated once in the base schema's
header comment: rows are immutable after insert except `pending → completed|failed` and retry's
updates to `attempt`/`stripePaymentIntentId`/`failureMessage`/`paidAt`/`status`.

**Discriminator 1 — `SubscriptionCycleRegistration`** (value `'subscription_cycle'`), everything
group-specific from the PR 1 schema, unchanged semantics:

```js
{
  subscriptionId: { type: ObjectId, ref: 'Subscription', required: true },
  scheduleId:     { type: ObjectId, ref: 'GroupClassSchedule', required: true },
  eventType:      { type: String, enum: ['initial', 'renewal', 'legacy'], required: true },
  breakdown: { /* identical to PR 1: monthlyFee(required), prorated, proratedAmount,
                  siblingDiscountApplied, siblingDiscountAmount, registrationFeeCharged */ },
  periodStart: { type: Date, required: true },
  periodEnd:   { type: Date, required: true },
}
```

Indexes (defined on the discriminator schema; `$exists` scoping follows CKQ's own
`unique_subscription_billingMonth_active` precedent so base/other-shape rows can never collide
on missing keys):
- Guard B unique partial: `{ subscriptionId: 1, periodStart: 1 }`, unique, partial on
  `{ status: { $in: ['pending','completed'] }, subscriptionId: { $exists: true } }`.
- Query index `{ subscriptionId: 1, createdAt: -1 }` (retry's most-recent-failed lookup — carried
  over from PR 1).

**Discriminator 2 — `PerSessionRegistration`** (value `'per_session'`) — `PrivateClassCharge`'s
fields, absorbed:

```js
{
  sessionId:    { type: ObjectId, ref: 'PrivateClassSession', required: true },
  enrollmentId: { type: ObjectId, ref: 'PrivateClassEnrollment', required: true },
}
```

Index: `{ sessionId: 1 }`, unique, partial on
`{ status: { $in: ['pending','completed'] }, sessionId: { $exists: true } }` — byte-for-byte the
guarantee `privateClassCharge.model.js`'s index gives today ('failed' excluded so a failed charge
never blocks retry), just living on the unified collection.

**Discriminator 3 — `OneTimeEventRegistration`** (value `'one_time_event'`) — **schema-only in
this plan; zero consumers until camps/meets are built.** Defined now so the architecture is
complete and a future camps PR only adds features, never reshapes the ledger:

```js
{
  eventId:    { type: ObjectId, required: true, refPath: 'eventModel' },
  eventModel: { type: String, enum: ['Camp', 'Meet'], required: true },
}
```

Index: `{ eventId: 1, studentId: 1 }`, unique, partial on
`{ status: { $in: ['pending','completed'] }, eventId: { $exists: true } }` — one non-failed
payment per student per event. (`refPath` is standard Mongoose polymorphism; the referenced
models not existing yet is fine — refs resolve only at populate time.)

**Write-time pairing validation (service layer, not schema):** every ledger write resolves its
service via `getServiceByCode()` and asserts `service.billingShape` matches the discriminator
being written — a mismatch throws before any insert. This is what keeps the two dimensions from
silently drifting.

### D5 — Consumer rewiring (behavior-preserving — no business-logic changes)

1. **`registration.service.js` `create()`** — creates via `SubscriptionCycleRegistration` with
   `serviceId` from `getServiceByCode('group-classes', { requireActive: true })`. Everything
   else from the ledger plan's D3 is unchanged.
2. **`privateClassSession.service.js`** (`chargeSession`, `retryCharge`) — every
   `PrivateClassCharge` read/write becomes `PerSessionRegistration`, `serviceId` from
   `getServiceByCode('private-lessons', { requireActive: true })`. **All eleven steps of the
   documented charge pipeline (`docs/features/private-class.md` §"Charge pipeline") keep their
   exact semantics**: Layer-1 pre-check, Layer-2 E11000 catch on the (relocated) partial unique
   index, Layer-3 suffixed Stripe idempotency key `pcs_${sessionId}_${attempt}`, cancel-then-
   charge fresh-fetch guard, failed-status retry with attempt bump. Only the model changes.
3. **`privateClassEnrollment.service.js`** — `listMine`'s last-10-charges query becomes a
   `Registration` query on `{ enrollmentId, billingShape: 'per_session' }` (or via the
   discriminator model, which auto-scopes — builder's choice, be consistent).
4. **`scripts/lib/runLegacyImport.js`** — its ledger-row write (added in ledger PR 1) becomes a
   `SubscriptionCycleRegistration` create with `serviceId`; the group-classes service must be
   seeded by the time it runs (refreshStagingData ordering: seed services BEFORE the import —
   adjust the D2 wiring accordingly: `seedServices` runs first in the refresh sequence, not
   after superadmin).
5. **`CoachContract`** gains `serviceId` (ref Service, required). The contract-create service
   path sets it to the `private-lessons` service internally — **the API request shape does not
   change** (no client sends serviceId yet; when a second coach-facing service exists, the route
   can start accepting it). Existing contract docs are backfilled by the migration (D6).
6. **API response compatibility:** controllers keep their existing response key names (e.g.
   enrollment `charges`) — the rows now come from the unified ledger but the JSON shape is a
   superset (adds `billingShape`, `serviceId`), so **zero frontend behavior changes are
   required**. `frontend/lib/types.ts`'s `PrivateClassChargeRow` stays (it describes the same
   response), optionally gaining the new fields as optional properties. `tsc --noEmit` is the
   arbiter — if it's clean with no frontend edits, make none beyond the optional additions.
7. **`backend/src/models/privateClassCharge.model.js` is deleted** once nothing imports it.
   `backend/src/utils/privateClassPricing.js`'s header comment references it — update the
   comment, not the logic.
8. **`scripts/audit-reset.js`** — already deletes `Registration` by `studentId`, which now
   covers private charges automatically; if it separately deletes `PrivateClassCharge` (grep to
   check), remove that.

### D6 — Migration script (`scripts/lib/migrateToUnifiedLedger.js` + wrapper `scripts/migrate-to-unified-ledger.js`)

Repo convention (lib + thin wrapper, dry-run default, `--live` to apply). Steps, in order:

1. **Precondition:** all four Service rows exist (call `seedServices()` first, inside the
   script — idempotent, so this is safe and removes an ordering footgun).
2. **Stamp existing group rows:** every `registrations` doc missing `billingShape` gets
   `$set: { billingShape: 'subscription_cycle', serviceId: <group-classes id> }` via the raw
   collection (`updateMany`, bypassing validation — the docs already satisfy the discriminator's
   fields; they were written by ledger PR 1's schema).
3. **Copy private charges:** every `privateclasscharges` doc is inserted into `registrations`
   **preserving its `_id`** (this makes re-runs trivially idempotent — an already-copied row's
   insert fails E11000 on `_id` and is skipped-and-counted, never duplicated), with
   `billingShape: 'per_session'`, `serviceId: <private-lessons id>`, and its
   `sessionId`/`enrollmentId`/`parentId`/`studentId`/`amount`/`status`/
   `stripePaymentIntentId`/`attempt`/`failureMessage`/`paidAt`/`createdAt`/`updatedAt` carried
   over verbatim.
4. **Backfill `CoachContract.serviceId`** to the private-lessons id on every doc missing it.
5. **Verify:** source charge count == (copied + already-present) count; per-status totals match
   between source and destination `per_session` rows; zero `registrations` docs remain without
   a `billingShape`. Any mismatch → report and **abort without dropping anything**.
6. **Drop `privateclasscharges`** — only in `--live` mode AND only when step 5 verified clean in
   the same run. The printed report (counts per step, per status) is the audit record of the
   move.

### D7 — Deliberate non-goals (do not build; documented so they don't read as gaps)

- **No coach `serviceEligibility`** (CKQ-style) — the trigger to add it is a second coach-facing
  service actually existing. Noted, deferred.
- **No camp/meet features** — discriminator 3 is schema-only. When camps get built they get
  their own enrollment-fact model per the §0 doctrine table.
- **No admin Service CRUD UI** — four near-static rows managed by seed script; an admin UI is
  warranted only when services change often enough that a deploy-time seed edit is a bottleneck.
- **No change to the three charge-dedup layers, pricing utils, proration, sibling discount, or
  any dollar computation** — this plan moves where money rows LIVE, never how amounts are
  computed.

---

## 2. Interaction with the other active plans (sequencing is load-bearing)

- **`docs/plans/registration-ledger-plan.md`** — PR 1 (shipped) built the group ledger schema
  this plan now reshuffles. **This plan lands BEFORE that plan's PR 2 and PR 3** (renewal
  sequencing, retry/dunning), so they get built once, against the final discriminated shape.
  When executing that plan's PR 2/3 afterward, read its specs with this substitution: "create a
  Registration row" = "create a `SubscriptionCycleRegistration` row with `serviceId`"; every
  index/dedup reference already matches D4 above. Update that doc's status header when this plan
  ships (see §6).
- **`docs/plans/orphaned-coach-reference-fix-plan.md`** — orthogonal (it touches populate
  guards and delete guards, not charge storage). Either order works; if it lands after this
  plan, nothing in it changes.

---

## 3. PR breakdown (two PRs, in order)

### PR A — Service registry (additive, standalone, zero behavior change)

1. `backend/src/models/service.model.js` (D1).
2. `backend/scripts/lib/seedServices.js` + `backend/scripts/seed-services.js` + npm script (D2).
3. `refreshStagingData.js` wiring — `seedServices()` FIRST in its sequence (D2 + D5.4).
4. `backend/src/services/serviceCatalog.service.js` (D3).
5. Tests per §4 PR A.
6. `DATABASE_SCHEMA_DOCUMENTATION.md` — Service collection section.

Nothing reads the registry yet — this PR is safe to ship alone and proves the seed path on
staging before any money code depends on it.

### PR B — Unified ledger restructure + migration + rewire

1. `registration.model.js` restructure (D4) — base + three discriminators.
2. Consumer rewiring (D5.1–5.3, 5.5–5.8) + `runLegacyImport.js` (D5.4).
3. `scripts/lib/migrateToUnifiedLedger.js` + wrapper (D6).
4. Delete `privateClassCharge.model.js`.
5. Tests per §4 PR B (including the fixture sweep — see the trap in §5).
6. Docs per §6.

Deploy order for PR B on any environment: deploy code → run `migrate-to-unified-ledger.js`
(dry-run, review, `--live`) → verify. The partial unique indexes' `$exists` scoping means the
index builds are safe against pre-migration data.

---

## 4. Test plan

Per `docs/TESTING_STRATEGY.md`. The overriding rule for PR B: **the private-class charge
pipeline's existing test suite is the spec** — those tests (idempotent double-mark, E11000 race,
cancel-then-charge race, declined-card retry with fresh idempotency key, ownership guard) must
all pass against the new model with their assertions' SEMANTICS unchanged. Rewiring an assertion
from `PrivateClassCharge.findOne` to the unified ledger is expected; weakening what it proves is
not.

### PR A tests

`tests/scripts/lib/seedServices.test.js` (new; `seedSuperadmin.test.js` is the sibling pattern):
- Fresh DB → creates exactly the four canonical rows (codes, names, shapes, camps/meets
  inactive).
- Idempotent: second run creates nothing, duplicates nothing.
- Drift correction: manually mangle a `name` and a `billingShape`, re-run, both restored;
  a manually-flipped `isActive` is NOT restored (owner state, not seed state).

`tests/services/serviceCatalog.service.test.js` (new):
- `getServiceByCode` returns the seeded doc; missing code throws (fail-closed);
  `requireActive: true` against an inactive service → 409-shaped error; without the flag,
  inactive is returned fine.
- Freshness: update a service mid-test, next call sees the change (no cache).

`tests/scripts/lib/refreshStagingData.test.js` (extend): the composed sequence now seeds
services, and seeds them BEFORE the legacy import runs.

### PR B tests

`tests/routes/registration.routes.test.js` (extend): the happy-path ledger-row assertions gain
`billingShape: 'subscription_cycle'` and a `serviceId` matching the seeded group-classes
service. (Suite seed helpers must seed services — see §7.)

`tests/routes/privateClassSession.routes.test.js` (rewire, semantics intact): every existing
charge-pipeline test re-pointed at the unified ledger; add one assertion to the happy-path
charge test that the row carries `billingShape: 'per_session'` + the private-lessons
`serviceId`, and one cross-shape sanity: a session charge and a group registration for the same
family coexist in one collection and are distinguishable by `billingShape`/`serviceId`.

`tests/routes/privateClassEnrollment.routes.test.js` (extend): `listMine` still returns the
last-10 `charges` with an unchanged response shape (the frontend-compat guarantee, D5.6, proven
by test).

`tests/services/renewal.service.test.js` + every other suite whose fixtures create Registration
docs (`subscription.service.test.js`'s `enroll()` helper, `user.service.test.js`,
`user.routes.test.js`, `runLegacyImport.test.js`, `migrateRegistrationsToLedger.test.js`):
fixtures updated to create via the discriminator with a seeded `serviceId` — see §5's trap.

`tests/scripts/lib/migrateToUnifiedLedger.test.js` (new):
- Dry run: reports everything, writes nothing, drops nothing (DB byte-identical after).
- Live: pre-migration-shaped group rows (inserted via raw collection, no `billingShape`) get
  stamped; `privateclasscharges` fixtures (raw-inserted) are copied with `_id`/status/PI
  id/attempt/`paidAt`/timestamps preserved; `CoachContract` docs backfilled; source collection
  dropped only after verification; per-status counts in the report match.
- Idempotent re-run: second live run copies nothing, duplicates nothing, reports
  already-present counts.
- Abort path: seed a deliberate count mismatch (e.g. a pre-existing conflicting `per_session`
  row) → script reports and does NOT drop the source collection.

Frontend: **no behavioral tests to add** (D5.6 keeps response shapes compatible) — the gate is
the full existing suite + `tsc --noEmit` + `npm run build`, all clean.

### Verification (each PR)

```
cd backend  && TZ=UTC npm test
cd frontend && TZ=UTC npm test        # PR B only
cd frontend && npx tsc --noEmit && npm run build   # PR B only
```

Also re-measure coverage (`TZ=UTC npm test -- --coverage`, 80% statements floor) and update
`docs/TEST_COVERAGE.md` per PR.

---

## 5. Known traps (read before writing code)

1. **Every existing test fixture that does `Registration.create(...)` breaks** the moment the
   base schema requires `serviceId` and the group fields move into a discriminator. The sweep:
   grep `backend/tests` for `Registration.create` and `new Registration` (this plan's author
   found them in `subscription.service.test.js`, `user.service.test.js`, `user.routes.test.js`,
   plus the routes/renewal suites' assertions and both `scripts/lib` test files) — each needs a
   seeded service + creation via the right discriminator model. Prefer one shared
   `seedServices()` call in each affected suite's setup (the lib function works against the test
   DB directly) over hand-built Service fixtures.
2. **Discriminator + partial-index scoping:** always include the shape-specific key's
   `$exists: true` in `partialFilterExpression` (D4 shows each) — without it, rows of OTHER
   shapes (which lack the key entirely) can collide on a shared null key. CKQ's group index is
   the precedent.
3. **`refreshStagingData` ordering:** services must exist before `runLegacyImport` writes ledger
   rows (D5.4). The seed goes FIRST in the sequence.
4. **Do not weaken the charge-pipeline tests** while rewiring them — they are the executable
   spec of the three dedup layers (§4's overriding rule).
5. **No raw E11000/index unit tests** — `docs/TESTING_STRATEGY.md`'s "What NOT to test." Both
   unique indexes are proven behaviorally (the race/idempotency tests that already exist, plus
   the migration test's abort path).
6. **`migrateRegistrationsToLedger.js`** (ledger PR 1's script) predates this plan. It rewrites
   legacy 3-field docs into the PR 1 shape — after this plan it must produce
   discriminated rows (`billingShape`/`serviceId`) too. Update it and its test in PR B; its
   orphan-handling and `backfilled` semantics are unchanged.

---

## 6. Docs to update (PR B close-out)

- `DATABASE_SCHEMA_DOCUMENTATION.md` — Service (PR A), restructured Registration (base + three
  shapes + index table), `CoachContract.serviceId`, `PrivateClassCharge` removed.
- `docs/features/private-class.md` — models table: `PrivateClassCharge` row replaced by "ledger
  rows live in `Registration` (`per_session`)"; charge-pipeline section's model references.
- `docs/plans/registration-ledger-plan.md` — status header: note this plan restructured the PR 1
  schema and that PR 2/3 build against the discriminated shape (with the D4 naming).
- **New ADR: `docs/decisions/004-service-registry-and-unified-ledger.md`** — the two-dimension
  factoring (serviceId × billingShape), why it deliberately diverges from CKQ's per-service
  discriminators, the enrollment-fact-vs-ledger doctrine table, and the D7 deferrals with their
  triggers. Index it in `docs/decisions/README.md`.
- `CLAUDE.md` Documentation Map — this plan's row updated to shipped status.

---

## 7. Builder instructions (Sonnet session)

**Pre-reads (mandatory, in order):**
1. This doc, in full.
2. `docs/TESTING_STRATEGY.md`.
3. `docs/plans/registration-ledger-plan.md` — the PR 1 schema you're restructuring and the
   PR 2/3 specs that must remain executable afterward.
4. `docs/features/private-class.md` — the charge pipeline whose semantics you must preserve.
5. Every file you will edit, in full, before editing:
   `backend/src/models/registration.model.js`, `privateClassCharge.model.js`,
   `coachContract.model.js`, `backend/src/services/registration.service.js`,
   `privateClassSession.service.js`, `privateClassEnrollment.service.js`,
   `backend/src/utils/privateClassPricing.js` (comment only),
   `backend/scripts/lib/{seedSuperadmin,refreshStagingData,runLegacyImport,migrateRegistrationsToLedger}.js`,
   `backend/scripts/audit-reset.js`,
   `backend/tests/routes/{registration,privateClassSession,privateClassEnrollment,user}.routes.test.js`,
   `backend/tests/services/{renewal,subscription,user}.service.test.js`,
   `backend/tests/scripts/lib/*.test.js`, `frontend/lib/types.ts`.
6. CKQ reference (read-only, for the index-scoping precedent):
   `chesskqwebsite/backend/backend-2.0/src/models/registration.model.js` lines ~296-330 and
   `service.model.js`.

**Rules:**
- Two PRs, §3 order, each on its own `feature/*` branch from latest develop; PR A merges before
  PR B starts.
- The §4 overriding rule and §5 traps are binding. Never weaken a test to get green — if a gate
  fails, stop and report.
- Match surrounding comment density/idiom; comments explain WHY (especially the two-dimension
  factoring on the model and every partial index's scoping).
- No `console.log` outside the established eslint-disable'd operational-logging pattern.
- Do not commit until the full suite passes under `TZ=UTC` and the owner has reviewed the diff
  (payment-critical files).
- Report back per PR: files changed, test counts (added/updated/passing), coverage delta, the
  migration script's dry-run output against a locally-seeded DB, any deviation from this spec
  with its reason. Stop and ask on any ambiguity touching money math.

**Explicitly out of scope** (do not touch, even if adjacent): camps/meets features, coach
`serviceEligibility`, admin Service CRUD, the orphaned-coach fix plan's changes, ledger PR 2/3
(they come after), any pricing/discount/proration math, Stripe webhooks.
