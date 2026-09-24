const Visit = require('../../src/models/visit.model');
const { getServiceByCode } = require('../../src/services/serviceCatalog.service');

// One-time migration for docs/plans/private-class-per-session-booking-plan.md
// §1.3 (ADR 010) — stamps `serviceId` on every Visit that predates the field.
// Every such row is a group-class visit (Visit was group-only until ADR 010),
// so each gets the 'group-classes' Service id.
//
// Dry-run by default: returns the report without writing anything. Pass
// `{ apply: true }` to persist — same contract as backfillSessionInstants.js.
//
// Idempotent: a row that already has a serviceId is never touched. A row
// with no serviceId AND no groupClassSessionId cannot be classified — the
// WHOLE run aborts with nothing written rather than guess its service.
async function backfillVisitService({ apply = false } = {}) {
  const visits = await Visit.collection
    .find({ serviceId: { $exists: false } }, { projection: { _id: 1, groupClassSessionId: 1 } })
    .toArray();

  const report = { scannedCount: visits.length, updatedCount: 0, aborted: false, abortReason: null };

  if (visits.length === 0) {
    return report;
  }

  const unclassifiable = visits.find((visit) => !visit.groupClassSessionId);

  if (unclassifiable) {
    report.aborted = true;
    report.abortReason = {
      docId: unclassifiable._id,
      reason: 'no serviceId and no groupClassSessionId — cannot tell which service it belongs to',
    };
    return report;
  }

  const groupService = await getServiceByCode('group-classes');

  if (apply) {
    const result = await Visit.collection.updateMany(
      { _id: { $in: visits.map((visit) => visit._id) }, serviceId: { $exists: false } },
      { $set: { serviceId: groupService._id } }
    );
    report.updatedCount = result.modifiedCount;
  }

  return report;
}

module.exports = { backfillVisitService };
