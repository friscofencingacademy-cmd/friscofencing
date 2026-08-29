const User = require('../models/user.model');
const { withAge } = require('../utils/age');

function badRequestError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

// A parent adding their own child, or an admin/superadmin adding a child on
// behalf of a specific parent. Security-critical: when the requester is a
// parent, parentId is ALWAYS forced to the requester's own id, regardless of
// anything passed in `data.parentId` — a malicious parent must not be able
// to attach a child to a different parent's account by tampering with the
// request body.
async function create(data, requestingUser) {
  let parentId;

  if (requestingUser.role === 'parent') {
    parentId = requestingUser._id;
  } else {
    if (!data.parentId) {
      throw badRequestError('parentId is required');
    }

    const parent = await User.findById(data.parentId);

    if (!parent || parent.role !== 'parent') {
      throw badRequestError('parentId must refer to an existing user with role "parent"');
    }

    parentId = data.parentId;
  }

  // dateOfBirth is accepted and stored when present, but NOT hard-required
  // here — this service is shared with admin's own student-creation dialog,
  // which may not always have a birthdate in hand (docs/plans/trial-
  // registration-required-fields-plan.md §1.3). The real requirement lives
  // at trial-booking time instead (trialClass.service.js).
  const student = await User.create({
    role: 'student',
    firstName: data.firstName,
    lastName: data.lastName,
    skillLevel: data.skillLevel,
    dateOfBirth: data.dateOfBirth,
    parentId,
  });

  return withAge(student);
}

async function listMine(parentId) {
  const students = await User.find({ role: 'student', parentId });
  return students.map(withAge);
}

module.exports = { create, listMine };
