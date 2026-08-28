# Implementation plan: Registration payment ledger + CKQ-style renewal/retry

**Status:** PR 1 MERGED TO DEVELOP 2026-08-27 (`friscofencingacademy-cmd/friscofencing` PR #37).
`docs/plans/service-registry-unified-ledger-plan.md` (owner decision, 2026-08-27) has since
restructured PR 1's schema — every group-specific field from D4-D6 below now lives on the
`SubscriptionCycleRegistration` discriminator, and every row requires a `serviceId` — built and
verified 2026-08-28 (PR A + PR B of that plan, awaiting owner diff review before ship). PR 2 and
PR 3 of THIS doc are still not started; execute them against the discriminated shape: wherever
this doc says "create a Registration row," read "create a `SubscriptionCycleRegistration` row
with `serviceId: (await getServiceByCode('group-classes', {requireActive:true}))._id`" — all
field names, indexes, and dedup semantics in D4-D6 are otherwise byte-identical to what's
written below, just living on the discriminator instead of the base schema. See "PR 1 completion
notes" at the end of this doc for exactly what PR 1 shipped, three deviations from this spec
(each with its reason), and one real gap this spec missed that got fixed along the way.

**Builder:** intended to be executed by a Sonnet implementation session. See §8 (Builder
instructions) before touching any file.

---

## 0. Adopted decisions (owner-visible defaults)

These three were flagged as owner decisions in review; the plan encodes the recommended
answer for each. Revisit before PR 3 merges if any is wrong:

1. **Dunning policy — ADOPTED: CKQ's Day 0 → 1 → 2 → 3-then-cancel model.** This replaces
   today's behavior (a failed renewal silently retries on every future daily run, forever,
   recalculating the amount each time, with no email and no end state). Customer-facing
   change: parents now get failure emails and are auto-cancelled after 3 failed retries.
2. **Retry cadence — ADOPTED: daily, `MAX_PAYMENT_RETRIES = 3`** (matching CKQ's
   `config/payment.js`).
3. **Migration — ADOPTED: backfill-in-place** of existing `Registration` docs (see D8).
   The migration script counts and reports before writing; dry-run is the default mode.

---

## 1. Target architecture

- **`Subscription`** — source of truth for *who is enrolled and what happens next*:
  student, schedule, status, period dates, `nextBillingDate`, retry state. Never a payment
  history. (It already mostly is this; it gains retry fields and a uniqueness guard.)
- **`Registration`** — source of truth for *what money moved (or failed to move) and when*:
  one immutable ledger row per charge cycle, with the full amount breakdown and the Stripe
  PaymentIntent id. This is CKQ's model (`backend-2.0`'s `Registration` + `renewalCron` +
  `retryCron`), and it is exactly what this repo's own `privateClassCharge.model.js`
  already does for private lessons — that file is the in-repo style precedent.

---

## 2. Design decisions

### D1 — New `Registration` schema (full replacement of the current 3-field schema)

`backend/src/models/registration.model.js` is rebuilt as:

```js
{
  subscriptionId: { type: ObjectId, ref: 'Subscription', required: true },
  // Snapshots at charge time — a later schedule change must NOT rewrite old rows.
  studentId:  { type: ObjectId, ref: 'User', required: true },
  scheduleId: { type: ObjectId, ref: 'GroupClassSchedule', required: true },
  parentId:   { type: ObjectId, ref: 'User', required: true },

  eventType: { type: String, enum: ['initial', 'renewal'], required: true },
  status:    { type: String, enum: ['pending', 'completed', 'failed'], required: true },

  // Dollars — what was actually charged (or attempted). For 'initial' rows this INCLUDES
  // the registration fee (it is what the single PaymentIntent was for).
  amount: { type: Number, required: true },

  breakdown: {
    monthlyFee:              { type: Number, required: true },
    prorated:                { type: Boolean, default: false },
    proratedAmount:          { type: Number, default: null },
    siblingDiscountApplied:  { type: Boolean, default: false },
    siblingDiscountAmount:   { type: Number, default: 0 },
    registrationFeeCharged:  { type: Number, default: 0 },
  },

  // The period this charge pays for.
  periodStart: { type: Date, required: true },
  periodEnd:   { type: Date, required: true },

  stripePaymentIntentId: { type: String, default: null },
  failureMessage:        { type: String, default: null },
  attempt:               { type: Number, default: 1 },
  paidAt:                { type: Date, default: null },
}
// timestamps: true
```

