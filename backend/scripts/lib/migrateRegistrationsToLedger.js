// Rewrites this repo's original 3-field Registration docs
// ({studentId, scheduleId, status: 'active'|'cancelled'}) into the payment
// ledger's real shape (docs/plans/registration-ledger-plan.md D8) — the
// registration.model.js schema itself was already replaced; this is what
// migrates whatever data existed under the old shape onto it. Old-shape docs
// are identified by the absence of `eventType` (every doc the new schema
// creates going forward always sets it), not by a manual id list — so this
// is safe to re-run: a doc it already rewrote is never picked up again.
//
// A doc whose (studentId, scheduleId) pair can't be matched to ANY
// Subscription is left completely untouched — never force-written with a
// fabricated subscriptionId, which the new schema requires — and reported
// as an orphan for manual review instead. This is the D8 "leave for manual
// review" case.

const Subscription = require('../../src/models/subscription.model');
const Registration = require('../../src/models/registration.model');
const { addOneMonth, endOfMonth } = require('../../src/utils/billingDates');

// Prefers the student's currently-active subscription for this schedule;
// falls back to the most recently created one (active or not) if none is
// active — a cancelled-since student's history still deserves a real
// subscriptionId rather than being dropped into the orphan pile.
async function findBestSubscription(studentId, scheduleId) {
  const active = await Subscription.findOne({ studentId, scheduleId, status: 'active' });

  if (active) {
    return active;
  }

  return Subscription.findOne({ studentId, scheduleId }).sort({ createdAt: -1 });
}

async function migrateRegistrationsToLedger({ dryRun = true } = {}) {
  const legacyDocs = await Registration.find({ eventType: { $exists: false } });

  const report = {
    dryRun,
    totalLegacyDocs: legacyDocs.length,
    migrated: [],
    orphaned: [],
  };

  for (const doc of legacyDocs) {
    // eslint-disable-next-line no-await-in-loop -- sequential by design: a
    // one-time, low-volume migration script has no reason to fan out writes,
    // and sequential processing keeps the printed report's ordering sane.
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

    // Best-effort reconstruction — there is no historical snapshot of this
    // charge's own breakdown at the time it happened, only the
    // Subscription's CURRENT last-known snapshot fields (which a later
    // renewal may have already overwritten). `periodStart` uses the OLD
    // Registration doc's own `createdAt` (the real historical moment this
    // enrollment was created), not the Subscription's `currentPeriodStart`
    // (which may have rolled forward many renewals since). `backfilled:
    // true` marks every row this script writes so display code — and any
    // future audit — can tell a reconstructed row from charge-time truth.
    const periodStart = doc.createdAt;
    const periodEnd = subscription.firstChargeProrated
      ? endOfMonth(periodStart)
      : addOneMonth(periodStart);
    const monthlyFee = subscription.lastChargeAmount ?? 0;
    const registrationFeeCharged = subscription.registrationFeeCharged ?? 0;

    const rewrite = {
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

    report.migrated.push({
      registrationId: doc._id.toString(),
      subscriptionId: subscription._id.toString(),
      amount: rewrite.amount,
    });

    if (!dryRun) {
      doc.set(rewrite);
      // eslint-disable-next-line no-await-in-loop -- see note above.
      await doc.save();
    }
  }

  return report;
}

module.exports = { migrateRegistrationsToLedger };
