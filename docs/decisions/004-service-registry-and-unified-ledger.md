# ADR 004: Service registry + unified two-dimension payment ledger

**Status:** Implemented — 2026-08-27/28 (`docs/plans/service-registry-unified-ledger-plan.md`, PR A + PR B)

## Context

Frisco offers more than group classes and private lessons — camps and meets are real, planned
services, not yet built in software. Before this ADR, `Registration` (the group-class payment
ledger, `docs/plans/registration-ledger-plan.md` PR 1, shipped one day earlier) and
`PrivateClassCharge` (the private-lesson payment ledger) were two separate collections with two
slightly different shapes for the same underlying concept — a payment record. Adding camps/meets
under that pattern would have meant a third (and, for a fourth service, a fourth) near-duplicate
ledger collection.

ADR 003 (§Decision, point 1) explicitly excluded a `Service` abstraction from the CKQ-derived
schema shape adopted then, reasoning Frisco only had two hardcoded services and didn't need one.
That premise no longer holds once camps and meets are real near-term work, not speculative scope.

A local checkout of CKQ's own backend was read directly (not assumed) to see how it handles this:
CKQ has a `Service` collection (`service.model.js`) and a single `Registration` collection with a
Mongoose discriminator **per service** (`GroupClassRegistration`, `PrivateClassRegistration`, ...,
the discriminator key literally being the service's own display-name string, e.g. `'Group Class'`).

## Decision

Two departures from CKQ's own pattern, both owner-directed after reviewing it:

1. **Service referenced by a stable `code`, never by display name.** CKQ's discriminator key
   doubling as the service's display-name string means renaming a service is a data migration
   there. Frisco's `Service.code` (`group-classes`, `private-lessons`, `camps`, `meets`) is the
   only thing any code branches on or looks up by; `Service.name` is display-only and freely
   renameable.

2. **The ledger's structural shape and its business-service identity are two independent
   dimensions, not one.** CKQ conflates them (one discriminator per service). Here:
   - `serviceId` (every `Registration` row) — the BUSINESS dimension.
   - `billingShape` (the Mongoose discriminator key) — the STRUCTURAL dimension. Exactly three,
     ever: `subscription_cycle` (recurring, period-based — group classes), `per_session`
     (per-delivered-unit — private lessons), `one_time_event` (single flat charge — camps,
     meets, and any future service shaped the same way).

   Camps and meets are the proof: two different services, the SAME billing shape
   (`one_time_event`), so adding meets once camps exists is one `Service` seed row — zero schema
   changes. Under CKQ's pattern it would be a new discriminator sub-schema each time, even though
   nothing about a camp payment and a meet payment structurally differs.

Also decided, not present in CKQ's own design:

3. **Write-time pairing validation.** Every ledger write resolves its `Service` via
   `serviceCatalog.service.js`'s `getServiceByCode()`, then asserts `service.billingShape`
   matches the discriminator model actually being written (`assertBillingShape()`) — before any
   insert. This is what keeps the two dimensions from silently drifting apart; a mismatch is a
   code defect (wrong discriminator wired to a service), never a real runtime condition.

4. **Enrollment-fact / ledger separation, upheld for camps/meets too, unlike CKQ.** CKQ's own
   Registration row for a camp/tournament doubles as the enrollment record itself — the one place
   CKQ violates the "enrollment facts and money never share a document" doctrine ADR 001/003
   already established for Frisco. Not imported. When camps/meets are actually built, they get
   their own enrollment-fact model (mirroring `Subscription` for group classes,
   `PrivateClassEnrollment` for private lessons) — the `one_time_event` discriminator (D4 in the
   plan doc) is schema-complete today specifically so that future work only adds behavior, never
   reshapes the ledger.

5. **`PrivateClassCharge` retired, absorbed as the `per_session` discriminator.** One collection
   for every charge in the business — one place to answer "what did we ever charge this family,"
   one place a Stripe PaymentIntent id can be looked up, one immutability contract instead of two
   near-identical ones. Migrated via `scripts/lib/migrateToUnifiedLedger.js`, preserving every
   charge row's original `_id` (a charge's identity never changes across the migration) and
   verifying counts/per-status totals before dropping the old collection — never dropped if
   verification finds a mismatch.

6. **`CoachContract` gains `serviceId`**, set internally (always `private-lessons` today, since
   it has no other consumer) — never accepted from a client request. The trigger for accepting it
   from a request is a second coach-facing service actually existing.

## Consequences

- `docs/plans/registration-ledger-plan.md`'s PR 1 schema (shipped one day before this ADR) is
  restructured: its group-specific fields move into the `SubscriptionCycleRegistration`
  discriminator; every row gains a required `serviceId`. That plan's still-unbuilt PR 2 (renewal
  sequencing) and PR 3 (retry/dunning) execute against this discriminated shape — see that doc's
  own status header for the field-substitution rule.
- Every existing test fixture that created a `Registration`/`CoachContract` doc — directly or via
  the real API — needed a seeded `Service` registry first; `scripts/lib/seedServices.js`
  (idempotent, dry-run-free since it's pure upsert) is called in each affected suite's setup.
- `scripts/lib/migrateRegistrationsToLedger.js` (the ledger PR 1 migration script, for Frisco's
  original 3-field pre-ledger docs) was updated in the same pass to also stamp
  `billingShape`/`serviceId` — and `migrateToUnifiedLedger.js` was made defensive against a
  genuinely still-un-migrated ancient doc (reports and skips it rather than corrupting it with a
  partial stamp), so the two scripts are safely composable regardless of which an operator runs
  first on a given environment.
- No coach `serviceEligibility` (CKQ has this, gating which services a coach may work), no admin
  `Service` CRUD UI (four near-static rows, seed-script managed), no camps/meets feature code —
  all deliberately deferred; see the plan doc's D7 for each deferral's actual trigger.
- Supersedes ADR 003 §Decision point 1's "no `Service` abstraction" premise — that call was
  correct when made (two hardcoded services, nothing to abstract); it stopped being correct once
  camps/meets became real near-term work, which is the entire justification for this ADR.

## References

- `docs/plans/service-registry-unified-ledger-plan.md` — full implementation spec, both PRs.
- `docs/plans/registration-ledger-plan.md` — the PR 1 schema this ADR restructures.
- `docs/decisions/003-premium-group-class-billing.md` — the ADR whose "no Service abstraction"
  premise this one revisits.
- `DATABASE_SCHEMA_DOCUMENTATION.md` — current `Registration`/`Service`/`CoachContract` field
  tables.
