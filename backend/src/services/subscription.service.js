const Subscription = require('../models/subscription.model');
const Registration = require('../models/registration.model');
const GroupClassSchedule = require('../models/groupClassSchedule.model');
const GroupClass = require('../models/groupClass.model');
const User = require('../models/user.model');
const { todayAtMidnight } = require('../utils/billingDates');
const { addStudentToRoster, removeStudentFromRoster } = require('./roster.service');
const { computeAvailability } = require('./groupClassSchedule.service');
const mailService = require('./mail.service');

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

function conflictError(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

// Shared populate chain for the admin subscriptions list + every mutation's
// return value — one place that defines "what a fully-populated
// Subscription looks like for the admin UI."
function populateSubscriptionQuery(query) {
  return query
    .populate('studentId', 'firstName lastName email')
    .populate('parentId', 'firstName lastName email')
    .populate({
      path: 'scheduleId',
      populate: [
        { path: 'classId', populate: [{ path: 'levelId' }, { path: 'locationId' }] },
        { path: 'coachId', select: 'firstName lastName email' },
      ],
    });
}

function getPopulatedSubscription(subscriptionId) {
  return populateSubscriptionQuery(Subscription.findById(subscriptionId));
}

// Admin/superadmin list — status=active|pending_cancel|cancelled, q =
// case-insensitive substring over student/parent name/email, paginated.
// `q` is filtered in Node AFTER populate, not via a Mongo query, on
// purpose — at this academy's real scale (hundreds of subscriptions, not
// tens of thousands) a real search index isn't worth the complexity, and
// filtering here can match against populated fields (parent email) in one
// simple pass.
async function listAll({ status, q, page, limit } = {}) {
  const filter = {};

  if (status === 'active') {
    filter.status = 'active';
    filter.cancelAtPeriodEnd = false;
  } else if (status === 'pending_cancel') {
    filter.status = 'active';
    filter.cancelAtPeriodEnd = true;
  } else if (status === 'cancelled') {
    filter.status = 'cancelled';
  }

  let subscriptions = await populateSubscriptionQuery(Subscription.find(filter)).sort({
    createdAt: -1,
  });

  if (q && q.trim()) {
    const needle = q.trim().toLowerCase();

    subscriptions = subscriptions.filter((subscription) => {
      const student = subscription.studentId;
      const parent = subscription.parentId;
      const haystack = [
        student && student.firstName,
        student && student.lastName,
        parent && parent.firstName,
        parent && parent.lastName,
        parent && parent.email,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(needle);
    });
  }

  const pageNum = Number.isFinite(Number(page)) && Number(page) > 0 ? Math.floor(Number(page)) : 1;
  const limitNum =
    Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 25;

  const total = subscriptions.length;
  const totalPages = Math.max(1, Math.ceil(total / limitNum));
  const currentPage = Math.min(Math.max(1, pageNum), totalPages);
  const start = (currentPage - 1) * limitNum;

  return {
    subscriptions: subscriptions.slice(start, start + limitNum),
    total,
    totalPages,
    currentPage,
  };
}

// Two-stage cancellation (docs/decisions/001-in-house-subscription-billing.md):
// this ONLY flips cancelAtPeriodEnd. It never touches `status` and never
// mutates roster/session data — the family keeps full access through the
// period they already paid for. The renewal job (renewal.service.js) is what
// actually finalizes the cancellation (status -> 'cancelled', roster
// removal) once nextBillingDate is reached and it would otherwise charge.
async function cancel(subscriptionId, requestingUser) {
  const subscription = await Subscription.findById(subscriptionId);

  if (!subscription) {
    throw notFoundError('Subscription not found');
  }

  const isAdmin = requestingUser.role === 'admin' || requestingUser.role === 'superadmin';
  const isOwningParent =
    requestingUser.role === 'parent' &&
    String(subscription.parentId) === String(requestingUser._id);

  if (!isAdmin && !isOwningParent) {
    throw forbiddenError('This subscription does not belong to you');
  }

  if (subscription.status !== 'active') {
    throw conflictError('This subscription is already cancelled');
  }

  if (subscription.cancelAtPeriodEnd) {
    // Cancelling an already-cancelling subscription is an idempotent
    // success, not an error.
    return subscription;
  }

  subscription.cancelAtPeriodEnd = true;
  await subscription.save();

  // Fire-and-forget confirmation email — never throws, never affects this
  // response (see mail.service.js's send-function contract). Populate is
  // kept inside this try/catch so a lookup failure can never undo the
  // cancellation write above.
  try {
    const student = await User.findById(subscription.studentId);
    const parent = await User.findById(subscription.parentId);
    const schedule = await GroupClassSchedule.findById(subscription.scheduleId);
    const groupClass = schedule ? await GroupClass.findById(schedule.classId) : null;
    const coach = schedule ? await User.findById(schedule.coachId) : null;

    await mailService.sendCancellationConfirmationEmail({
      parent,
      student,
      groupClass,
      schedule,
      coach,
      endDate: subscription.currentPeriodEnd,
    });
  } catch (error) {
    // eslint-disable-next-line no-console -- operational logging for a
    // fire-and-forget email side effect, not debug output.
    console.error('subscription.service: failed to send cancellation email:', error.message);
  }

  return subscription;
}

// Reverses a pending cancellation. parent-own | admin | superadmin. Requires
// the subscription to actually be pending-cancel (active + cancelAtPeriodEnd)
// — mirrors cancel()'s permission shape exactly.
async function reactivate(subscriptionId, requestingUser) {
  const subscription = await Subscription.findById(subscriptionId);

  if (!subscription) {
    throw notFoundError('Subscription not found');
  }

  const isAdmin = requestingUser.role === 'admin' || requestingUser.role === 'superadmin';
  const isOwningParent =
    requestingUser.role === 'parent' &&
    String(subscription.parentId) === String(requestingUser._id);

  if (!isAdmin && !isOwningParent) {
    throw forbiddenError('This subscription does not belong to you');
  }

  if (subscription.status !== 'active' || subscription.cancelAtPeriodEnd !== true) {
    throw conflictError('This subscription is not pending cancellation');
  }

  subscription.cancelAtPeriodEnd = false;
  await subscription.save();

  // Fire-and-forget confirmation email — see cancel()'s identical rationale.
  try {
    const student = await User.findById(subscription.studentId);
    const parent = await User.findById(subscription.parentId);
    const schedule = await GroupClassSchedule.findById(subscription.scheduleId);
    const groupClass = schedule ? await GroupClass.findById(schedule.classId) : null;

    await mailService.sendReactivationConfirmationEmail({
      parent,
      student,
      groupClass,
      schedule,
      nextBillingDate: subscription.nextBillingDate,
    });
  } catch (error) {
    // eslint-disable-next-line no-console -- operational logging for a
    // fire-and-forget email side effect, not debug output.
    console.error('subscription.service: failed to send reactivation email:', error.message);
  }

  return subscription;
}

// Admin/superadmin only — moves a student to a different schedule WITHIN
// THE SAME LEVEL (D6: always price-neutral, no delta charge, no proration,
// sibling discount untouched — billing fields are never written here).
// Frisco materializes rosters (unlike CKQ), so this must actually move the
// student's roster/session/registration pointers, not just relabel the
// subscription.
async function changeSchedule(subscriptionId, newScheduleId) {
  const subscription = await Subscription.findById(subscriptionId);

  if (!subscription) {
    throw notFoundError('Subscription not found');
  }

  if (subscription.status !== 'active') {
    throw conflictError('Only an active subscription can change schedules');
  }

  // Premium subscribers attend any scheduled session of their level already
  // — there is no "different schedule" to move to. Checked before every
  // other validation below (docs/plans/premium-registration-and-attendance
  // -plan.md §3.8) since none of it is reachable/meaningful for a premium
  // subscription regardless of what newScheduleId names.
  if (subscription.isPremium) {
    throw conflictError('Premium subscriptions attend any scheduled session — there is no schedule to change.');
  }

  const newSchedule = await GroupClassSchedule.findById(newScheduleId);

  if (!newSchedule) {
    throw notFoundError('New group class schedule not found');
  }

  if (String(subscription.scheduleId) === String(newScheduleId)) {
    throw conflictError('This student is already on this schedule');
  }

  const oldSchedule = await GroupClassSchedule.findById(subscription.scheduleId);

  if (!oldSchedule) {
    throw notFoundError('Current schedule not found');
  }

  const oldGroupClass = await GroupClass.findById(oldSchedule.classId);
  const newGroupClass = await GroupClass.findById(newSchedule.classId);

  if (!oldGroupClass || !newGroupClass) {
    throw notFoundError('Group class not found');
  }

  if (String(oldGroupClass.levelId) !== String(newGroupClass.levelId)) {
    throw conflictError('Schedule changes must stay within the same level');
  }

  if (computeAvailability(newSchedule, newGroupClass) === 'full') {
    throw conflictError('The new schedule is at capacity');
  }

  const duplicate = await Subscription.findOne({
    studentId: subscription.studentId,
    scheduleId: newScheduleId,
    status: 'active',
    _id: { $ne: subscription._id },
  });

  if (duplicate) {
    throw conflictError('This student is already registered for the new schedule');
  }

  const today = todayAtMidnight();

  // Writes, in this order (docs/plans/ckq-parity-plan.md §4.1):
  // a. the Subscription's own scheduleId pointer
  subscription.scheduleId = newScheduleId;
  await subscription.save();

  // b. the student's active Registration for the old schedule
  await Registration.updateOne(
    { studentId: subscription.studentId, scheduleId: oldSchedule._id, status: 'active' },
    { $set: { scheduleId: newScheduleId } }
  );

  // c. pull from the old schedule's roster + its future sessions
  await removeStudentFromRoster(oldSchedule, subscription.studentId, today);

  // d. add to the new schedule's roster + its future sessions
  await addStudentToRoster(newSchedule, subscription.studentId, today);

  // Fire-and-forget confirmation email — never affects the writes above.
  try {
    const student = await User.findById(subscription.studentId);
    const parent = await User.findById(subscription.parentId);
    const newCoach = await User.findById(newSchedule.coachId);

    await mailService.sendScheduleChangeConfirmationEmail({
      parent,
      student,
      old: { groupClass: oldGroupClass, schedule: oldSchedule },
      next: { groupClass: newGroupClass, schedule: newSchedule, coach: newCoach },
    });
  } catch (error) {
    // eslint-disable-next-line no-console -- operational logging for a
    // fire-and-forget email side effect, not debug output.
    console.error('subscription.service: failed to send schedule change email:', error.message);
  }

  return getPopulatedSubscription(subscription._id);
}

module.exports = { listAll, cancel, reactivate, changeSchedule, getPopulatedSubscription };
