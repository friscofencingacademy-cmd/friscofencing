const TrialClass = require('../models/trialClass.model');
const User = require('../models/user.model');
const GroupClassSession = require('../models/groupClassSession.model');
const GroupClassSchedule = require('../models/groupClassSchedule.model');
const GroupClass = require('../models/groupClass.model');
const Level = require('../models/level.model');
const Location = require('../models/location.model');
const mailService = require('./mail.service');
const visitService = require('./visit.service');
const holidayService = require('./holiday.service');
const { badRequestError, forbiddenError, notFoundError, conflictError } = require('../utils/errors');
const { hasAdminRole } = require('../utils/roles');

const TRIAL_CHANGED_ELSEWHERE = 'This trial was just changed somewhere else — reload the page and try again';

function attendanceTakenError() {
  return conflictError('Attendance has already been taken for this trial class — it can no longer be changed');
}

function populateTrialClass(trialClassId) {
  return TrialClass.findById(trialClassId)
    .populate('studentId', 'firstName lastName')
    .populate('sessionId', 'date');
}

// The one answer to "may this trial still be cancelled or moved?"
// (docs/plans/trial-cancel-reschedule-plan.md D2). Returns the error to throw,
// or null when the change is allowed. Pure — the caller passes the trial's
// session, its active Visit's status (or null) and a real `now`, so the
// portal's enrollment.trial.canChange (student.service.js) and the
// cancel/reschedule endpoints below can never disagree.
//  - a deleted session can't be dated, so the trial reads as completed;
//  - "started" is the session's START INSTANT vs now
//    (docs/plans/session-start-time-cutoff-plan.md), never a day compare;
//  - attendance opens at the start of the session's calendar day and the
//    kiosk signs students in before class, so a trial can be marked attended
//    (or missed) before it starts — once marked, it happened.
function trialChangeBlocker({ session, visitStatus, now }) {
  if (!session) {
    return badRequestError('This trial class can no longer be changed');
  }

  if (session.startsAt <= now) {
    return badRequestError('This trial class has already started — it can no longer be changed');
  }

  if (visitStatus && visitStatus !== 'scheduled') {
    return attendanceTakenError();
  }

  return null;
}

// Loads a session a trial may be booked into, or throws: unknown (404),
// already started (400), on an academy holiday (400). Shared by booking and
// rescheduling so both enforce the same rules. The pickers never offer a
// started or holiday session (listUpcomingByClass filters both), but a direct
// API call or a stale open tab could still submit one.
async function loadBookableSession(sessionId) {
  const session = await GroupClassSession.findById(sessionId);

  if (!session) {
    throw notFoundError('Group class session not found');
  }

  // Including a session from a past day (docs/plans/session-start-time-
  // cutoff-plan.md).
  if (session.startsAt <= new Date()) {
    throw badRequestError('This session has already started — choose a later date');
  }

  // Defense in depth (docs/plans/holiday-blocking-plan.md D7).
  const holidays = await holidayService.getHolidaysInRange(session.date, session.date);
  if (holidayService.findHolidayForDate(session.date, holidays)) {
    throw badRequestError('This session falls on an academy holiday');
  }

  return session;
}

// Fire-and-forget trial email — never throws, never affects the response
// (see mail.service.js's send-function contract). The schedule/class/level/
// location/coach lookups the email needs are deliberately inside this
// try/catch, alongside the send itself, so a populate failure can never fail
// an otherwise-successful booking or reschedule. Always addressed to the
// FAMILY's parent — on an admin-initiated change the requester is the admin,
// who is not the one bringing the child to class.
async function sendTrialEmail(sendFn, { parent, student, session, extra = {} }) {
  try {
    const schedule = await GroupClassSchedule.findById(session.scheduleId);
    const groupClass = schedule ? await GroupClass.findById(schedule.classId) : null;
    const level = groupClass ? await Level.findById(groupClass.levelId) : null;
    const location = groupClass ? await Location.findById(groupClass.locationId) : null;
    const coach = schedule ? await User.findById(schedule.coachId) : null;

    await sendFn({ parent, student, session, schedule, groupClass, level, location, coach, ...extra });
  } catch (error) {
    // eslint-disable-next-line no-console -- operational logging for a
    // fire-and-forget email side effect, not debug output.
    console.error('trialClass.service: failed to assemble trial email:', error.message);
  }
}

// Books a one-time trial for `studentId` into `sessionId`'s roster.
// Order matters here (mirrors the spec): student existence -> permission ->
// duplicate-trial pre-check -> session checks -> roster mutation -> create.
async function create({ studentId, sessionId }, requestingUser) {
  const student = await User.findById(studentId);

  if (!student || student.role !== 'student') {
    throw notFoundError('Student not found');
  }

  const isAdmin = hasAdminRole(requestingUser);

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
    throw conflictError('This student has already used their trial class');
  }

  const session = await loadBookableSession(sessionId);

  await visitService.createScheduledVisit(studentId, sessionId, session.scheduleId, 'trial');

  const trialClass = await TrialClass.create({ studentId, sessionId });

  await sendTrialEmail(mailService.sendTrialConfirmationEmail, { parent: bookingParent, student, session });

  return populateTrialClass(trialClass._id);
}

