const PrivateClassSchedule = require('../models/privateClassSchedule.model');
const PrivateClassEnrollment = require('../models/privateClassEnrollment.model');
const PrivateClassSession = require('../models/privateClassSession.model');
const { PerSessionRegistration } = require('../models/registration.model');
const User = require('../models/user.model');
const stripe = require('../config/stripe');
const paymentMethodService = require('./paymentMethod.service');
const { ensureStripeCustomer } = require('./stripeCustomer.service');
const { getServiceByCode, assertBillingShape } = require('./serviceCatalog.service');
const { computeSessionPrice, sessionDurationMinutes } = require('../utils/privateClassPricing');
const { nextOccurrenceStrictlyAfter } = require('../utils/scheduleOccurrence');
const mailService = require('./mail.service');
const invoiceService = require('./invoice.service');

// Mirrors group's 8-week generateInitialSessions window (groupClassSession.
// service.js) — consistency over CKQ's own 10-week private-class window.
const SESSION_WEEKS = 8;

function notFoundError(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function forbiddenError(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}

function badRequestError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function conflictError(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

// Combines a midnight-normalized calendar date with an "HH:mm" wall-clock
// string into one Date instant.
function combineDateAndTime(date, hhmm) {
  const [hours, minutes] = String(hhmm).split(':').map(Number);
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

// Generates the next 8 weekly occurrences for every claimed active slot of
// `enrollmentId`, starting from the first occurrence of the slot's
// dayOfWeek STRICTLY AFTER today. Idempotent: skips any startDate that
// already has a session (in-memory dedup, backstopped by the model's
// unique (scheduleId, startDate) index) — safe to re-run (see
// scripts/extend-private-sessions.js).
async function generateSessions({ enrollmentId }) {
  const enrollment = await PrivateClassEnrollment.findById(enrollmentId);

  if (!enrollment) {
    return { sessions: [], firstSessionDate: null };
  }

  const schedules = await PrivateClassSchedule.find({ enrollmentId, isActive: true });

  const today = new Date();
  let allCreated = [];
  let firstSessionDate = null;

  for (const schedule of schedules) {
    const firstOccurrence = nextOccurrenceStrictlyAfter(today, schedule.dayOfWeek);

    // eslint-disable-next-line no-await-in-loop -- sequential over a small
    // (typically single-element) list of a student's own claimed slots.
    const existing = await PrivateClassSession.find({ scheduleId: schedule._id }, 'startDate');
    const existingTimes = new Set(existing.map((s) => s.startDate.getTime()));

    const toCreate = [];

    for (let i = 0; i < SESSION_WEEKS; i += 1) {
      const occurrenceDate = new Date(firstOccurrence);
      occurrenceDate.setDate(occurrenceDate.getDate() + i * 7);

      const startDate = combineDateAndTime(occurrenceDate, schedule.startTime);
      const endDate = new Date(startDate.getTime() + schedule.durationMinutes * 60000);

      if (existingTimes.has(startDate.getTime())) {
        continue;
      }

      toCreate.push({
        scheduleId: schedule._id,
        enrollmentId,
        coachId: schedule.coachId,
        studentId: enrollment.studentId,
        parentId: enrollment.parentId,
        startDate,
        endDate,
        attendance: 'scheduled',
      });
    }

    if (toCreate.length) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const inserted = await PrivateClassSession.insertMany(toCreate, { ordered: false });
        allCreated = allCreated.concat(inserted);
      } catch (error) {
        // Duplicate-key errors from the unique index backstop are expected
        // and safe to ignore (a concurrent/re-run generator already
        // created that occurrence) — anything else propagates.
        const isDuplicateKeyOnly =
          error.code === 11000 ||
          (Array.isArray(error.writeErrors) && error.writeErrors.every((e) => e.code === 11000));

        if (!isDuplicateKeyOnly) {
          throw error;
        }

        if (Array.isArray(error.insertedDocs)) {
          allCreated = allCreated.concat(error.insertedDocs);
        }
      }
    }

    const scheduleFirstSessionDate = combineDateAndTime(firstOccurrence, schedule.startTime);

    if (!firstSessionDate || scheduleFirstSessionDate < firstSessionDate) {
      firstSessionDate = scheduleFirstSessionDate;
    }
  }

  return { sessions: allCreated, firstSessionDate };
}

// The actual money step behind markAttendance('attended'). Separated out
// so retryCharge() can re-run it verbatim.
async function chargeSession(session) {
  // Fresh re-fetch — never trust a snapshot (same cancel-then-charge race
  // discipline as renewal.service.js's renewOne).
  const enrollment = await PrivateClassEnrollment.findById(session.enrollmentId);

  const stillBillable =
    enrollment &&
    (enrollment.status === 'active' ||
      (enrollment.status === 'cancelled' &&
        enrollment.endDate &&
        session.startDate <= enrollment.endDate));

  if (!stillBillable) {
    return { charged: false, reason: 'enrollment_cancelled', charge: null };
  }

  const existingCharge = await PerSessionRegistration.findOne({
    sessionId: session._id,
    status: { $in: ['pending', 'completed'] },
  });

  if (existingCharge) {
    // Idempotent — a double-save of the same attendance never
    // double-charges.
    return { charged: existingCharge.status === 'completed', charge: existingCharge };
  }

  const amount = computeSessionPrice(
    enrollment.agreedHourlyRate,
    sessionDurationMinutes(session.startDate, session.endDate)
  );

  const failedCount = await PerSessionRegistration.countDocuments({
    sessionId: session._id,
    status: 'failed',
  });
  const attempt = failedCount + 1;

  // Resolved BEFORE creating the pending ledger row — a misconfigured/
  // inactive service must never let this session end up "charged" without a
  // resolvable serviceId (docs/plans/service-registry-unified-ledger-plan
  // .md D4).
  const privateLessonsService = await getServiceByCode('private-lessons', { requireActive: true });
  assertBillingShape(privateLessonsService, 'per_session');

  let charge;

  try {
    charge = await PerSessionRegistration.create({
      serviceId: privateLessonsService._id,
      sessionId: session._id,
      enrollmentId: enrollment._id,
      parentId: enrollment.parentId,
      studentId: enrollment.studentId,
      amount,
      status: 'pending',
      attempt,
    });
  } catch (error) {
    if (error.code === 11000) {
      const existing = await PerSessionRegistration.findOne({
        sessionId: session._id,
        status: { $in: ['pending', 'completed'] },
      });
      return { charged: existing ? existing.status === 'completed' : false, charge: existing || null };
    }

    throw error;
  }

  const parent = await User.findById(enrollment.parentId);
  const student = await User.findById(enrollment.studentId);
  const paymentMethod = await paymentMethodService.getMine(enrollment.parentId);

  if (!paymentMethod) {
    charge.status = 'failed';
    charge.failureMessage = 'No payment method on file';
    await charge.save();

    try {
      await mailService.sendPrivateClassPaymentFailedEmail({
        parent,
        student,
        sessionDate: session.startDate,
        amount,
      });
    } catch (error) {
      // eslint-disable-next-line no-console -- operational logging for a
      // fire-and-forget email side effect, not debug output.
      console.error('privateClassSession.service: failed to send payment-failed email:', error.message);
    }

    return { charged: false, chargeStatus: 'failed', charge };
  }

  const stripeCustomerId = await ensureStripeCustomer(parent);

  let paymentIntent;

  try {
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: Math.round(amount * 100),
        currency: 'usd',
        customer: stripeCustomerId,
        payment_method: paymentMethod.stripePaymentMethodId,
        off_session: true,
        confirm: true,
      },
      // CKQ-BUG-FIX: suffixed by `attempt` (unlike CKQ's un-suffixed key,
      // which made Stripe replay a cached decline for 24h and blocked
      // same-day retry). Each retry gets its own idempotency key.
      { idempotencyKey: `pcs_${session._id}_${attempt}` }
    );
  } catch (error) {
    if (error.type === 'StripeCardError') {
      charge.status = 'failed';
      charge.failureMessage = error.message;
      await charge.save();

      try {
        await mailService.sendPrivateClassPaymentFailedEmail({
          parent,
          student,
          sessionDate: session.startDate,
          amount,
        });
      } catch (mailError) {
        // eslint-disable-next-line no-console -- operational logging for a
        // fire-and-forget email side effect, not debug output.
        console.error(
          'privateClassSession.service: failed to send payment-failed email:',
          mailError.message
        );
      }

      return { charged: false, chargeStatus: 'failed', charge };
    }

    throw error;
  }

  if (paymentIntent.status !== 'succeeded') {
    charge.status = 'failed';
    charge.failureMessage = 'Payment failed';
    await charge.save();
    return { charged: false, chargeStatus: 'failed', charge };
  }

  charge.status = 'completed';
  charge.paidAt = new Date();
  charge.stripePaymentIntentId = paymentIntent.id;
  await charge.save();

  try {
    const coach = await User.findById(enrollment.coachId);

    // PDF invoice attachment (docs/plans/manual-charge-and-pdf-invoice-
    // plan.md PR 2) — its OWN try/catch so a generation failure drops only
    // the attachment, never the receipt email itself. `charge` is already
    // 'completed' in memory here (the `.save()` above mutates the real
    // Mongoose document, unlike the group-class ledger's findByIdAndUpdate
    // path — no re-fetch needed).
    let invoiceNumber;
    let invoicePdf;

    try {
      const invoiceData = await invoiceService.buildInvoiceData(charge);
      invoiceNumber = invoiceData.invoiceNumber;
      invoicePdf = await invoiceService.renderInvoicePdf(invoiceData);
    } catch (invoiceError) {
      // eslint-disable-next-line no-console -- operational logging for a
      // fire-and-forget PDF-generation side effect, not debug output.
      console.error('privateClassSession.service: failed to generate invoice PDF:', invoiceError.message);
    }

    await mailService.sendPrivateClassSessionReceiptEmail({
      parent,
      student,
      coach,
      sessionDate: session.startDate,
      durationMinutes: sessionDurationMinutes(session.startDate, session.endDate),
      amount,
      invoiceNumber,
      invoicePdf,
    });
  } catch (error) {
    // eslint-disable-next-line no-console -- operational logging for a
    // fire-and-forget email side effect, not debug output.
    console.error('privateClassSession.service: failed to send receipt email:', error.message);
  }

  return { charged: true, chargeStatus: 'completed', charge };
}

