const Service = require('../models/service.model');

// Internal-only helpers — this file has no route/controller of its own
// (services are seeded config, not user-editable data yet — see the plan's
// D7 "no admin Service CRUD" deferral), so these error shapes are for
// whatever caller (e.g. registration.service.js) surfaces them up the stack.
function notFoundError(message) {
  const error = new Error(message);
  error.status = 500;
  return error;
}

function conflictError(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

// No caching, deliberately — same "re-verified every time" principle
// setting.service.js's getSettings() already documents for this codebase. A
// Service read is cheap (one findOne on a tiny, near-static collection) and
// only ever happens at charge/registration time, not a hot path.
//
// Fails CLOSED, not open: a missing Service row is a deployment/seed defect
// (someone forgot `npm run seed:services`), never something a charge should
// silently skip past — hence a 500-shaped error, not a null return every
// caller would have to remember to null-check.
async function getServiceByCode(code, { requireActive = false } = {}) {
  const service = await Service.findOne({ code });

  if (!service) {
    throw notFoundError(`Service "${code}" is not seeded — run npm run seed:services.`);
  }

  if (requireActive && !service.isActive) {
    throw conflictError(`Service "${code}" is not currently active.`);
  }

  return service;
}

module.exports = { getServiceByCode };
