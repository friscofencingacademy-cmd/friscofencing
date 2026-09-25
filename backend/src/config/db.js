const mongoose = require('mongoose');

// How long one connection attempt may take before it is given up and
// reported. Short on purpose: a request waiting on a dead attempt is a
// request the user is watching spin.
const SERVER_SELECTION_TIMEOUT_MS = 5000;

// The attempt IN FLIGHT, shared by every caller — cleared as soon as it
// settles either way, so a later call checks the live connection state
// rather than trusting an old result (a connection can drop after it
// succeeded).
let connecting = null;

// A connection string can carry a password — never let one reach a log.
function redact(message) {
  return String(message).replace(/mongodb(\+srv)?:\/\/\S+/g, 'mongodb://<redacted>');
}

/**
 * Connects to MongoDB using MONGO_URI, and is safe to call on every request.
 *
 * - Already connected: resolves at once.
 * - An attempt in flight: every caller shares it (one attempt, not one per
 *   request).
 * - An attempt FAILED: the failure is logged with its real cause, and the
 *   next call starts a fresh attempt.
 *
 * The last point is the fix for a staging outage (2026-09-25): this used to
 * connect once per process and swallow the error, so a serverless instance
 * whose first attempt failed stayed broken for its whole life — every query
 * "buffering timed out after 10000ms" — until the next deploy, with nothing
 * in the logs saying why.
 *
 * Never throws: callers (and /health) keep working without a database, and
 * Mongoose reports any query made while disconnected as usual.
 */
async function connectDB() {
  if (mongoose.connection.readyState === 1) {
    return;
  }

  if (!connecting) {
    connecting = mongoose
      .connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS })
      .then(
        () => {
          connecting = null;
        },
        (error) => {
          // Cleared so the next call tries again instead of reusing a failure.
          connecting = null;
          console.error(
            `MongoDB connection failed (${error.name}): ${redact(error.message)} — ` +
              'will retry on the next request. Locally, check MongoDB is running and MONGO_URI is set (see CLAUDE.md).'
          );
        }
      );
  }

  await connecting;
}

module.exports = { connectDB, SERVER_SELECTION_TIMEOUT_MS };