// admin/superadmin may mark any session; a coach only their own
// (CKQ-BUG-FIX — CKQ lets any coach mark any session).
async function markAttendance(sessionId, status, requestingUser) {
  const session = await PrivateClassSession.findById(sessionId);

  if (!session) {
    throw notFoundError('Private class session not found');
  }

  const isAdmin = requestingUser.role === 'admin' || requestingUser.role === 'superadmin';
  const isAssignedCoach =
    requestingUser.role === 'coach' && String(session.coachId) === String(requestingUser._id);

  if (!isAdmin && !isAssignedCoach) {
    throw forbiddenError('You are not the coach for this session');
  }

  if (!(session.startDate <= new Date())) {
    throw badRequestError('Cannot record attendance for a session that has not yet occurred');
  }

  if (status !== 'attended' && status !== 'missed') {
    throw badRequestError("Attendance status must be 'attended' or 'missed'");
  }

  const completedCharge = await PerSessionRegistration.findOne({ sessionId, status: 'completed' });

  if (completedCharge && status !== 'attended') {
    throw conflictError('This session has already been charged');
  }

  session.attendance = status;
  session.markedBy = requestingUser._id;
  session.markedAt = new Date();
  await session.save();

  let chargeOutcome = { charged: false, charge: completedCharge || null };

  if (status === 'attended') {
    chargeOutcome = await chargeSession(session);
  }

  return { session, ...chargeOutcome };
}

