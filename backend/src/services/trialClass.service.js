const TrialClass = require('../models/trialClass.model');
const User = require('../models/user.model');
const GroupClassSession = require('../models/groupClassSession.model');
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

  const alreadyOnRoster = session.students.some(
    (entry) => String(entry.studentId) === String(studentId)
  );

  if (!alreadyOnRoster) {
    session.students.push({ studentId, isPresent: false });
    await session.save();
  }

  const trialClass = await TrialClass.create({ studentId, sessionId });

  // Fire-and-forget confirmation email — never throws, never affects this
  // response (see mail.service.js's send-function contract).
  await mailService.sendTrialConfirmationEmail({ parent: requestingUser, student, session });

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
