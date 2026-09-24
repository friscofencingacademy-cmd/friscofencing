const PrivateClassSchedule = require('../../src/models/privateClassSchedule.model');
const PrivateClassEnrollment = require('../../src/models/privateClassEnrollment.model');
const PrivateClassSession = require('../../src/models/privateClassSession.model');
const { SLOT_HOLDING_STATUSES } = require('../../src/models/privateClassSession.model');
const { PerSessionRegistration } = require('../../src/models/registration.model');
const { todayDateOnly } = require('../../src/utils/billingDates');
const { addDaysToDateOnly } = require('../../src/utils/dateShapes');

// One-time cutover from the recurring private-class model to per-session
// bookings (docs/plans/private-class-per-session-booking-plan.md §2.11,
// ADR 011). Run on staging, then production, BEFORE deploying the booking
// backend.
//
// Old-shape documents are recognized by what the new schema requires and the
// old one never had:
//   - PrivateClassSchedule with a studentId/enrollmentId claim field, or no
//     startDate/endDate range
//   - PrivateClassEnrollment without `quantity`
//   - PrivateClassSession without `status`
//   - per_session Registration rows without `quantity`
//
// THE GATE: an old-shape ledger row that is pending or completed means real
// money moved under the old model. The cutover then refuses to write
// anything — deciding what that money bought is the owner's call, not a
// script's. Only `failed` old rows (no money moved) are removed.
//
// Otherwise, with { apply: true }: schedules lose their claim fields and any
// schedule without a range gets [today, today + 89 days] (reported, so the
// coach can adjust); old sessions, enrollments and failed old ledger rows are
// deleted; the old non-partial (scheduleId, startDate) unique index is
// replaced by the partial one the booking model needs (same name — so it has
// to be dropped first; autoIndex never replaces an index whose name exists).
// Idempotent: a second run finds nothing to change.

const SESSION_INDEX_NAME = 'scheduleId_1_startDate_1';
const DEFAULT_RANGE_DAYS = 89;

async function findSessionIndex() {
  try {
    const indexes = await PrivateClassSession.collection.indexes();
    return indexes.find((index) => index.name === SESSION_INDEX_NAME) || null;
  } catch (error) {
    // The collection does not exist yet — nothing to replace.
    if (error.codeName === 'NamespaceNotFound' || error.code === 26) return null;
    throw error;
  }
}

async function retireRecurringPrivateClasses({ apply = false } = {}) {
  const [claimedSchedules, rangelessSchedules, oldEnrollments, oldSessions, oldLedgerRows] = await Promise.all([
    PrivateClassSchedule.collection
      .find({ $or: [{ studentId: { $exists: true } }, { enrollmentId: { $exists: true } }] }, { projection: { _id: 1 } })
      .toArray(),
    PrivateClassSchedule.collection
      .find({ $or: [{ startDate: { $exists: false } }, { endDate: { $exists: false } }] }, { projection: { _id: 1 } })
      .toArray(),
    PrivateClassEnrollment.collection.find({ quantity: { $exists: false } }, { projection: { _id: 1 } }).toArray(),
    PrivateClassSession.collection.find({ status: { $exists: false } }, { projection: { _id: 1 } }).toArray(),
    PerSessionRegistration.collection
      .find({ billingShape: 'per_session', quantity: { $exists: false } }, { projection: { _id: 1, status: 1 } })
      .toArray(),
  ]);

  const moneyRows = oldLedgerRows.filter((row) => row.status === 'pending' || row.status === 'completed');
  const sessionIndex = await findSessionIndex();
  const indexNeedsReplacing = Boolean(sessionIndex && !sessionIndex.partialFilterExpression);

  const report = {
    claimedSchedules: claimedSchedules.length,
    rangelessScheduleIds: rangelessSchedules.map((schedule) => String(schedule._id)),
    oldEnrollments: oldEnrollments.length,
    oldSessions: oldSessions.length,
    oldFailedLedgerRows: oldLedgerRows.length - moneyRows.length,
    oldMoneyLedgerRows: moneyRows.length,
    indexNeedsReplacing,
    aborted: false,
    applied: false,
  };

  if (moneyRows.length > 0) {
    report.aborted = true;
    return report;
  }

  if (!apply) {
    return report;
  }

  if (claimedSchedules.length > 0) {
    await PrivateClassSchedule.collection.updateMany(
      { _id: { $in: claimedSchedules.map((schedule) => schedule._id) } },
      { $unset: { studentId: '', enrollmentId: '' } }
    );
  }

  if (rangelessSchedules.length > 0) {
    const today = todayDateOnly();
    await PrivateClassSchedule.collection.updateMany(
      { _id: { $in: rangelessSchedules.map((schedule) => schedule._id) } },
      { $set: { startDate: today, endDate: addDaysToDateOnly(today, DEFAULT_RANGE_DAYS) } }
    );
  }

  if (oldLedgerRows.length > 0) {
    await PerSessionRegistration.collection.deleteMany({ _id: { $in: oldLedgerRows.map((row) => row._id) } });
  }

  if (oldSessions.length > 0) {
    await PrivateClassSession.collection.deleteMany({ _id: { $in: oldSessions.map((session) => session._id) } });
  }

  if (oldEnrollments.length > 0) {
    await PrivateClassEnrollment.collection.deleteMany({
      _id: { $in: oldEnrollments.map((enrollment) => enrollment._id) },
    });
  }

  if (indexNeedsReplacing) {
    await PrivateClassSession.collection.dropIndex(SESSION_INDEX_NAME);
    await PrivateClassSession.collection.createIndex(
      { scheduleId: 1, startDate: 1 },
      { name: SESSION_INDEX_NAME, unique: true, partialFilterExpression: { status: { $in: SLOT_HOLDING_STATUSES } } }
    );
  }

  report.applied = true;
  return report;
}

module.exports = { retireRecurringPrivateClasses, SESSION_INDEX_NAME };
