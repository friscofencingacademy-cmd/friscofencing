const Service = require('../models/service.model');
const { httpError, conflictError } = require('../utils/errors');

// Internal-only helpers — this file has no route/controller of its own
// (services are seeded config, not user-editable data yet — see the plan's
// D7 "no admin Service CRUD" deferral), so these error shapes are for
// whatever caller (e.g. registration.service.js) surfaces them up the stack.
//
// NOT the shared notFoundError (404): a missing Service row is a deployment
// defect (someone forgot `npm run seed:services`), never a "resource not
// found" the client could act on — it must stay a 500, so it has its own
// name (docs/plans/duplication-cleanup-plan.md B-D2).
function serviceNotConfiguredError(message) {
  return httpError(500, message);
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
    throw serviceNotConfiguredError(`Service "${code}" is not seeded — run npm run seed:services.`);
  }

  if (requireActive && !service.isActive) {
    throw conflictError(`Service "${code}" is not currently active.`);
  }

  return service;
}

// Write-time pairing check (docs/plans/service-registry-unified-ledger-plan
// .md D4) — every ledger write resolves its service, then asserts the
// service's declared billingShape matches the Registration discriminator
// actually being written, BEFORE any insert. This is what keeps the two
// ledger dimensions (serviceId, billingShape) from silently drifting apart;
// a mismatch here means a caller wired the wrong discriminator model to the
// wrong service — a code defect, never a real runtime condition, hence a
// plain thrown Error rather than a typed 4xx.
function assertBillingShape(service, expectedShape) {
  if (service.billingShape !== expectedShape) {
    throw new Error(
      `Service "${service.code}" has billingShape "${service.billingShape}", expected "${expectedShape}" for this ledger write.`
    );
  }
}

module.exports = { getServiceByCode, assertBillingShape };
