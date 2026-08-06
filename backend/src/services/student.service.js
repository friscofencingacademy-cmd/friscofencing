const User = require('../models/user.model');

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

  return User.create({
    role: 'student',
    firstName: data.firstName,
    lastName: data.lastName,
    skillLevel: data.skillLevel,
    parentId,
  });
}

async function listMine(parentId) {
  return User.find({ role: 'student', parentId });
}

module.exports = { create, listMine };
