const PrivateClassEnrollment = require('../../src/models/privateClassEnrollment.model');
const PrivateClassSession = require('../../src/models/privateClassSession.model');
const { PerSessionRegistration } = require('../../src/models/registration.model');
const { PENDING_HOLD_TTL_MINUTES } = require('../../src/services/privateClassSession.service');
const { SESSION_INDEX_NAME } = require('./retireRecurringPrivateClasses');

// Read-only reconciliation for private-lesson purchases (docs/decisions/011-
// private-per-session-booking.md). The Registration ledger is the source of
// truth for what was paid; a PrivateClassEnrollment's counters are the
// operational balance derived from it. This reports every place the two
// disagree, plus in-flight states a crash could have stranded. Never writes —
// the ledger wins any disagreement, and a human decides the fix.
//
// Finding kinds:
//   missing_payment        active purchase with no completed ledger row
//   quantity_mismatch      active purchase whose quantity != its paid row's
//   credit_count_drift     sessionsUsed != its slot-holding bookings
//   stale_pending_booking  a pending booking older than the hold TTL (with
//                          the ledger status, so a charge in flight is visible)
//   stale_pending_purchase a pending purchase older than the hold TTL
//   slot_index_not_partial the (scheduleId, startDate) index is still the
//                          recurring model's non-partial one, so a cancelled
//                          booking would block its slot forever — run
//                          scripts/retire-recurring-private-classes.js
//                          (Mongoose autoIndex cannot replace a same-named
//                          index; verified, it only logs the conflict)
async function checkPrivateCreditLedger({ now = new Date() } = {}) {
  const staleBefore = new Date(now.getTime() - PENDING_HOLD_TTL_MINUTES * 60000);
  const findings = [];

  const indexes = await PrivateClassSession.collection.indexes().catch(() => []);
  const slotIndex = indexes.find((index) => index.name === SESSION_INDEX_NAME);

  if (slotIndex && !slotIndex.partialFilterExpression) {
    findings.push({ kind: 'slot_index_not_partial', index: SESSION_INDEX_NAME });
  }

  const activeEnrollments = await PrivateClassEnrollment.find({ status: 'active' }).lean();
  const enrollmentIds = activeEnrollments.map((enrollment) => enrollment._id);

  const [payments, holdingCounts] = await Promise.all([
    PerSessionRegistration.find({ enrollmentId: { $in: enrollmentIds }, status: 'completed' }).lean(),
    PrivateClassSession.aggregate([
      { $match: { enrollmentId: { $in: enrollmentIds }, status: { $in: ['pending', 'confirmed'] } } },
      { $group: { _id: '$enrollmentId', count: { $sum: 1 } } },
    ]),
  ]);

  const paymentsByEnrollment = new Map();
  payments.forEach((payment) => {
    const key = String(payment.enrollmentId);
    paymentsByEnrollment.set(key, [...(paymentsByEnrollment.get(key) || []), payment]);
  });
  const holdingByEnrollment = new Map(holdingCounts.map((row) => [String(row._id), row.count]));

  activeEnrollments.forEach((enrollment) => {
    const key = String(enrollment._id);
    const paid = paymentsByEnrollment.get(key) || [];

    if (paid.length !== 1) {
      findings.push({ kind: 'missing_payment', enrollmentId: key, completedRows: paid.length });
    } else if (paid[0].quantity !== enrollment.quantity) {
      findings.push({
        kind: 'quantity_mismatch',
        enrollmentId: key,
        enrollmentQuantity: enrollment.quantity,
        paidQuantity: paid[0].quantity,
      });
    }

    const holding = holdingByEnrollment.get(key) || 0;

    if (holding !== enrollment.sessionsUsed) {
      findings.push({
        kind: 'credit_count_drift',
        enrollmentId: key,
        sessionsUsed: enrollment.sessionsUsed,
        slotHoldingBookings: holding,
      });
    }
  });

  const stalePendingSessions = await PrivateClassSession.find({
    status: 'pending',
    createdAt: { $lt: staleBefore },
  }).lean();

  for (const session of stalePendingSessions) {
    // eslint-disable-next-line no-await-in-loop -- a handful at most.
    const row = await PerSessionRegistration.findOne({ sessionId: session._id }).sort({ createdAt: -1 }).lean();
    findings.push({
      kind: 'stale_pending_booking',
      sessionId: String(session._id),
      enrollmentId: String(session.enrollmentId),
      ledgerStatus: row ? row.status : null,
    });
  }

  const stalePendingPurchases = await PrivateClassEnrollment.find({
    status: 'pending',
    createdAt: { $lt: staleBefore },
  }).lean();

  stalePendingPurchases.forEach((enrollment) => {
    findings.push({ kind: 'stale_pending_purchase', enrollmentId: String(enrollment._id) });
  });

  return { findings, scannedActiveEnrollments: activeEnrollments.length };
}

module.exports = { checkPrivateCreditLedger };
