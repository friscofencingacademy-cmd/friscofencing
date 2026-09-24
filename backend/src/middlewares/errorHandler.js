// Central Express error middleware — registered LAST in app.js
// (docs/plans/duplication-cleanup-plan.md B-D4). Controllers catch and call
// `next(error)`; this is the only place an error becomes an HTTP response.
//
// Rule (status-based, identical in every environment):
//  - Mongoose ValidationError -> 400, the per-field messages joined
//  - Mongoose CastError (a malformed ObjectId etc.) -> 400, a fixed message
//  - any error with a 4xx `.status` -> that status WITH ITS OWN message
//    (legacy-shaped errors carry no "expose" flag, so the status decides)
//  - anything else -> 500 with a fixed generic message; the real error is
//    logged server-side, never sent to the client
//
// Only `err.status` is read — never `err.statusCode`: Stripe SDK errors carry
// a `statusCode` (401/402/429) that must not be relayed to our clients.

const GENERIC_SERVER_ERROR_MESSAGE = 'Something went wrong';

function resolveStatus(err) {
  const status = err && err.status;
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

function logServerError(err, req, status) {
  // eslint-disable-next-line no-console -- operational logging of an
  // unexpected server error, not debug output. Never logs the request body
  // (it can hold passwords/card data) or the query string (can hold tokens).
  console.error(
    JSON.stringify({
      method: req.method,
      path: String(req.originalUrl || req.url || '').split('?')[0],
      status,
      message: err && err.message,
      stack: err && err.stack,
      userId: req.user && req.user._id ? String(req.user._id) : null,
    })
  );
}

// eslint-disable-next-line no-unused-vars -- Express identifies an error
// handler by its four-parameter signature, so `next` must stay declared.
function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  if (err && err.name === 'ValidationError' && err.errors) {
    return res.status(400).json({
      message: Object.values(err.errors)
        .map((fieldError) => fieldError.message)
        .join(', '),
    });
  }

  if (err && err.name === 'CastError') {
    return res.status(400).json({ message: `Invalid ${err.path}` });
  }

  const status = resolveStatus(err);

  if (status >= 500) {
    logServerError(err, req, status);
    return res.status(status).json({ message: GENERIC_SERVER_ERROR_MESSAGE });
  }

  return res.status(status).json({ message: err.message });
}

module.exports = errorHandler;
module.exports.GENERIC_SERVER_ERROR_MESSAGE = GENERIC_SERVER_ERROR_MESSAGE;
