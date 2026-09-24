const User = require('../models/user.model');
const PrivateClassSchedule = require('../models/privateClassSchedule.model');
const PrivateClassEnrollment = require('../models/privateClassEnrollment.model');
const PrivateClassSession = require('../models/privateClassSession.model');
const { PRIVATE_CLASS_SESSION_STATUSES } = require('../models/privateClassSession.model');
const { PerSessionRegistration } = require('../models/registration.model');
const privateClassScheduleService = require('./privateClassSchedule.service');
const visitService = require('./visit.service');
const mailService = require('./mail.service');
const invoiceService = require('./invoice.service');
const { badRequestError, forbiddenError, notFoundError, conflictError } = require('../utils/errors');
const { hasAdminRole } = require('../utils/roles');

// Private-lesson BOOKINGS (docs/decisions/011-private-per-session-booking.md).
// A PrivateClassSession is created only when a parent books one date of one
// availability rule; inserting it is the atomic slot claim. This file owns
// the booking primitives shared by both ways to book:
//   - with a purchase  -> privateClassEnrollment.service.js's purchaseAndBook
//   - with a credit    -> book() below
// plus attendance (a Visit — ADR 010, never money) and cancellation.

// A parent may cancel online until this many hours before the lesson; a
// coach or admin until it starts. Shown in the booking email too.
const PARENT_CANCEL_CUTOFF_HOURS = 24;

// A `pending` purchase hold older than this, with no charge in flight, is
// abandoned and may be released by the next booking attempt for that slot.
const PENDING_HOLD_TTL_MINUTES = 15;

const MS_PER_HOUR = 60 * 60 * 1000;
const SLOT_TAKEN_MESSAGE = 'This time slot was just taken — please pick another';

// ── Booking primitives ────────────────────────────────────────────────────

// Everything both booking paths validate before writing anything: the
// student belongs to the parent, the rule exists with a live coach, and the
// chosen day is bookable (privateClassScheduleService.resolveBookableInstant
// — the same rule the date picker uses).
async function loadBookingContext({ studentId, scheduleId, day }, parent) {
  const student = await User.findById(studentId);

  if (!student || student.role !== 'student') {
    throw notFoundError('Student not found');
  }

  if (String(student.parentId) !== String(parent._id)) {
    throw forbiddenError('This student does not belong to you');
  }

  const schedule = await PrivateClassSchedule.findById(scheduleId).populate('coachId', 'firstName lastName email');

  // A null populated coach means the coach was deleted without a
  // delete-guard blocking it (orphaned-coach-reference-fix-plan D4) — a
  // stale bookmarked link 404s instead of crashing.
  if (!schedule || !schedule.coachId) {
    throw notFoundError('Private class schedule not found');
  }

  const { startDate, endDate } = await privateClassScheduleService.resolveBookableInstant(schedule, day);

  return { student, schedule, coach: schedule.coachId, startDate, endDate };
}

// Releases an abandoned `pending` purchase hold on this exact slot so a new
// booking can take it. Never releases a hold whose charge is in flight or
// already succeeded (a pending/completed ledger row) — that one needs a
// human, and scripts/check-private-credit-ledger.js reports it.
async function releaseAbandonedHold(scheduleId, startDate) {
  const staleBefore = new Date(Date.now() - PENDING_HOLD_TTL_MINUTES * 60000);
  const hold = await PrivateClassSession.findOne({
    scheduleId,
    startDate,
    status: 'pending',
    createdAt: { $lt: staleBefore },
  });

  if (!hold) {
    return false;
  }

  const chargeInFlight = await PerSessionRegistration.exists({
    sessionId: hold._id,
    status: { $in: ['pending', 'completed'] },
  });

  if (chargeInFlight) {
    return false;
  }

  await PrivateClassSession.updateOne(
    { _id: hold._id, status: 'pending' },
    { $set: { status: 'released', releaseReason: 'abandoned' } }
  );
  await PrivateClassEnrollment.updateOne({ _id: hold.enrollmentId, status: 'pending' }, { $set: { status: 'failed' } });

  return true;
}

