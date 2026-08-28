# Execution plan: next batch — orphan fix, then renewal sequencing, then retry/dunning

**Status:** Approved for execution. Written 2026-08-28. **Builder: a Sonnet implementation
session executes the three items below IN ORDER, one PR each, shipping each to `develop` after
its own gates pass and the owner has reviewed the diff (payment-critical files — Hard Rule).**
This doc is the orchestrator: it fixes the order, carries the deltas that changed since the
underlying specs were written, and names the traps. The full per-item specs live in the two
plan docs it points at — read them; this doc never duplicates what they already say.

**Why this order:** Item 1 fixes a live, currently-reproducing staging outage (the public
`/private-classes` page 500s — re-confirmed against the real staging API 2026-08-28). Items 2
and 3 are the registration-ledger plan's remaining money work, which builds on the unified
ledger shipped 2026-08-28; Item 3 depends on Item 2's failure-row writes to have anything to
retry.

---

## Item 1 — Orphaned-reference fix (fixes the live public private-class page)

**Spec:** `docs/plans/orphaned-coach-reference-fix-plan.md` — the base plan §0-§7 **plus its
§8 Amendment (2026-08-28)**, which is part of the executable scope: student/parent orphans join
the coach audit, the student delete guard gains the missing `PrivateClassEnrollment` check, and
`reset-customer-data.js` gains private-class cleanup. One PR, per that plan's own rules.

**Done means:** all suites green under `TZ=UTC`, `tsc --noEmit` clean after the type-widening
step, AND the §8f live verification passes post-merge — the staging endpoint returns 200 and
the page renders. Include the read-only `find-orphaned-references.js` staging report in the
report-back so the owner can decide manual cleanup of whatever it finds.

---

## Item 2 — Renewal create-pending-first sequencing + stale-pending recovery (ledger plan PR 2)

**Spec:** `docs/plans/registration-ledger-plan.md` §D4 (renewal sequencing), §D5 (stale-pending
recovery), §4 (the `sendPaymentFailureEmail` template), its "PR 2" section, and its §6 PR 2 test
rows. Everything there stands, WITH the following concrete deltas — the spec was written one
schema-generation ago, and the unified-ledger restructure
(`docs/plans/service-registry-unified-ledger-plan.md`, shipped 2026-08-28) landed in between:

1. **Ledger writes go through the discriminator, with service resolution.** Wherever the spec
   says "create the Registration row", the real code is:

   ```js
   const { SubscriptionCycleRegistration } = require('../models/registration.model');
   const { getServiceByCode, assertBillingShape } = require('./serviceCatalog.service');
   // ...inside renewOne, BEFORE creating the pending row (and therefore before
   // any Stripe charge — same fail-closed placement registration.service.js's
   // create() already uses; read it as the wiring precedent):
   const groupClassesService = await getServiceByCode('group-classes', { requireActive: true });
   assertBillingShape(groupClassesService, 'subscription_cycle');
   // ...then:
   const registration = await SubscriptionCycleRegistration.create({
     serviceId: groupClassesService._id,
     /* ...exactly the field list D4 step 4 specifies... */
   });
   ```

   The dedup pre-check (D4 step 2) and the retry-anchor lookups query via
   `SubscriptionCycleRegistration` too (the discriminator auto-scopes to its own shape).
2. **Guard B's index already exists and is already `$exists`-scoped** (it moved onto the
   discriminator schema in the restructure) — the E11000 catch in D4 step 4 works against it
   unchanged. Do not re-create or modify any index.
3. **Every PR-1 prerequisite the spec flags as "to be added" already shipped in PR 1** —
   `addOneDay` (`billingDates.js`), `MAX_PAYMENT_RETRIES` (`src/config/billing.js`), and
   `Subscription.retryCount`/`nextRetryAt`. D4's inline "addOneDay does not exist yet" note is
   stale; skip it. PR 2 needs zero schema/util groundwork.
4. **`tests/services/renewal.service.test.js` must add `await seedServices()` in a
   `beforeEach`** (import from `scripts/lib/seedServices`) — the moment `renewOne` resolves the
   Service registry, every existing renewal test would otherwise die on the catalog's
   fail-closed "not seeded" error before reaching what it actually tests. Same one-line setup
   pattern every suite touched by the unified-ledger PR already uses — copy it from
   `tests/routes/registration.routes.test.js`.
