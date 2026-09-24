// The one place an HTTP-status-bearing error is constructed
// (docs/plans/duplication-cleanup-plan.md B-D1). Plain `Error` with a numeric
// `.status` — the property every controller and the error middleware read —
// deliberately not a class hierarchy and not `.statusCode` (Stripe SDK errors
// carry a `statusCode` that must never be relayed to our clients).
//
// Nothing outside this file sets `error.status` by hand; a service that needs
// a status without a named factory below (e.g. 402 for a declined card) calls
// httpError directly.

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function badRequestError(message) {
  return httpError(400, message);
}

function unauthorizedError(message) {
  return httpError(401, message);
}

function forbiddenError(message) {
  return httpError(403, message);
}

function notFoundError(message) {
  return httpError(404, message);
}

function conflictError(message) {
  return httpError(409, message);
}

module.exports = {
  httpError,
  badRequestError,
  unauthorizedError,
  forbiddenError,
  notFoundError,
  conflictError,
};