// The atomic slot claim: one insert against the partial unique index on
// (scheduleId, startDate). A lost race is a 409, after one attempt to
// release an abandoned hold on the slot.
async function reserveSlot(doc) {
  try {
    return await PrivateClassSession.create(doc);
  } catch (error) {
    if (error.code !== 11000) {
      throw error;
    }
  }

  if (!(await releaseAbandonedHold(doc.scheduleId, doc.startDate))) {
    throw conflictError(SLOT_TAKEN_MESSAGE);
  }

  try {
    return await PrivateClassSession.create(doc);
  } catch (error) {
    if (error.code === 11000) {
      throw conflictError(SLOT_TAKEN_MESSAGE);
    }
    throw error;
  }
}

// Gives one credit back to an enrollment; returns the updated enrollment.
async function returnCredit(enrollmentId) {
  return PrivateClassEnrollment.findOneAndUpdate(
    { _id: enrollmentId, sessionsUsed: { $gt: 0 } },
    { $inc: { sessionsUsed: -1 } },
    { new: true }
  );
}

// After a booking is confirmed by either path: the scheduled Visit
// attendance row, then the parent + coach emails. Emails (and the PDF invoice
// for a purchase) are fire-and-forget — they never fail a confirmed booking.
async function onBookingConfirmed({ session, enrollment, parent, student, coach, purchaseRow = null }) {
  await visitService.createScheduledPrivateVisit(session.studentId, session._id);

  try {
    let invoiceNumber;
    let invoicePdf;

    if (purchaseRow) {
      try {
        const invoiceData = await invoiceService.buildInvoiceData(purchaseRow);
        invoiceNumber = invoiceData.invoiceNumber;
        invoicePdf = await invoiceService.renderInvoicePdf(invoiceData);
      } catch (invoiceError) {
        // eslint-disable-next-line no-console -- operational logging for a
        // fire-and-forget PDF side effect, not debug output.
        console.error('privateClassSession.service: failed to generate invoice PDF:', invoiceError.message);
      }
    }

    await mailService.sendPrivateClassBookingConfirmationEmail({
      parent,
      student,
      coach,
      session,
      enrollment,
      purchaseRow,
      cancelCutoffHours: PARENT_CANCEL_CUTOFF_HOURS,
      invoiceNumber,
      invoicePdf,
    });
    await mailService.sendPrivateClassCoachBookingEmail({
      coach,
      parent,
      student,
      session,
      durationMinutes: enrollment.sessionDurationMinutes,
    });
  } catch (error) {
    // eslint-disable-next-line no-console -- operational logging for a
    // fire-and-forget email side effect, not debug output.
    console.error('privateClassSession.service: failed to send booking emails:', error.message);
  }
}

// ── Booking with a credit ─────────────────────────────────────────────────

// Books one date using a session the family already paid for. The credit is
// taken first — one atomic guarded $inc on the OLDEST active purchase of this
// student with this coach for this lesson length that still has one — then
// the slot is claimed; if the slot is taken, the credit goes straight back.
// No money moves and no ledger row is written.
async function book({ studentId, scheduleId, day }, parent) {
  const { student, schedule, coach, startDate, endDate } = await loadBookingContext(
    { studentId, scheduleId, day },
    parent
  );

  const enrollment = await PrivateClassEnrollment.findOneAndUpdate(
    {
      studentId: student._id,
      parentId: parent._id,
      coachId: coach._id,
      sessionDurationMinutes: schedule.durationMinutes,
      status: 'active',
      $expr: { $lt: ['$sessionsUsed', '$quantity'] },
    },
    { $inc: { sessionsUsed: 1 } },
    { sort: { createdAt: 1, _id: 1 }, new: true }
  );

  if (!enrollment) {
    throw conflictError(
      `${student.firstName} has no ${schedule.durationMinutes}-minute sessions left with this coach — buy more to book`
    );
  }

  let session;

  try {
    session = await reserveSlot({
      scheduleId: schedule._id,
      enrollmentId: enrollment._id,
      coachId: coach._id,
      studentId: student._id,
      parentId: parent._id,
      startDate,
      endDate,
      status: 'confirmed',
    });
  } catch (error) {
    await returnCredit(enrollment._id);
    throw error;
  }

  await onBookingConfirmed({ session, enrollment, parent, student, coach });

  return { session, enrollment, remaining: enrollment.quantity - enrollment.sessionsUsed };
}

