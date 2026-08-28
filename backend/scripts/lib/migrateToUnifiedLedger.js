// One-time migration (docs/plans/service-registry-unified-ledger-plan.md
// D6): absorbs the standalone PrivateClassCharge collection into the
// unified Registration ledger, and stamps every pre-existing group-class
// Registration row with the serviceId/billingShape the restructured schema
// now requires. Raw-collection writes throughout, deliberately bypassing
// Mongoose validation/discriminator machinery — the entire point of this
// script is bringing OLD-shape documents up to the NEW schema's required
// fields, so it can never depend on that schema to write them (same
// reasoning scripts/lib/migrateRegistrationsToLedger.js already documents
// for its own, earlier migration).
//
// Idempotent by construction: re-running finds nothing left to stamp
// (billingShape already set) and every private charge already copied
// (matched by preserved _id), so nothing is ever double-written.

const mongoose = require('mongoose');
const { seedServices } = require('./seedServices');
const CoachContract = require('../../src/models/coachContract.model');

const PRIVATE_CHARGES_COLLECTION = 'privateclasscharges';

async function migrateToUnifiedLedger({ dryRun = true } = {}) {
  // Precondition — idempotent, safe to call every run; guarantees the two
  // service ids resolved below always exist.
  await seedServices();

  const db = mongoose.connection.db;
  const registrations = db.collection('registrations');
  const privateCharges = db.collection(PRIVATE_CHARGES_COLLECTION);
  const services = db.collection('services');

  const groupClassesService = await services.findOne({ code: 'group-classes' });
  const privateLessonsService = await services.findOne({ code: 'private-lessons' });

  const report = {
    dryRun,
    groupRowsToStamp: 0,
    groupRowsNotYetLedgerShaped: [],
    privateChargesFound: 0,
    privateChargesCopied: 0,
    privateChargesAlreadyPresent: 0,
    coachContractsToBackfill: 0,
    verified: false,
    aborted: false,
    abortReason: null,
  };

  // ── Step: stamp existing group rows missing billingShape ─────────────────
  // Defensive against a genuinely ancient 3-field doc that never went
  // through scripts/lib/migrateRegistrationsToLedger.js (registration-
  // ledger-plan.md D8) — that script must run FIRST on any environment that
  // might still have those; a doc missing `amount`/`eventType`/
  // `periodStart` entirely is NOT a doc this step can safely stamp (it
  // would come out "shaped" but still missing required ledger content), so
  // it's reported separately instead of touched.
  const unstamped = await registrations.find({ billingShape: { $exists: false } }).toArray();
  const readyToStamp = unstamped.filter(
    (doc) => doc.amount !== undefined && doc.eventType !== undefined && doc.periodStart !== undefined
  );
  const notReadyToStamp = unstamped.filter((doc) => !readyToStamp.includes(doc));

  report.groupRowsToStamp = readyToStamp.length;
  report.groupRowsNotYetLedgerShaped = notReadyToStamp.map((doc) => doc._id.toString());

  if (!dryRun && readyToStamp.length > 0) {
    await registrations.updateMany(
      { _id: { $in: readyToStamp.map((doc) => doc._id) } },
      { $set: { billingShape: 'subscription_cycle', serviceId: groupClassesService._id } }
    );
  }

  // ── Step: copy private charges, preserving _id ────────────────────────────
  // Preserving _id is what makes a re-run trivially idempotent — an
  // already-copied row's _id collides on insert (checked explicitly below,
  // not relied on as an E11000 catch, so a dry run can report the same
  // "already present" count a live run would act on).
  const chargeDocs = await privateCharges.find({}).toArray();
  report.privateChargesFound = chargeDocs.length;

  for (const charge of chargeDocs) {
    // eslint-disable-next-line no-await-in-loop -- sequential by design, a
    // one-time migration script has no reason to fan out writes.
    const alreadyPresent = await registrations.findOne({ _id: charge._id });

    if (alreadyPresent) {
      report.privateChargesAlreadyPresent += 1;
      // eslint-disable-next-line no-continue -- clearer than nesting the
      // rest of this loop body one level deeper.
      continue;
    }

    if (!dryRun) {
      // eslint-disable-next-line no-await-in-loop -- see note above.
      await registrations.insertOne({
        _id: charge._id,
        serviceId: privateLessonsService._id,
        billingShape: 'per_session',
        sessionId: charge.sessionId,
        enrollmentId: charge.enrollmentId,
        studentId: charge.studentId,
        parentId: charge.parentId,
        amount: charge.amount,
        status: charge.status,
        stripePaymentIntentId: charge.stripePaymentIntentId ?? null,
        attempt: charge.attempt ?? 1,
        failureMessage: charge.failureMessage ?? null,
        paidAt: charge.paidAt ?? null,
        backfilled: false,
        createdAt: charge.createdAt,
        updatedAt: charge.updatedAt,
      });
    }

    report.privateChargesCopied += 1;
  }

  // ── Step: backfill CoachContract.serviceId ────────────────────────────────
  const contractsMissingService = await CoachContract.countDocuments({ serviceId: { $exists: false } });
  report.coachContractsToBackfill = contractsMissingService;

  if (!dryRun && contractsMissingService > 0) {
    await CoachContract.updateMany(
      { serviceId: { $exists: false } },
      { $set: { serviceId: privateLessonsService._id } }
    );
  }

  // Dry run stops here — everything above was read-only for it.
  if (dryRun) {
    return report;
  }

  // ── Verify, then only THEN drop the retired collection ────────────────────
  const sourceCount = chargeDocs.length;
  const destCount = await registrations.countDocuments({ billingShape: 'per_session' });
  // Only counts docs THIS run was supposed to stamp and didn't — a
  // deliberately-skipped ancient (not-yet-ledger-shaped) doc is not a
  // verification failure, it's the documented "run migrate-registrations-
  // to-ledger.js first" case (see the stamp step above).
  const remainingUnstamped = readyToStamp.length > 0
    ? await registrations.countDocuments({
        _id: { $in: readyToStamp.map((doc) => doc._id) },
        billingShape: { $exists: false },
      })
    : 0;
  const remainingContractsMissingService = await CoachContract.countDocuments({ serviceId: { $exists: false } });

  const sourceByStatus = {};
  chargeDocs.forEach((charge) => {
    sourceByStatus[charge.status] = (sourceByStatus[charge.status] || 0) + 1;
  });

  let statusMismatch = false;
  const statusChecks = await Promise.all(
    Object.keys(sourceByStatus).map(async (status) => {
      const destStatusCount = await registrations.countDocuments({ billingShape: 'per_session', status });
      return destStatusCount >= sourceByStatus[status];
    })
  );
  statusMismatch = statusChecks.some((ok) => !ok);

  if (destCount < sourceCount || remainingUnstamped > 0 || remainingContractsMissingService > 0 || statusMismatch) {
    report.aborted = true;
    report.abortReason =
      `Verification failed — destCount=${destCount} sourceCount=${sourceCount} ` +
      `remainingUnstamped=${remainingUnstamped} remainingContractsMissingService=${remainingContractsMissingService} ` +
      `statusMismatch=${statusMismatch}. Nothing dropped.`;
    return report;
  }

  report.verified = true;

  // Only drop if the collection actually exists — calling .drop() on a
  // never-materialized collection (e.g. an environment with zero private
  // charges ever written) throws "ns not found".
  const chargesCollectionExists = await db.listCollections({ name: PRIVATE_CHARGES_COLLECTION }).hasNext();
  if (chargesCollectionExists) {
    await privateCharges.drop();
  }

  return report;
}

module.exports = { migrateToUnifiedLedger };