5. **Stripe metadata:** D4 step 5's `metadata: { registrationId: String(registration._id) }` is
   what D5's recovery searches on (`stripe.paymentIntents.search`, verified available on the
   installed SDK v22). Don't drop it — recovery is inert without it.
6. The new `sendPaymentFailureEmail` template registers in the block-based email system
   (`docs/modules/email.md` is the pre-read for that file family) and in
   `scripts/preview-emails.js`, per the ledger plan's §4.

**Done means:** the ledger plan's §6 PR 2 test rows all pass (including the mandated
cancel-then-charge race staying green and the stale-pending recovery pair), full backend suite
green under `TZ=UTC`, `docs/TEST_COVERAGE.md` updated.

---

## Item 3 — Retry/dunning + cancel-after-exhaustion (ledger plan PR 3)

**Spec:** `docs/plans/registration-ledger-plan.md` §D6, its "PR 3" section, §6 PR 3 test rows,
and §7 (the doc close-outs: ADR-001 addendum, gap-analysis status flip, `TESTING_STRATEGY.md`'s
line-45 mandate extended to name the retry path, `docs/decisions/README.md` if statuses live
there). Deltas, same reasons as Item 2:

1. Retry's "most recent failed row" lookup and its completed-flip both go through
   `SubscriptionCycleRegistration`; the retry charge reuses the row's locked `amount` — never
   re-resolves the Service for pricing (there is no price in the Service registry; the lock is
   the row's own `amount`, exactly as D6 step 4 says). The Service IS re-resolved with
   `requireActive: true` before the Stripe call — an owner deactivating the group-classes
   service mid-dunning should stop retries too, same fail-closed posture as renewal.
2. The `$unset: { nextRetryAt: '' }` in cancel-after-exhaustion is load-bearing (CKQ's
   zombie-loop fix, quoted in D6) — the §6 test that asserts the field is ABSENT from the raw
   doc via `.lean()`/`collection.findOne` is what proves it; do not soften that assertion.
3. `scripts/run-renewals.js` becomes two-phase (renewals then retries, both summaries printed)
   per D6's last bullet.

**Done means:** §6 PR 3 rows all pass (locked-amount, exhaustion/zombie regression, the
cancel-then-retry race, two-phase integration), full suite green, all §7 doc updates in the
same PR.

---

## Cross-cutting rules (all three items)

- **Branch protocol:** each item gets its own `feature/*` branch from a freshly pulled
  `develop`; push → PR → merge (no CI is configured on this repo — the local `TZ=UTC` suite IS
  the gate); delete the local branch after the remote merge confirms.
- **Owner diff review before commit** on every item — these are payment-critical files.
- **Known pre-existing failures, do not chase or weaken:** `registration.routes.test.js`'s two
  proration tests ("prorates the real Stripe charge..." and "applies proration BEFORE the
  sibling discount...") fail when the run date is near calendar month-end — the documented
  $0-remaining-class-days bug (`registration-ledger-gap-analysis.md` "Related open items",
  explicitly out of scope for every plan in this batch). They fail identically on unmodified
  `develop`; being date-dependent, they may equally well PASS when this batch runs. Either way
  they are not this batch's signal.
- **Pre-reads stack, not replace:** each item's own plan doc lists mandatory pre-reads — those
  hold. Items 2/3 additionally pre-read `docs/plans/service-registry-unified-ledger-plan.md`
  (the restructure the deltas above come from), the current
  `backend/src/models/registration.model.js` (the discriminated schema as it actually exists),
  and `backend/src/services/serviceCatalog.service.js`.
- **Report back per item** in the shape each plan doc already prescribes; stop and ask rather
  than guess on anything touching money math.

## Explicitly NOT in this batch

Camps/meets features · coach `serviceEligibility` · admin Service CRUD · dropping
`Subscription.lastChargeAmount` snapshots · the proration $0 edge-case fix ·
`addStudentToRoster` anchorDate fix · any frontend redesign beyond what Item 1's type-widening
surfaces.