// ── Attendance ────────────────────────────────────────────────────────────

function markedViaFor(user) {
  return hasAdminRole(user) ? 'admin' : 'coach';
}

// Coach-own | admin. Records attendance on the booking's Visit — never money
// (the lesson was paid at purchase). Only a confirmed booking whose lesson
// has started can be marked.
async function markAttendance(sessionId, status, requestingUser) {
  const session = await PrivateClassSession.findById(sessionId);

  if (!session) {
    throw notFoundError('Private class session not found');
  }

  const isAdmin = hasAdminRole(requestingUser);
  const isAssignedCoach =
    requestingUser.role === 'coach' && String(session.coachId) === String(requestingUser._id);

  if (!isAdmin && !isAssignedCoach) {
    throw forbiddenError('You are not the coach for this session');
  }

  if (session.status !== 'confirmed') {
    throw conflictError('Only a booked lesson can be marked');
  }

  if (session.startDate > new Date()) {
    throw badRequestError('Cannot record attendance for a lesson that has not started');
  }

  if (status !== 'attended' && status !== 'missed') {
    throw badRequestError("Attendance status must be 'attended' or 'missed'");
  }

  const visit = await visitService.markPrivateAttendance(
    session.studentId,
    session._id,
    status,
    requestingUser._id,
    markedViaFor(requestingUser)
  );

  return { session: { ...session.toObject(), attendance: visit.status }, visit };
}

// ── Cancellation ──────────────────────────────────────────────────────────

// Parent-own (until PARENT_CANCEL_CUTOFF_HOURS before the lesson), coach-own
// or admin (until it starts). The credit goes back to the purchase; no money
// moves (ADR 001 — no refunds). The slot reopens (the partial unique index
// no longer counts a cancelled booking).
async function cancel(sessionId, requestingUser) {
  const session = await PrivateClassSession.findById(sessionId);

  if (!session) {
    throw notFoundError('Private class session not found');
  }

  const isAdmin = hasAdminRole(requestingUser);
  const isAssignedCoach =
    requestingUser.role === 'coach' && String(session.coachId) === String(requestingUser._id);
  const isOwningParent =
    requestingUser.role === 'parent' && String(session.parentId) === String(requestingUser._id);

  if (!isAdmin && !isAssignedCoach && !isOwningParent) {
    throw forbiddenError('This booking does not belong to you');
  }

  if (session.status !== 'confirmed') {
    throw conflictError('Only a booked lesson can be cancelled');
  }

  const now = new Date();

  if (session.startDate <= now) {
    throw conflictError('This lesson has already started — mark attendance instead');
  }

  if (!isAdmin && !isAssignedCoach && session.startDate.getTime() - now.getTime() < PARENT_CANCEL_CUTOFF_HOURS * MS_PER_HOUR) {
    throw conflictError(
      `Lessons can be cancelled online up to ${PARENT_CANCEL_CUTOFF_HOURS} hours before they start — please contact the academy`
    );
  }

  const cancelled = await PrivateClassSession.findOneAndUpdate(
    { _id: session._id, status: 'confirmed' },
    { $set: { status: 'cancelled', cancelledAt: now, cancelledBy: requestingUser._id } },
    { new: true }
  );

  if (!cancelled) {
    throw conflictError('Only a booked lesson can be cancelled');
  }

  const enrollment = await returnCredit(cancelled.enrollmentId);
  await visitService.cancelPrivateVisit(cancelled._id);

  try {
    const [parent, student, coach] = await Promise.all([
      User.findById(cancelled.parentId),
      User.findById(cancelled.studentId),
      User.findById(cancelled.coachId),
    ]);

    await mailService.sendPrivateClassBookingCancelledEmail({ parent, student, coach, session: cancelled, enrollment });
  } catch (error) {
    // eslint-disable-next-line no-console -- operational logging for a
    // fire-and-forget email side effect, not debug output.
    console.error('privateClassSession.service: failed to send cancellation email:', error.message);
  }

  return {
    session: { ...cancelled.toObject(), attendance: 'cancelled' },
    remaining: enrollment ? enrollment.quantity - enrollment.sessionsUsed : null,
  };
}

