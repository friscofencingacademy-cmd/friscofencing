const Evaluation = require('../models/evaluation.model');
const User = require('../models/user.model');
const GroupClassSession = require('../models/groupClassSession.model');
const GroupClassSchedule = require('../models/groupClassSchedule.model');
const Level = require('../models/level.model');
const visitService = require('./visit.service');
const mailService = require('./mail.service');

// Mirrors chesskqwebsite/backend/backend-2.0/src/services/evaluation.service.js's
// createEvaluation logic exactly (verified line-by-line — docs/plans/
// premium-registration-and-attendance-plan.md §3.10), Frisco-styled (no
// Joi, custom Error + .status, no isActive/isDeleted soft-delete).

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

function populateEvaluationQuery(query) {
  return query
    .populate('studentId', 'firstName lastName')
    .populate('coachId', 'firstName lastName')
    .populate('groupClassSessionId', 'date scheduleId')
    .populate('assignedLevelId', 'name');
}

// `coachId` is never a client-supplied field — always `requestingUser._id`
// (verified against CKQ's controller: `{ ...req.body, coach: req.user.id }`
// silently overrides any body value, never merely defaults it). Even an
// admin evaluating on a coach's behalf is recorded as evaluated by that
// admin, not by the coach.
async function create({ studentId, groupClassSessionId, assignedLevelId, notes }, requestingUser) {
  const student = await User.findOne({ _id: studentId, role: 'student' });

  if (!student) {
    throw notFoundError('Student not found');
  }

  const session = await GroupClassSession.findById(groupClassSessionId);

  if (!session) {
    throw notFoundError('Group class session not found');
  }

  const level = await Level.findById(assignedLevelId);

  if (!level) {
    throw notFoundError('Level not found');
  }

  // Was the student actually present? Only an `attended` Visit counts.
  const attendedVisit = await visitService.findActiveVisit(studentId, groupClassSessionId);

  if (!attendedVisit || attendedVisit.status !== 'attended') {
    throw badRequestError('Cannot evaluate a student who was not present in the session');
  }

  // Coach-only restriction: a coach may evaluate only a trial attendee of a
  // session belonging to a schedule they themselves coach — never any
  // student on any session. Admin/superadmin are unrestricted.
  if (requestingUser.role === 'coach') {
    const schedule = await GroupClassSchedule.findById(session.scheduleId);
    const isOwnSession = schedule && String(schedule.coachId) === String(requestingUser._id);

    if (!isOwnSession) {
      throw forbiddenError('You can only evaluate students in classes you teach');
    }

    if (attendedVisit.classType !== 'trial') {
      throw forbiddenError('Coaches can only evaluate trial students');
    }
  }

  const existing = await Evaluation.findOne({ studentId, groupClassSessionId });

  if (existing) {
    throw conflictError('An evaluation already exists for this student and session');
  }

  const evaluation = await Evaluation.create({
    studentId,
    coachId: requestingUser._id,
    groupClassSessionId,
    assignedLevelId,
    notes,
  });

  const populated = await populateEvaluationQuery(Evaluation.findById(evaluation._id));

  // Fire-and-forget confirmation email — never throws, never affects this
  // response (see mail.service.js's send-function contract).
  try {
    const parent = await User.findById(student.parentId);
    const coach = await User.findById(requestingUser._id);

    await mailService.sendTrialEvaluationEmail({
      parent,
      student,
      coach,
      level,
      notes,
    });
  } catch (error) {
    // eslint-disable-next-line no-console -- operational logging for a
    // fire-and-forget email side effect, not debug output.
    console.error('evaluation.service: failed to assemble confirmation email:', error.message);
  }

  return populated;
}

async function getById(id) {
  const evaluation = await populateEvaluationQuery(Evaluation.findById(id));

  if (!evaluation) {
    throw notFoundError('Evaluation not found');
  }

  return evaluation;
}

async function getByStudent(studentId) {
  const student = await User.findOne({ _id: studentId, role: 'student' });

  if (!student) {
    throw notFoundError('Student not found');
  }

  return populateEvaluationQuery(Evaluation.find({ studentId })).sort({ createdAt: -1 });
}

// A coach may only edit their own evaluations; admin/superadmin unrestricted.
async function update(id, { assignedLevelId, notes }, requestingUser) {
  const evaluation = await Evaluation.findById(id);

  if (!evaluation) {
    throw notFoundError('Evaluation not found');
  }

  if (requestingUser.role === 'coach' && String(evaluation.coachId) !== String(requestingUser._id)) {
    throw forbiddenError('You can only edit your own evaluations');
  }

  if (assignedLevelId !== undefined) {
    const level = await Level.findById(assignedLevelId);

    if (!level) {
      throw notFoundError('Level not found');
    }

    evaluation.assignedLevelId = assignedLevelId;
  }

  if (notes !== undefined) {
    evaluation.notes = notes;
  }

  await evaluation.save();

  return populateEvaluationQuery(Evaluation.findById(id));
}

module.exports = { create, getById, getByStudent, update };
