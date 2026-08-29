const TrialClass = require('../models/trialClass.model');
const User = require('../models/user.model');
const GroupClassSession = require('../models/groupClassSession.model');
const GroupClassSchedule = require('../models/groupClassSchedule.model');
const GroupClass = require('../models/groupClass.model');
const Level = require('../models/level.model');
const Location = require('../models/location.model');
const mailService = require('./mail.service');
const visitService = require('./visit.service');

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

function populateTrialClass(trialClassId) {
  return TrialClass.findById(trialClassId)
    .populate('studentId', 'firstName lastName')
    .populate('sessionId', 'date');
}

// Books a one-time trial for `studentId` into `sessionId`'s roster.
// Order matters here (mirrors the spec): student existence -> permission ->
// duplicate-trial pre-check -> session existence -> roster mutation -> create.
async function create({ studentId, sessionId }, requestingUser) {
  const student = await User.findById(studentId);

  if (!student || student.role !== 'student') {
    throw notFoundError('Student not found');
  }

  const isAdmin = requestingUser.role === 'admin' || requestingUser.role === 'superadmin';

  if (!isAdmin && String(student.parentId) !== String(requestingUser._id)) {
    throw forbiddenError('This student does not belong to you');
  }

  // The actual backstop making phone/date-of-birth "mandatory for trial
  // class registration" true (docs/plans/trial-registration-required-
  // fields-plan.md §1.4) — catches any account/child that existed before
  // these fields did, since phone is only hard-required going forward at
  // signup (auth.service.js) and dateOfBirth is only collected on Add
  // Child, never hard-required at the shared student-creation service.
  //
  // The phone check is against the FAMILY's own parent, not literally
  // `requestingUser` — for the admin-initiated branch above, requestingUser
  // is the admin, who has no reason to ever have a phone on file here; the
  // admin dialog doesn't even collect one. Checking requestingUser.phone
  // unconditionally would make every admin-initiated booking fail this gate
  // regardless of the family's real data. Not exempted otherwise: an admin
  // booking on a family's behalf should still be told the same missing-
  // field story, since the gap is in the family's own data either way.
  const bookingParent = isAdmin ? await User.findById(student.parentId) : requestingUser;

  if (!bookingParent || !bookingParent.phone) {
    throw badRequestError("Add a phone number to the family's account before booking a trial class.");
  }

  if (!student.dateOfBirth) {
    throw badRequestError(`Add ${student.firstName}'s date of birth before booking a trial class.`);
  }

  // Pre-check for a clean error message before hitting the unique index —
  // same two-layer duplicate-prevention pattern as price.service.js's
  // assertNoExistingPrice.
  const existingTrial = await TrialClass.findOne({ studentId });

  if (existingTrial) {
    const error = new Error('This student has already used their trial class');
    error.status = 409;
    throw error;
  }

  const session = await GroupClassSession.findById(sessionId);

  if (!session) {
    throw notFoundError('Group class session not found');
  }

  await visitService.createScheduledVisit(studentId, sessionId, session.scheduleId, 'trial');

  const trialClass = await TrialClass.create({ studentId, sessionId });

  // Fire-and-forget confirmation email — never throws, never affects this
  // response (see mail.service.js's send-function contract). The extra
  // schedule/class/level/location/coach lookups for the richer email are
  // deliberately kept inside this try/catch, alongside the send itself, so
  // a populate failure here can never fail an otherwise-successful booking.
  try {
    const schedule = await GroupClassSchedule.findById(session.scheduleId);
    const groupClass = schedule ? await GroupClass.findById(schedule.classId) : null;
    const level = groupClass ? await Level.findById(groupClass.levelId) : null;
    const location = groupClass ? await Location.findById(groupClass.locationId) : null;
    const coach = schedule ? await User.findById(schedule.coachId) : null;

    await mailService.sendTrialConfirmationEmail({
      parent: requestingUser,
      student,
      session,
      schedule,
      groupClass,
      level,
      location,
      coach,
    });
  } catch (error) {
    // eslint-disable-next-line no-console -- operational logging for a
    // fire-and-forget email side effect, not debug output.
    console.error('trialClass.service: failed to assemble confirmation email:', error.message);
  }

  return populateTrialClass(trialClass._id);
}

async function listMine(parentId) {
  const children = await User.find({ role: 'student', parentId }, '_id');
  const childIds = children.map((child) => child._id);

  return TrialClass.find({ studentId: { $in: childIds } })
    .populate('studentId', 'firstName lastName')
    .populate('sessionId', 'date');
}

module.exports = { create, listMine };