Mutation contract (enforce by code discipline + the §6 tests, not schema machinery): a row
is immutable except (a) the `pending → completed | failed` transition, and (b) retry
updates to `attempt` / `stripePaymentIntentId` / `failureMessage` / `paidAt` / `status`.
Nothing ever edits `amount`, `breakdown`, `periodStart/End`, or the id references after
insert. The old `REGISTRATION_STATUSES = ['active','cancelled']` export and the drifting
enrollment-`status` semantics disappear entirely.

Add a non-unique query index `{ subscriptionId: 1, createdAt: -1 }` (retry's
"most recent failed row" lookup) alongside the Guard B unique index below.

### D2 — Two DB-level guards (this corrects the gap-analysis doc's candidate direction)

The gap doc proposed a unique index on `Registration {subscriptionId, periodStart}` to
close the concurrent-registration race. It cannot: two racing `create()` calls each make
their **own** Subscription, so their ledger rows carry different `subscriptionId`s and both
insert fine. Two guards are needed, on two different collections:

- **Guard A — closes the double-subscription race.** On `Subscription`:

  ```js
  subscriptionSchema.index(
    { studentId: 1, scheduleId: 1 },
    { unique: true, partialFilterExpression: { status: 'active' } }
  );
  ```

  Only one ACTIVE subscription per student+schedule, enforced by MongoDB. Cancelled docs
  are excluded, so legitimate re-registration after a past cancellation still works —
  this **preserves** the intent of the existing schema comment ("deliberately NOT unique
  on (studentId, scheduleId)"); update that comment to explain the partial index rather
  than deleting the reasoning.

- **Guard B — durable renewal dedup (CKQ's fourth protection layer).** On `Registration`:

  ```js
  registrationSchema.index(
    { subscriptionId: 1, periodStart: 1 },
    { unique: true, partialFilterExpression: { status: { $in: ['pending', 'completed'] } } }
  );
  ```

  `failed` is excluded so a failed row never blocks its own retry — same shape and same
  comment rationale as `privateClassCharge.model.js`'s existing index. This is what
  outlives Stripe's ~24h idempotency-key window.

### D3 — Initial registration: charge-first ordering is KEPT

`registration.service.js`'s `create()` keeps its current order (validate → charge → create
docs; a decline is a 402 with **nothing persisted** — no orphan rows for a signup that
never happened; deliberate divergence from renewal, where the failed row is the retry
anchor). Changes:

1. After the succeeded PaymentIntent: create `Subscription` (unchanged fields) → then
   create the `Registration` ledger row: `eventType: 'initial'`, `status: 'completed'`,
   `amount: totalChargeAmount`, full `breakdown`, `periodStart: anchorDate`,
   `periodEnd: currentPeriodEnd`, `stripePaymentIntentId: paymentIntent.id`,
   `paidAt: new Date()`.
2. Wrap the `Subscription.create` in a catch for Mongo duplicate-key (`error.code ===
   11000`) → rethrow as the existing 409 `conflictError('This student is already
   registered for this schedule')`. Money safety in that race: the Stripe idempotency key
   (already keyed `initial-registration-{student}-{schedule}-{date}`) means both racers
   shared ONE real charge; the loser's 409 is correct and no ledger row is written for it.
   Keep the existing friendly `existingSubscription` pre-check — it handles the 99% case
   with a clean error; Guard A is the backstop, not the primary UX.
3. The service's return value: the `registration` key now returns the ledger row. Check
   frontend consumption (§5 PR 1 step 7).

### D4 — Renewal adopts CKQ's create-pending-first sequencing

`renewal.service.js`'s `renewOne()` becomes (order matters; unchanged steps noted):

1. Fresh-fetch + `status !== 'active'` / `nextBillingDate > today` /
   `cancelAtPeriodEnd` checks — **unchanged** (including the cancellation-finalization
   branch, which still never touches `Registration`).
2. **NEW — ledger dedup check** (before computing anything): find a row for
   `{ subscriptionId, periodStart: subscription.currentPeriodEnd, status: { $in:
   ['pending','completed'] } }`.
   - `completed` → return `{ outcome: 'skipped_already_charged' }` (this period was
     already paid — e.g. a prior run died after charge but before the period rolled;
     roll the period forward from the row's own periodStart/End before returning, so the
     subscription un-sticks).
   - `pending` → stale-pending recovery, D5.
3. Resolve fee + `calculateChargeAmount` — unchanged.
4. **NEW — create the ledger row BEFORE charging**: `eventType: 'renewal'`,
   `status: 'pending'`, locked `amount`, full `breakdown`
   (`registrationFeeCharged: 0` — renewals never re-charge it),
   `periodStart: subscription.currentPeriodEnd`, `periodEnd: addOneMonth(periodStart)`.
   Guard B makes a concurrent duplicate insert impossible; catch `11000` here → return
   `{ outcome: 'skipped_concurrent' }` without charging.
5. Charge Stripe with **`idempotencyKey: `payment_${registration._id}``** and
   **`metadata: { registrationId: String(registration._id) }`** — the ledger row id is
   the idempotency identity (CKQ's rule), replacing the current
   `renewal-{subId}-{periodEnd}` key. Keep the existing `StripeCardError` catch shape.
6. Succeeded → row: `status: 'completed'`, `stripePaymentIntentId`, `paidAt`; then roll
   the Subscription period forward exactly as today (`findOneAndUpdate` on
   `{_id, status:'active'}`), including the `lastChargeAmount`/
   `lastSiblingDiscountApplied` snapshots (kept for now — see D7 note) and **reset
   `retryCount: 0`, `nextRetryAt: null`**; receipt email unchanged.
7. Declined / non-succeeded → row: `status: 'failed'`, `failureMessage` (Stripe error
   message or PI status), `stripePaymentIntentId` if a PI exists on the error; do **NOT**
   roll the period; enter retry state (D6): set `retryCount: 1`, `nextRetryAt:
   addOneDay(todayAtMidnight())` on the Subscription; send the Day-0
   `sendPaymentFailureEmail` (non-fatal try/catch, mail.service contract). Outcome:
   `'failed_payment'` as today.

   **Note — `addOneDay` does not exist yet.** `backend/src/utils/billingDates.js`
   currently exports `addOneMonth`, `addMonths`, `daysInMonth`, `endOfMonth`,
   `todayAtMidnight` — no single-day helper. Add it there (same file, same idiom as its
   neighbors — a plain `Date` mutate-and-return, no `moment`; this repo has no
   `moment`/`moment-timezone` dependency at all, unlike CKQ) and export it. Every
   `nextRetryAt = +1 day` computation in D4/D6 uses this new helper, not inline
   `setDate` math scattered across the service.

### D5 — Stale-pending recovery (lean port of CKQ's July-1-incident fix)

A `pending` row means a previous run died between insert and charge-resolution. Without
recovery those families are stranded unchargeable forever (Guard B blocks a new row; CKQ
hit exactly this in production 2026-07-01). Recovery, in a helper
`recoverStalePending(row, subscription)`:

1. `stripe.paymentIntents.search({ query: `metadata['registrationId']:'${row._id}'` })`.
   (Search is available in test mode; it is eventually-consistent by ~1 minute, which is
   fine for a next-day recovery path. Every PI this plan creates carries the metadata —
   D4 step 5 and the retry key below — so search-proves-absence holds.)
2. A `succeeded` PI found → adopt it: row `completed` + PI id + `paidAt`, roll the period
   forward, reset retry state. **No new charge.**
3. None found, or only terminal-failed → re-drive the charge with the **same**
   `payment_${row._id}` key (within 24h Stripe replays the original outcome; beyond 24h,
   step 1 already proved no charge exists, so a fresh charge under the same key is
   correct). Then the same succeeded/failed handling as D4 steps 6–7.

### D6 — Retry/dunning (replaces infinite silent retry)

- `Subscription` schema gains `retryCount: { type: Number, default: 0 }` and
  `nextRetryAt: { type: Date, default: null }`.
- New `backend/src/config/billing.js` exporting `MAX_PAYMENT_RETRIES = 3` (this repo has
  no payment-config file yet; do not bury the constant in the service).
- `runRenewals()` becomes a **two-phase daily job** in `renewal.service.js`:
  - **Phase 1 (renewals)** — candidate query gains `retryCount: 0`:
    `{ status: 'active', nextBillingDate: { $lte: todayAtMidnight() }, retryCount: 0 }`.
    This keeps in-retry subscriptions out of the renewal path (previously a failed sub
    was re-picked and re-calculated every run).
  - **Phase 2 (retries)** — new `runRetries()`:
    `{ status: 'active', retryCount: { $gt: 0, $lte: MAX_PAYMENT_RETRIES },
    nextRetryAt: { $lte: todayAtMidnight() } }`, processed sequentially, ids-only
    candidate list + fresh fetch per item — the exact same re-verification discipline
    `renewOne` documents.
- `retryOne(subscriptionId)` (new, exported for tests):
  1. Fresh-fetch; `status !== 'active'` → `skipped_inactive` (this is the mandated
     cancel-then-charge race protection for the retry path — see §6).
  2. Find the most recent `failed` Registration row for the subscription
     (`sort({ createdAt: -1 })`). None → `skipped_no_failed_row` (warn-log).
  3. `retryCount >= MAX_PAYMENT_RETRIES` → cancel (below), `outcome: 'cancelled_exhausted'`.
  4. Charge the row's **locked `amount`** — never recalculated (the parent is charged
     exactly what they were emailed; CKQ's rule). Key:
     `payment_${row._id}_retry${retryCount + 1}`, metadata
     `{ registrationId, retry: String(retryCount + 1) }`.
  5. Succeeded → flip the SAME row: `completed`, `attempt: retryCount + 1`, PI id,
     `paidAt`; roll the Subscription period forward from the row's `periodStart/End`;
     reset `retryCount: 0`, `nextRetryAt: null`; receipt email.
  6. Failed → row keeps `failed`, update `attempt`/`failureMessage`/PI id; increment
     `retryCount`, `nextRetryAt = +1 day`; Day-N failure email with `attemptNumber`.
- **Cancel-after-exhaustion** (ported verbatim from CKQ's zombie-loop fix — both halves
  are load-bearing):

  ```js
  await Subscription.findOneAndUpdate(
    { _id: subscriptionId, status: 'active' },   // idempotent: only active → cancelled
    { $set: { status: 'cancelled', retryCount: MAX_PAYMENT_RETRIES },
      $unset: { nextRetryAt: '' } }              // $unset — `undefined` is silently
  );                                             // stripped by Mongoose (stale date stays)
  ```

  Then `removeStudentFromRoster` (same as the `cancelled_finalized` branch) and the final
  (`isFinal: true`) failure email, inside the `if (cancelled)` guard so an idempotent
  repeat call never re-sends it. The failed ledger row stays `failed` — the permanent
  record of the unpaid period.
- `scripts/run-renewals.js` runs phase 1 then phase 2 and prints both summaries.

### D7 — Repoint the old `Registration` consumers (the "enrollment fact" role retires)

- `user.service.js` (~line 251) delete-guard → `Subscription.countDocuments({ studentId:
  id })` (any status — a cancelled subscription still blocks deletion, matching current
  intent). Update the error message text accordingly.
- `subscription.service.js` (~line 299) `changeSchedule` step (b) — the
  `Registration.updateOne` repointing `scheduleId` — is **deleted** (ledger rows are
  immutable history; the old scheduleId on old rows is historically true). Renumber/fix
  the step comments and the `ckq-parity-plan.md §4.1` reference comment.
- `Subscription.lastChargeAmount` / `lastSiblingDiscountApplied` snapshots **stay** for
  now (display code reads them); dropping them in favor of "latest ledger row" is a
  follow-up decision, out of scope here.

### D8 — Migration of existing rows

**Follow this repo's established script convention exactly** (checked against
`scripts/seed-superadmin.js` / `scripts/lib/seedSuperadmin.js` and its
`refreshStagingData`/`runLegacyImport`/`wipeDatabase` siblings — every non-trivial script
here is a thin CLI wrapper over a testable `scripts/lib/*.js` module, unit-tested at
`tests/scripts/lib/*.test.js`; there is no bare `tests/scripts/*.test.js` file anywhere in
the repo). So:

- `backend/scripts/lib/migrateRegistrationsToLedger.js` — the real logic, exported as a
  function (e.g. `migrateRegistrationsToLedger({ dryRun })`), no `process.exit`/CLI
  concerns inside it — mirrors `seedSuperadmin()`'s shape.
- `backend/scripts/migrate-registrations-to-ledger.js` — thin wrapper: connects Mongo,
  parses `--live` and non-zero-exits on failure (same shape as
  `scripts/seed-superadmin.js`'s `main()`), calls the lib function, prints its report.
- Test file: `backend/tests/scripts/lib/migrateRegistrationsToLedger.test.js`.

Dry-run by default; `--live` applies. For each existing old-shape doc
(`{studentId, scheduleId, status}`):

1. Find its Subscription (match `studentId` + `scheduleId`; prefer `status:'active'`, else
   most recent). Not found → report, mark `eventType: 'legacy'` (add `'legacy'` to the
   enum), leave for manual review.
2. Rewrite in place into an `'initial'` ledger row: `status: 'completed'`,
   `amount: (sub.lastChargeAmount ?? 0) + sub.registrationFeeCharged`, breakdown from the
   Subscription's snapshot fields (`firstChargeProrated`, `registrationFeeCharged`;
   `siblingDiscountApplied` from `lastSiblingDiscountApplied`), `periodStart:
   sub.currentPeriodStart` at creation-equivalent (use the Subscription's `createdAt`-era
   period if derivable, else current period), `parentId: sub.parentId`,
   `subscriptionId: sub._id`, plus **`backfilled: true`** (new schema field, `default:
   false`) — because a post-renewal `lastChargeAmount` may not equal the true first
   charge; the flag marks rows whose amounts are best-effort, not charge-time truth.
3. Print a full per-doc report (counts: migrated / legacy / skipped) in both modes.

Run order in staging/prod: deploy PR 1 code → run migration script → verify → Guard B
index builds cleanly (it ignores old-shape rows only if they lack `status` values in its
partial filter — old rows have `status: 'active'|'cancelled'`, which are NOT in
`['pending','completed']`, so the index build is safe even pre-migration; state this in
the PR description).

---

## 3. What is deliberately NOT changing

- Initial-decline behavior: 402, nothing persisted (D3).
- `cancelAtPeriodEnd` two-stage cancellation flow and its finalization branch.
- Proration, sibling-discount, and registration-fee calculation logic (all reused as-is;
  only their outputs get recorded).
- The premium/`isPremium` model, roster mechanics, trial classes, private-class billing
  (`PrivateClassCharge` stays exactly as it is — it's the precedent, not a target).
- Known open items from the gap doc §"Related open items" (the $0-proration edge case and
  the `addStudentToRoster(anchorDate)` fix) — separate work, not smuggled into this plan.

---

## 4. Email

New `sendPaymentFailureEmail` in `mail.service.js`, following the existing template/send
conventions in that file exactly (same layout system, same `isEmailBlocked()` gate, same
non-fatal contract). Inputs: `{ parent, student, schedule, groupClass, amountDue,
attemptNumber, isFinal, nextRetryDate }`. Three renderings:

- Day 0 (`attemptNumber: 1`): "payment failed, we'll retry on {nextRetryDate}".
- Day 1/2 (`attemptNumber: 2..3`, `isFinal: false`): same with attempt count.
- Final (`isFinal: true`): "subscription cancelled after repeated payment failures" +
  how to re-register.

Add it to `scripts/preview-emails.js` alongside the existing templates.

---

## 5. PR breakdown (three PRs, each independently shippable, in order)

### PR 1 — Ledger schema + guards + initial-registration writes + consumer repoints + migration

1. Rebuild `backend/src/models/registration.model.js` (D1) + Guard B index + query index.
2. Guard A index + `retryCount`/`nextRetryAt` fields on
   `backend/src/models/subscription.model.js` (fields land here so PR 2/3 need no further
   schema change; they are inert until PR 2 writes them). Update the uniqueness comment.
3. `backend/src/config/billing.js` (`MAX_PAYMENT_RETRIES = 3`).
4. `registration.service.js` `create()` changes (D3).
5. Consumer repoints (D7): `user.service.js`, `subscription.service.js`.
6. `backend/scripts/lib/migrateRegistrationsToLedger.js` + thin wrapper
   `backend/scripts/migrate-registrations-to-ledger.js` (D8).
7. Frontend: grep `frontend/` for consumption of `POST /registrations`' response
   `registration` key and of any `Registration`-shaped type in `frontend/lib/types.ts`;
   update the type to the new backend shape (never widen to `any`) and update any MSW
   fixtures/component tests that render it.
8. Tests per §6 (PR 1 rows) + update existing assertions in
   `tests/routes/registration.routes.test.js` that reference the old Registration shape.

### PR 2 — Renewal sequencing + stale-pending recovery

1. `renewal.service.js` `renewOne()` rework (D4) + `recoverStalePending` (D5).
2. Phase-1 candidate-query `retryCount: 0` filter (the query change itself lands here so
   PR 2 is safe standalone: with no retry runner yet, a failed sub waits at
   `retryCount: 1` until PR 3 ships — visible in the run summary, not silently lost;
   PR 2's description must say this explicitly).
3. Day-0 failure email wiring + `sendPaymentFailureEmail` template (§4) — the template
   lands here because PR 2 is what starts sending it.
4. Tests per §6 (PR 2 rows).

### PR 3 — Retry runner + dunning + cancel-after-exhaustion

1. `retryOne` / `runRetries` in `renewal.service.js` (D6).
2. Cancel-after-exhaustion + final email.
3. `scripts/run-renewals.js` two-phase update.
4. Tests per §6 (PR 3 rows).

Each PR also updates `docs/TEST_COVERAGE.md` for its new suites, and PR 3 closes with the
§7 doc updates.

---

## 6. Test plan

Reconciled against `docs/TESTING_STRATEGY.md` — read it before writing any test. Specific
sync points that OVERRIDE anything a builder might default to:

- **No raw index/model tests.** Per "What NOT to test": never assert E11000/`syncIndexes`
  directly. Guard A is proven via route-integration behavior (409); Guard B via service
  behavior (skip / not-blocked). There is no `tests/models/` layer.
- Backend billing suites hit **real Stripe TEST-mode** (never mock the stripe module) —
  follow `renewal.service.test.js`'s existing header pattern (dotenv before requires).
  Use Stripe's test payment methods for declines, as the suite does today.
- `jest.mock('../../src/services/mail.service')` in service suites is the established,
  documented exception; template rendering is asserted only in `mail.service.test.js`.
- Date rules: fixed instants (midday UTC), `jest.useFakeTimers` where "today"/"tomorrow"
  matters (`nextRetryAt` assertions), no now-relative bombs, run under `TZ=UTC`.
- **Line 45 mandate** (cancel-then-charge race) applies to BOTH charging paths — renewOne
  (existing test stays green) and the new retry path (new test below).

### PR 1 tests

`tests/routes/registration.routes.test.js` (extend):
- Successful registration persists ONE `Registration` row: `eventType 'initial'`,
  `status 'completed'`, non-null `stripePaymentIntentId`, `amount ===
  totalChargeAmount`, correct `breakdown` and `periodStart/periodEnd` — prorated and
  non-prorated variants.
- Declined card → 402 and **zero** Subscription AND zero Registration docs persisted.
- Guard A behaviorally: register the same student+schedule twice through the real HTTP
  path → second gets 409, exactly one active Subscription exists. Then cancel (set
  `status:'cancelled'` directly) and register again → 201 (re-registration allowed).
- Duplicate-key path: with the pre-check bypassed (insert an active Subscription between
  preview and create, or call the service twice concurrently) the E11000 → 409 mapping
  holds and no second ledger row is written.

`tests/services/user.service.test.js` / `subscription.service.test.js` (extend):
- Delete-guard now blocks on Subscription count (old Registration-count assertion
  updated).
- `changeSchedule` no longer mutates any Registration row (assert rows unchanged).

`tests/scripts/lib/migrateRegistrationsToLedger.test.js` (new; matches the
`tests/scripts/lib/seedSuperadmin.test.js` sibling pattern already in the repo):
- Seeds old-shape rows + subscriptions; dry-run asserts ZERO writes; live run asserts
  rewritten shape, `backfilled: true`, `legacy` for orphans, and correct counts report.

### PR 2 tests

`tests/services/renewal.service.test.js` (extend):
- Success: `completed` ledger row created with locked amount == live calc, period rolled,
  receipt email mock called; `retryCount` stays 0.
- Ledger dedup: pre-existing `completed` row for the period → `skipped_already_charged`,
  NO new PaymentIntent created (assert via Stripe: list PIs for the customer, or assert
  no new ledger row + unchanged `lastChargeAmount`), period rolled forward if stuck.
- Failure (real test-mode decline): row `failed` with `failureMessage`, period NOT
  rolled, `retryCount: 1` + `nextRetryAt` set to next-day-midnight (fake timers), Day-0
  email mock called with `attemptNumber: 1`.
- Guard B behaviorally: concurrent `renewOne` double-call for the same period yields one
  charged outcome and one `skipped_concurrent`/`skipped_already_charged`; exactly one
  non-failed row exists.
- Stale-pending recovery: (a) row `pending` + a real succeeded PI carrying its
  `registrationId` metadata → adopted (`completed`, no second charge); (b) row `pending`
  + no PI → re-driven and completed.
- Existing cancel-then-charge race test for `renewOne` stays green (fresh-fetch property
  unchanged).
- Failed row does NOT block a later attempt (index exclusion expressed as behavior).

`tests/services/mail.service.test.js` (extend):
- `sendPaymentFailureEmail` renders Day-0 / Day-N / final variants (recipient, amount,
  `nextRetryDate` presence, final-copy differences); send failure is non-fatal.

### PR 3 tests

`tests/services/renewal.service.test.js` or a new `retry` describe block (same file —
retry lives in renewal.service.js):
- **Locked amount:** change the `Price` doc between failure and retry → retry charges the
  ORIGINAL row amount, not the new price.
- Retry success: same row flipped `completed` with `attempt: 2`, period rolled from the
  row's own `periodStart/End`, `retryCount` reset to 0, `nextRetryAt` cleared.
- Retry failure: `retryCount` increments, `nextRetryAt` re-bumped, email
  `attemptNumber` correct, row stays `failed` with updated `attempt`.
- Exhaustion: `retryCount` at MAX → subscription `cancelled`, roster removal ran, final
  email (`isFinal: true`) sent exactly once, `nextRetryAt` **absent from the raw doc**
  (`$unset` verified via `.lean()` / `collection.findOne` — this is the zombie
  regression), and the cancelled sub matches NO further `runRetries` candidate query.
- **Cancel-then-retry race (line-45 mandate, new path):** subscription cancelled between
  the phase-2 candidate listing and `retryOne`'s fresh fetch → `skipped_inactive`, no
  charge.
- `cancelAtPeriodEnd` finalization unaffected by retry state.
- Two-phase `runRenewals` integration: an in-retry sub is excluded from phase 1 and
  picked up by phase 2 in the same run's summary.

### Coverage + verification (every PR)

```
cd backend  && TZ=UTC npm test
cd frontend && TZ=UTC npm test        # PR 1 only, if frontend files changed
TZ=UTC npm test -- --coverage         # statements floor: 80% (currently 84.95% backend)
```

Also verify the live-audit layer still passes conceptually: `audit/run-registration-audit.js`
exercises real registration incl. the decline path against staging — decline persists
nothing (unchanged ✓), but check `backend/scripts/audit-reset.js` deletes new-shape
`Registration` rows for the audit accounts, and update it if it filters on old-shape
fields. Do this in PR 1.

---

## 7. Docs to update (PR 3 close-out, except where noted)

- `docs/decisions/001-in-house-subscription-billing.md` — addendum: ledger model, the two
  guards, dunning policy (Day 0→3, MAX 3, auto-cancel).
- `docs/plans/registration-ledger-gap-analysis.md` — status header → decided/implemented,
  pointer to this plan.
- `docs/TESTING_STRATEGY.md` — extend the line-45 mandate to name BOTH charging paths
  (renewal and retry).
- `docs/TEST_COVERAGE.md` — per-PR, new suites + re-measured numbers.
- `docs/decisions/README.md` — index the ADR addendum if that file carries statuses.

---

## 8. Builder instructions (Sonnet session)

**Pre-reads (mandatory, in order):**
1. `docs/plans/registration-ledger-gap-analysis.md` — the why.
2. `docs/TESTING_STRATEGY.md` — before writing any test; §6 above flags the traps.
3. `docs/decisions/001-in-house-subscription-billing.md` — the billing philosophy
   ("re-verified every time", fresh-fetch discipline) the new code must keep.
4. Every file you will edit, in full, before editing it:
   `backend/src/models/registration.model.js`, `subscription.model.js`,
   `privateClassCharge.model.js` (style precedent — match its comment/index idiom),
   `backend/src/services/registration.service.js`, `renewal.service.js`,
   `subscription.service.js`, `user.service.js`, `mail.service.js`,
   `backend/src/utils/billingDates.js`, `scripts/run-renewals.js`,
   `scripts/seed-superadmin.js` + `scripts/lib/seedSuperadmin.js` (the thin-wrapper/lib
   convention D8's migration script must follow),
   `tests/services/renewal.service.test.js`, `tests/routes/registration.routes.test.js`.

**Rules:**
- One PR at a time, in §5 order, each on its own `feature/*` branch from latest develop.
- Match the surrounding code's comment density and idiom (this repo comments the WHY on
  billing code heavily — keep that up, especially on the two guards and the `$unset`).
- No `console.log` except the established `eslint-disable`-annotated operational-logging
  pattern already used in these services.
- Never mock the stripe module in backend billing tests; never assert raw E11000.
- Do not commit until the full suite passes under `TZ=UTC` and the diff has been reviewed
  by the owner (payment-critical files — the owner reviews exact diffs before commit).
- Report back per PR: files changed, test counts (added/updated/passing), coverage delta,
  any deviation from this spec with its reason, and any spec ambiguity encountered
  (stop and ask rather than guess on anything touching money math).

**Explicitly out of scope** (do not touch, even if adjacent): proration $0 edge case,
`addStudentToRoster` anchorDate fix, dropping `lastChargeAmount` snapshots,
`PrivateClassCharge` refactors, frontend redesigns beyond the type/fixture updates in
PR 1 step 7.

---

## PR 1 completion notes (2026-08-27)

Built on `feature/registration-payment-ledger`, merged to `develop` via PR #37. Full backend
suite: 410 tests, 409 pass — the one
failure is `registration.routes.test.js`'s "prorates the real Stripe charge and anchors the
period to calendar month-end" test, which fails identically on unmodified `develop` (verified via
`git stash`): the pre-existing $0-end-of-month proration bug this doc's §3 already lists as out
of scope, surfaced only because the test computes proration for "right now" and today happens to
be near month-end. Not touched. Frontend: 47/47 suites, 266/266 tests, `tsc --noEmit` clean.
Backend statement coverage 86.98% (up from 84.95%).

**One real gap this spec missed, found and fixed during the build:**
`backend/scripts/lib/runLegacyImport.js` (used by `refresh-staging-data.js`) creates a
Registration doc directly, old-shape, on every historical-student backfill — not listed anywhere
in this plan's file list. Left unfixed, every future staging refresh would throw a Mongoose
validation error. Fixed the same way as `registration.service.js`'s `create()`: Subscription
created first, then a real ledger row (`eventType: 'initial'`, `status: 'completed'` — the
historical charge genuinely happened, just not through a Stripe PaymentIntent this system holds;
`stripePaymentIntentId: null`, `paidAt: null` since the true historical charge instant isn't
known). Test coverage added to its existing suite. If a future audit of this repo's scripts finds
another direct `Registration.create()`/`.updateOne()` outside what this plan's D7/D8 already
covers, treat it the same way — `reset-customer-data.js`/`reset-legacy-data.js`/`audit-reset.js`
were checked and are shape-agnostic (`countDocuments`/`deleteMany` only), so they needed no change.

**One correction to a stated gap:** D7 described `user.service.js`'s delete-guard as needing a
Subscription count check "instead of" the Registration one, implying only the latter existed.
Reading the full file (not a truncated `-C 4` grep context) showed both already existed — the
Registration check was simply redundant now that Registration is a ledger, not an enrollment
fact (a Registration row's `subscriptionId` always points at a Subscription that is never itself
deleted, so the existing Subscription check is a superset). Fix: removed the Registration check,
kept the Subscription and TrialClass checks as-is. Added two new tests (none existed before for
either check) proving the guard blocks on Subscription and no longer blocks on an orphaned ledger
row alone.

**Two deviations from D8's literal wording, both driven by the new schema's own `required: true`
constraints:**
1. D8 said an unmatched legacy doc should be "marked `eventType: 'legacy'`... left for manual
   review." `subscriptionId` is `required: true` on every row including a `'legacy'`-typed one,
   and a true orphan (no Subscription found for its studentId+scheduleId at all) has no valid
   value to put there. Implemented instead: an orphan is left **completely untouched** in its
   original 3-field shape (not written at all) and reported separately as `orphaned` for manual
   review. The `'legacy'` enum value was still added to the schema (D1) for a human to use by hand
   if a real subscriptionId is found manually later — it's just never written by the script itself.
2. D8 said `periodStart` should use "the Subscription's `createdAt`-era period if derivable, else
   current period." Implemented as: always the OLD Registration doc's own `createdAt` (the real
   historical moment that enrollment stub was created) — more precise than the Subscription's
   `currentPeriodStart`, which may have rolled forward through many renewals since the doc's
   creation and would silently misdate an old first-charge as recent.

**File-by-file diff, for the owner's payment-critical-files review** (per Hard Rule 3):
`backend/src/models/registration.model.js` (full rewrite), `subscription.model.js` (+Guard A,
+retry fields, comment update), `backend/src/utils/billingDates.js` (+`addOneDay`),
`backend/src/config/billing.js` (new), `backend/src/services/registration.service.js` (`create()`
reordered + ledger write + E11000→409 catch), `subscription.service.js` (removed the
Registration-repointing write in `changeSchedule`, dropped the now-unused import),
`user.service.js` (removed the redundant Registration count check, dropped the now-unused
import), `backend/scripts/lib/runLegacyImport.js` (reordered + ledger write, see above),
`backend/scripts/lib/migrateRegistrationsToLedger.js` + `backend/scripts/migrate-registrations-
to-ledger.js` (new), `frontend/lib/types.ts` (`Registration` interface rebuilt to the new shape —
zero runtime frontend files changed; grepped and confirmed no page reads a field off the
`registration` key beyond its existence). Plus test files:
`tests/routes/registration.routes.test.js`, `tests/routes/subscription.routes.test.js` (fixture
fix — see below), `tests/routes/user.routes.test.js`, `tests/services/subscription.service.test.js`,
`tests/services/user.service.test.js`, `tests/scripts/lib/runLegacyImport.test.js`,
`tests/scripts/lib/migrateRegistrationsToLedger.test.js` (new). Plus this doc, `CLAUDE.md`,
`docs/plans/registration-ledger-gap-analysis.md`, `docs/TEST_COVERAGE.md`.

**One pre-existing test fixture Guard A correctly caught:**
`subscription.routes.test.js`'s admin-list-filtering test created two `status: 'active'`
Subscriptions for the same student+schedule (differing only in `cancelAtPeriodEnd`) purely to
exercise the active/pending-cancel filter — a combination Guard A now correctly forbids, and one
that could never happen in real production. Fixed by giving the second subscription a sibling
student on the same schedule instead of colliding — same filter behavior under test, now on data
shaped like reality.

Not yet done: PR 2 (renewal sequencing + stale-pending recovery), PR 3 (retry/dunning), and the
§7 doc updates that close out with PR 3 (`docs/decisions/001-in-house-subscription-billing.md`
addendum, `docs/TESTING_STRATEGY.md`'s line-45 mandate extension, `docs/decisions/README.md`).
