const User = require('../models/user.model');
const Registration = require('../models/registration.model');
const Subscription = require('../models/subscription.model');
const TrialClass = require('../models/trialClass.model');
const GroupClassSchedule = require('../models/groupClassSchedule.model');
const { hashPassword } = require('../utils/password');

// Roles that get a passwordHash and can log in. Students never get one in
// this MVP — mirrors the comment on user.model.js's passwordHash field.
const LOGIN_CAPABLE_ROLES = ['parent', 'coach', 'admin', 'superadmin'];

function badRequestError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

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

function normalizeEmail(email) {
  return String(email || '')
    .toLowerCase()
    .trim();
}

// Security note: this is the ONLY listing path for users, so the
// superadmin-hiding rule here is what protects `/admin/users`'s "All" tab
// (and any other caller of GET /users) from ever revealing a superadmin row
// to a non-superadmin. See design decision "Superadmin protection" in
// docs/plans/admin-user-management-plan.md — deliberately stricter than CKQ.
async function list(filter, requesterRole) {
  const mergedFilter = { ...filter };

  if (requesterRole !== 'superadmin') {
    if (mergedFilter.role === 'superadmin') {
      throw forbiddenError('Forbidden');
    }

    if (!mergedFilter.role) {
      mergedFilter.role = { $ne: 'superadmin' };
    }
  }

  return User.find(mergedFilter);
}

async function create(data, requesterRole) {
  const { role, firstName, lastName } = data;

  if (!User.ROLES.includes(role)) {
    throw badRequestError(`role must be one of: ${User.ROLES.join(', ')}`);
  }

  if (!firstName || !String(firstName).trim()) {
    throw badRequestError('firstName is required');
  }

  if (!lastName || !String(lastName).trim()) {
    throw badRequestError('lastName is required');
  }

  // Deliberately stricter than CKQ: only a superadmin may create another
  // superadmin account. An admin creating any other role is fine.
  if (role === 'superadmin' && requesterRole !== 'superadmin') {
    throw forbiddenError('Admins cannot create superadmin accounts.');
  }

  if (role === 'student') {
    if (!data.parentId) {
      throw badRequestError('parentId is required');
    }

    const parent = await User.findById(data.parentId);

    if (!parent) {
      throw notFoundError('Parent not found');
    }

    if (parent.role !== 'parent') {
      throw badRequestError('parentId must reference a parent account');
    }

    let email;

    // Students never get a password, even if one is submitted — the create
    // form has no password field for a student, but this guards a direct
    // API call from tampering with that rule.
    if (data.email) {
      email = normalizeEmail(data.email);

      const existing = await User.findOne({ email });

      if (existing) {
        throw conflictError('An account with this email already exists');
      }
    }

    const user = await User.create({
      role: 'student',
      firstName,
      lastName,
      parentId: data.parentId,
      email,
      skillLevel: data.skillLevel,
    });

    return user.toSafeJSON();
  }

  // Login-capable role: parent, coach, admin, or superadmin.
  if (!data.email || !data.password) {
    throw badRequestError('email and password are required');
  }

  const email = normalizeEmail(data.email);

  const existing = await User.findOne({ email });

  if (existing) {
    throw conflictError('An account with this email already exists');
  }

  if (data.password.length < 8) {
    throw badRequestError('Password must be at least 8 characters');
  }

  const passwordHash = await hashPassword(data.password);

  const user = await User.create({
    role,
    firstName,
    lastName,
    email,
    passwordHash,
  });

  return user.toSafeJSON();
}

// Edit-profile only — never touches role or password. Silently drops any
// other field in `data` (role, password, parentId, ...) even if a caller
// sends it directly to the API, rather than erroring — role immutability
// and the create/updatePassword split are enforced by simply never reading
// those fields here.
async function update(id, data, requesterRole) {
  const target = await User.findById(id);

  if (!target) {
    throw notFoundError('User not found');
  }

  if (target.role === 'superadmin' && requesterRole !== 'superadmin') {
    throw forbiddenError('Forbidden');
  }

  const payload = {
    firstName: data.firstName,
    lastName: data.lastName,
  };

  if (LOGIN_CAPABLE_ROLES.includes(target.role)) {
    const email = normalizeEmail(data.email);

    if (email !== target.email) {
      const existing = await User.findOne({ email, _id: { $ne: id } });

      if (existing) {
        throw conflictError('An account with this email already exists');
      }
    }

    payload.email = email;
  }

  const updated = await User.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true,
  });

  return updated.toSafeJSON();
}

async function updatePassword(id, newPassword, requesterRole) {
  const target = await User.findById(id);

  if (!target) {
    throw notFoundError('User not found');
  }

  if (target.role === 'superadmin' && requesterRole !== 'superadmin') {
    throw forbiddenError('Forbidden');
  }

  if (!LOGIN_CAPABLE_ROLES.includes(target.role)) {
    throw badRequestError('This account cannot have a password.');
  }

  if (!newPassword || newPassword.length < 8) {
    throw badRequestError('Password must be at least 8 characters');
  }

  const passwordHash = await hashPassword(newPassword);

  await User.findByIdAndUpdate(id, { passwordHash });

  return { success: true };
}

async function remove(id, requesterRole, requesterId) {
  // New safety rule, not present in CKQ: nobody can delete their own
  // account through this page.
  if (String(id) === String(requesterId)) {
    throw badRequestError('You cannot delete your own account.');
  }

  const target = await User.findById(id);

  if (!target) {
    throw notFoundError('User not found');
  }

  if (target.role === 'superadmin' && requesterRole !== 'superadmin') {
    throw forbiddenError('Forbidden');
  }

  if (target.role === 'parent') {
    const childCount = await User.countDocuments({ parentId: id });

    if (childCount > 0) {
      throw conflictError(`Cannot delete: ${childCount} child account(s) reference this parent.`);
    }
  }

  if (target.role === 'student') {
    const registrationCount = await Registration.countDocuments({ studentId: id });

    if (registrationCount > 0) {
      throw conflictError(`Cannot delete: ${registrationCount} registration(s) reference this student.`);
    }

    const subscriptionCount = await Subscription.countDocuments({ studentId: id });

    if (subscriptionCount > 0) {
      throw conflictError(`Cannot delete: ${subscriptionCount} subscription(s) reference this student.`);
    }

    const trialCount = await TrialClass.countDocuments({ studentId: id });

    if (trialCount > 0) {
      throw conflictError(`Cannot delete: ${trialCount} trial class(es) reference this student.`);
    }
  }

  if (target.role === 'coach') {
    const scheduleCount = await GroupClassSchedule.countDocuments({ coachId: id });

    if (scheduleCount > 0) {
      throw conflictError(`Cannot delete: ${scheduleCount} schedule(s) reference this coach.`);
    }
  }

  await User.deleteOne({ _id: id });
}

module.exports = { list, create, update, updatePassword, remove, LOGIN_CAPABLE_ROLES };