// ── Listings ──────────────────────────────────────────────────────────────

// Every listing reads attendance from the Visit ledger (one query per list)
// and exposes it as `attendance` — a confirmed booking with no Visit reads
// 'scheduled'; a cancelled one reads 'cancelled'.
async function withAttendance(sessions) {
  const statusBySession = await visitService.getPrivateVisitStatusBySession(sessions.map((session) => session._id));

  return sessions.map((session) => {
    const plain = session.toObject ? session.toObject() : session;
    const fallback = plain.status === 'cancelled' ? 'cancelled' : 'scheduled';
    return { ...plain, attendance: statusBySession.get(String(plain._id)) || fallback };
  });
}

const COACH_WINDOWS = ['upcoming', 'unmarked', 'past'];

// A coach's own confirmed bookings. `upcoming` = not started, soonest first;
// `past` = started, newest first; `unmarked` = started and attendance still
// 'scheduled' (the coach's to-do list).
async function listMine(coachId, window) {
  if (window !== undefined && !COACH_WINDOWS.includes(window)) {
    throw badRequestError(`window must be one of: ${COACH_WINDOWS.join(', ')}`);
  }

  const now = new Date();
  const filter = { coachId, status: 'confirmed' };

  if (window === 'upcoming') {
    filter.startDate = { $gt: now };
  } else if (window === 'unmarked' || window === 'past') {
    filter.startDate = { $lte: now };
  }

  const sessions = await PrivateClassSession.find(filter)
    .populate('studentId', 'firstName lastName')
    .populate('parentId', 'firstName lastName')
    .sort({ startDate: window === 'upcoming' ? 1 : -1 });

  const rows = await withAttendance(sessions);

  return window === 'unmarked' ? rows.filter((row) => row.attendance === 'scheduled') : rows;
}

const ADMIN_DEFAULT_STATUSES = ['confirmed', 'cancelled'];

// Admin: every booking (confirmed + cancelled by default), newest lesson
// first, optionally for one coach or one status.
async function listAll({ coachId, status } = {}) {
  const filter = { status: { $in: ADMIN_DEFAULT_STATUSES } };

  if (status) {
    if (!PRIVATE_CLASS_SESSION_STATUSES.includes(status)) {
      throw badRequestError(`status must be one of: ${PRIVATE_CLASS_SESSION_STATUSES.join(', ')}`);
    }
    filter.status = status;
  }

  if (coachId) {
    filter.coachId = coachId;
  }

  const sessions = await PrivateClassSession.find(filter)
    .populate('coachId', 'firstName lastName')
    .populate('studentId', 'firstName lastName')
    .populate('parentId', 'firstName lastName')
    .sort({ startDate: -1 });

  return withAttendance(sessions);
}

// A purchase's bookings, soonest first — the parent's view of one enrollment.
async function listForEnrollments(enrollmentIds) {
  const sessions = await PrivateClassSession.find({
    enrollmentId: { $in: enrollmentIds },
    status: { $in: ADMIN_DEFAULT_STATUSES },
  }).sort({ startDate: 1 });

  return withAttendance(sessions);
}

module.exports = {
  PARENT_CANCEL_CUTOFF_HOURS,
  PENDING_HOLD_TTL_MINUTES,
  loadBookingContext,
  reserveSlot,
  onBookingConfirmed,
  book,
  markAttendance,
  cancel,
  listMine,
  listAll,
  listForEnrollments,
};