// Loads a trial for a cancel/reschedule and runs every check both share:
// the trial exists (404), the requester is the child's own parent or an
// admin (403), and trialChangeBlocker allows the change (400/409).
async function loadChangeableTrial(trialClassId, requestingUser) {
  const trial = await TrialClass.findById(trialClassId);

  if (!trial) {
    throw notFoundError('Trial class not found');
  }

  const student = await User.findById(trial.studentId);
  const isAdmin = hasAdminRole(requestingUser);

  if (!isAdmin && (!student || String(student.parentId) !== String(requestingUser._id))) {
    throw forbiddenError('This trial class does not belong to you');
  }

  const session = await GroupClassSession.findById(trial.sessionId);
  const visit = session ? await visitService.findActiveVisit(trial.studentId, session._id) : null;
  const blocker = trialChangeBlocker({ session, visitStatus: visit ? visit.status : null, now: new Date() });

  if (blocker) {
    throw blocker;
  }

  return { trial, student, session };
}

// The roster follows the TrialClass row, never the other way round
// (docs/plans/trial-cancel-reschedule-plan.md D3). After any change, every
// still-'scheduled' trial Visit of the child that is not on the trial's
// CURRENT session (read fresh here) is cancelled. A marked Visit (attended,
// missed) is never touched. Because each change reconciles after its own
// writes, two changes racing each other converge on the row's final state.
async function reconcileTrialVisits(studentId) {
  const current = await TrialClass.findOne({ studentId });
  await visitService.cancelStaleTrialVisits(studentId, current ? current.sessionId : null);
}

// Attendance can be taken between the checks and the claim (a coach or the
// kiosk marking the class in that instant). Re-read after the claim; when a
// marked Visit is there, the caller undoes its claim and refuses.
async function attendanceTakenSince(trial) {
  const visit = await visitService.findActiveVisit(trial.studentId, trial.sessionId);
  return Boolean(visit && visit.status !== 'scheduled');
}

// Cancels an upcoming trial: the TrialClass row is deleted, so the child is
// back to "Book a trial" (the one-trial-ever unique index only counts a
// trial that still exists), and its roster Visit is cancelled. No email
// (docs/plans/trial-cancel-reschedule-plan.md D5).
async function cancel(trialClassId, requestingUser) {
  const { trial } = await loadChangeableTrial(trialClassId, requestingUser);

  // The claim: conditional on the session the checks ran against, so a
  // reschedule or cancel that landed first makes this a clean 409.
  const claimed = await TrialClass.findOneAndDelete({ _id: trial._id, sessionId: trial.sessionId });

  if (!claimed) {
    throw conflictError(TRIAL_CHANGED_ELSEWHERE);
  }

  if (await attendanceTakenSince(trial)) {
    // Put back the exact row that was deleted (same _id and timestamps).
    await TrialClass.collection.insertOne(claimed.toObject());
    throw attendanceTakenError();
  }

  await reconcileTrialVisits(trial.studentId);
}

// Moves an upcoming trial to another session. Everything is checked before
// anything is written — the trial may still change (loadChangeableTrial) and
// the new session is bookable (loadBookableSession) — so a refused
// reschedule leaves the original trial exactly as it was. Then: claim (the
// TrialClass row moves, conditional on its old session), new roster Visit,
// old Visit reconciled off the roster, and a "rescheduled" email.
async function reschedule(trialClassId, { sessionId } = {}, requestingUser) {
  if (!sessionId) {
    throw badRequestError('sessionId is required');
  }

  const { trial, student, session: oldSession } = await loadChangeableTrial(trialClassId, requestingUser);

  if (String(oldSession._id) === String(sessionId)) {
    throw badRequestError('The trial is already booked for this class — choose a different date');
  }

  const newSession = await loadBookableSession(sessionId);

  const claimed = await TrialClass.findOneAndUpdate(
    { _id: trial._id, sessionId: oldSession._id },
    { $set: { sessionId: newSession._id } },
    { new: true }
  );

  if (!claimed) {
    throw conflictError(TRIAL_CHANGED_ELSEWHERE);
  }

  // Puts the row back on the old session. The old roster Visit has not been
  // touched yet at either call site, so this alone restores the original.
  const undoClaim = () =>
    TrialClass.updateOne({ _id: trial._id, sessionId: newSession._id }, { $set: { sessionId: oldSession._id } });

  if (await attendanceTakenSince(trial)) {
    await undoClaim();
    throw attendanceTakenError();
  }

  try {
    await visitService.createScheduledVisit(trial.studentId, newSession._id, newSession.scheduleId, 'trial');
  } catch (error) {
    await undoClaim();
    throw error;
  }

  await reconcileTrialVisits(trial.studentId);

  const familyParent = student ? await User.findById(student.parentId) : null;

  if (familyParent) {
    await sendTrialEmail(mailService.sendTrialRescheduledEmail, {
      parent: familyParent,
      student,
      session: newSession,
      extra: { previousSession: oldSession },
    });
  }

  return populateTrialClass(trial._id);
}

async function listMine(parentId) {
  const children = await User.find({ role: 'student', parentId }, '_id');
  const childIds = children.map((child) => child._id);

  return TrialClass.find({ studentId: { $in: childIds } })
    .populate('studentId', 'firstName lastName')
    .populate('sessionId', 'date');
}

module.exports = { create, cancel, reschedule, listMine, trialChangeBlocker };
