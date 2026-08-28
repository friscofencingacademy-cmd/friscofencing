// Rewrites this repo's original 3-field Registration docs
// ({studentId, scheduleId, status: 'active'|'cancelled'}) into the payment
// ledger's real shape (docs/plans/registration-ledger-plan.md D8) — the
// registration.model.js schema itself was already replaced; this is what
// migrates whatever data existed under the old shape onto it. Old-shape docs
// are identified by the absence of `billingShape` (every doc ANY current
// schema — base or any discriminator, docs/plans/service-registry-unified-
// ledger-plan.md — creates going forward always sets it), not by a manual
// id list — so this is safe to re-run: a doc it already rewrote is never
// picked up again.
//
// Also stamps billingShape/serviceId in the same pass (unified-ledger-plan
// D6) — a doc this script touches comes out fully shaped for the CURRENT
// schema in one pass, never needing scripts/lib/migrateToUnifiedLedger.js
// run afterward for the same doc. Deliberately raw-collection writes
// throughout (never a hydrated Mongoose document's `.set()`/`.save()`,
// which this script used before the discriminator restructure) — a base-
// model document instance isn't safely re-shapeable into a discriminator's
// schema at runtime, so this always writes the full final document shape
// directly.
//
// A doc whose (studentId, scheduleId) pair can't be matched to ANY
// Subscription is left completely untouched — never force-written with a
// fabricated subscriptionId, which the schema requires — and reported as an
// orphan for manual review instead. This is the D8 "leave for manual
// review" case.

const mongoose = require('mongoose');
const Subscription = require('../../src/models/subscription.model');
const { seedServices } = require('./seedServices');
const { addOneMonth, endOfMonth } = require('../../src/utils/billingDates');

async function findBestSubscription(studentId, scheduleId) {
  const active = await Subscription.findOne({ studentId, scheduleId, status: 'active' });

  if (active) {
    return active;
  }

  return Subscription.findOne({ studentId, scheduleId }).sort({ createdAt: -1 });
}

async function migrateRegistrationsToLedger({ dryRun = true } = {}) {
  await seedServices();

  const registrations = mongoose.connection.db.collection('registrations');
  const services = mongoose.connection.db.collection('services');
  const groupClassesService = await services.findOne({ code: 'group-classes' });

  const legacyDocs = await registrations.find({ billingShape: { $exists: false } }).toArray();

  const report = {
    dryRun,
    totalLegacyDocs: legacyDocs.length,
    migrated: [],
    orphaned: [],
  };

  for (const doc of legacyDocs) {
    // eslint-disable-next-line no-await-in-loop -- sequential by design, a
    // one-time, low-volume migration script has no reason to fan out writes.
    const subscription = await findBestSubscription(doc.studentId, doc.scheduleId);

    if (!subscription) {
      report.orphaned.push({
        registrationId: doc._id.toString(),
        studentId: doc.studentId.toString(),
        scheduleId: doc.scheduleId.toString(),
        reason: 'no matching Subscription found for this studentId+scheduleId',
      });
      // eslint-disable-next-line no-continue -- clearer than nesting the
      // rest of this loop body one level deeper.
      continue;
    }

    // Already PR1-shaped (has amount/eventType/periodStart already, just
    // missing billingShape/serviceId) — a lighter stamp, not a
    // reconstruction: everything it already has is charge-time truth,
    // never overwritten.
    const alreadyLedgerShaped =
      doc.amount !== undefined && doc.eventType !== undefined && doc.periodStart !== undefined;

    let rewrite;

    if (alreadyLedgerShaped) {
      rewrite = {
        billingShape: 'subscription_cycle',
        serviceId: groupClassesService._id,
      };
    } else {
      // Best-effort reconstruction — there is no historical snapshot of
      // this charge's own breakdown at the time it happened, only the
      // Subscription's CURRENT last-known snapshot fields (which a later
      // renewal may have already overwritten). `periodStart` uses the OLD
      // Registration doc's own `createdAt` (the real historical moment
      // this enrollment was created), not the Subscription's
      // `currentPeriodStart` (which may have rolled forward many renewals
      // since). `backfilled: true` marks every row this script writes so
      // display code — and any future audit — can tell a reconstructed
      // row from charge-time truth.
      const periodStart = doc.createdAt;
      const periodEnd = subscription.firstChargeProrated ? endOfMonth(periodStart) : addOneMonth(periodStart);
      const monthlyFee = subscription.lastChargeAmount ?? 0;
      const registrationFeeCharged = subscription.registrationFeeCharged ?? 0;

      rewrite = {
        billingShape: 'subscription_cycle',
        serviceId: groupClassesService._id,
        subscriptionId: subscription._id,
        studentId: doc.studentId,
        scheduleId: doc.scheduleId,
        parentId: subscription.parentId,
        eventType: 'initial',
        status: 'completed',
        amount: monthlyFee + registrationFeeCharged,
        breakdown: {
          monthlyFee,
          prorated: subscription.firstChargeProrated ?? false,
          proratedAmount: subscription.firstChargeProrated ? monthlyFee : null,
          siblingDiscountApplied: subscription.lastSiblingDiscountApplied ?? false,
          siblingDiscountAmount: 0,
          registrationFeeCharged,
        },
        periodStart,
        periodEnd,
        stripePaymentIntentId: null,
        paidAt: doc.createdAt,
        backfilled: true,
      };
    }

    report.migrated.push({
      registrationId: doc._id.toString(),
      subscriptionId: subscription._id.toString(),
      amount: alreadyLedgerShaped ? doc.amount : rewrite.amount,
      alreadyLedgerShaped,
    });

    if (!dryRun) {
      // eslint-disable-next-line no-await-in-loop -- see note above.
      await registrations.updateOne({ _id: doc._id }, { $set: rewrite });
    }
  }

  return report;
}

module.exports = { migrateRegistrationsToLedger };
