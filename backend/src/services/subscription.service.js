const Subscription = require('../models/subscription.model');

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

  return subscription;
}

module.exports = { cancel };
