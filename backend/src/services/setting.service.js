const Setting = require('../models/setting.model');

function badRequestError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

// No caching, deliberately — every other billing read in this codebase
// (calculateChargeAmount, resolveCurrentFee) reads fresh every time, never
// cached (ADR 001's core "re-verified every time" principle). A Setting
// read is cheap (one findOne on a tiny singleton collection) and only ever
// happens at registration time, not a hot path, so there's no performance
// reason to deviate from that convention here.

// Always returns a usable object, even before any admin has ever saved one
// — an empty settings collection means "the defaults," never an error, so
// callers never need a null-check. prorationEnabled is deliberately not
// exposed here — it's deprecated (docs/decisions/007-calendar-month-
// billing.md), no code path reads it anymore.
async function getSettings() {
  const doc = await Setting.findOne();

  if (!doc) {
    return { registrationFee: 0, returningStudentGracePeriodMonths: 0 };
  }

  return {
    registrationFee: doc.registrationFee,
    returningStudentGracePeriodMonths: doc.returningStudentGracePeriodMonths,
  };
}

// Partial update — only the fields present in `patch` are touched, so a
// PATCH sending just one field can never accidentally reset the other to
// its schema default. Upserts the singleton on first save.
async function updateSettings(patch) {
  const setFields = {};

  if (patch.registrationFee !== undefined) {
    if (typeof patch.registrationFee !== 'number' || Number.isNaN(patch.registrationFee) || patch.registrationFee < 0) {
      throw badRequestError('registrationFee must be a number >= 0');
    }
    setFields.registrationFee = patch.registrationFee;
  }

  if (patch.returningStudentGracePeriodMonths !== undefined) {
    if (
      typeof patch.returningStudentGracePeriodMonths !== 'number' ||
      Number.isNaN(patch.returningStudentGracePeriodMonths) ||
      patch.returningStudentGracePeriodMonths < 0
    ) {
      throw badRequestError('returningStudentGracePeriodMonths must be a number >= 0');
    }
    setFields.returningStudentGracePeriodMonths = patch.returningStudentGracePeriodMonths;
  }

  await Setting.findOneAndUpdate(
    {},
    { $set: setFields },
    { upsert: true, setDefaultsOnInsert: true, runValidators: true }
  );

  return getSettings();
}

module.exports = { getSettings, updateSettings };