// Only when the session's latest charge is 'failed' — re-runs
// chargeSession() verbatim, which mints a fresh idempotency key via the
// bumped `attempt` count.
async function retryCharge(sessionId, requestingUser) {
  const session = await PrivateClassSession.findById(sessionId);

  if (!session) {
    throw notFoundError('Private class session not found');
  }

  const isAdmin = requestingUser.role === 'admin' || requestingUser.role === 'superadmin';
  const isAssignedCoach =
    requestingUser.role === 'coach' && String(session.coachId) === String(requestingUser._id);

  if (!isAdmin && !isAssignedCoach) {
    throw forbiddenError('You are not the coach for this session');
  }

  const latestCharge = await PerSessionRegistration.findOne({ sessionId }).sort({ createdAt: -1 });

  if (!latestCharge || latestCharge.status !== 'failed') {
    throw conflictError('This session does not have a failed charge to retry');
  }

  const outcome = await chargeSession(session);

  return { session, ...outcome };
}

// Enriches each session with a backend-computed `sessionPrice` (rate x
// duration/60, from the enrollment's PINNED agreedHourlyRate) and populates
// parentId's display name — the coach page's confirm-attendance dialog
// shows the exact charge amount before marking, and no pricing math is
// ever allowed on the frontend (Hard Rule 7).
async function listMine(coachId, window) {
  const now = new Date();
  const filter = { coachId };

  if (window === 'upcoming') {
    filter.startDate = { $gt: now };
  } else if (window === 'unmarked') {
    filter.startDate = { $lte: now };
    filter.attendance = 'scheduled';
  } else if (window === 'past') {
    filter.startDate = { $lte: now };
  }

  const sessions = await PrivateClassSession.find(filter)
    .populate('studentId', 'firstName lastName')
    .populate('parentId', 'firstName lastName')
    .sort({ startDate: window === 'upcoming' ? 1 : -1 });

  const enrollmentIds = [...new Set(sessions.map((session) => String(session.enrollmentId)))];
  const enrollments = await PrivateClassEnrollment.find({ _id: { $in: enrollmentIds } });
  const rateByEnrollmentId = new Map(
    enrollments.map((enrollment) => [String(enrollment._id), enrollment.agreedHourlyRate])
  );

  return sessions.map((session) => {
    const rate = rateByEnrollmentId.get(String(session.enrollmentId));
    let sessionPrice = null;

    if (rate !== undefined) {
      try {
        sessionPrice = computeSessionPrice(rate, sessionDurationMinutes(session.startDate, session.endDate));
      } catch (error) {
        sessionPrice = null;
      }
    }

    const plain = session.toObject();
    plain.sessionPrice = sessionPrice;
    return plain;
  });
}

module.exports = { generateSessions, markAttendance, retryCharge, listMine };
