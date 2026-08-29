// Small, isolated on purpose — same pattern as billingDates.js's own helpers
// (docs/plans/trial-registration-required-fields-plan.md). Age is a derived
// DISPLAY value, computed fresh on every read, never stored on a User doc.

const { todayDateOnly } = require('./billingDates');

// Whole years between `dateOfBirth` and "today" (Central time, via
// todayDateOnly() — never the requesting browser's own clock/timezone, same
// "today" every other date-sensitive calculation in this codebase uses).
// Plain (non-UTC) Date getters, deliberately — both `dateOfBirth` and
// todayDateOnly()'s own return value are date-only UTC-midnight sentinels
// (billingDates.js's docblock), and this file's sibling helpers
// (daysInMonth/endOfMonth/addOneMonth) already establish that plain
// calendar-component arithmetic is the correct, consistent way to compare
// two such sentinels.
//
// @param {Date|null|undefined} dateOfBirth
// @returns {number|null} null when there's no dateOfBirth to compute from —
//   never 0 or a guessed value.
function calculateAge(dateOfBirth) {
  if (!dateOfBirth) {
    return null;
  }

  const today = todayDateOnly();
  let age = today.getFullYear() - dateOfBirth.getFullYear();

  const hasHadBirthdayThisYear =
    today.getMonth() > dateOfBirth.getMonth() ||
    (today.getMonth() === dateOfBirth.getMonth() && today.getDate() >= dateOfBirth.getDate());

  if (!hasHadBirthdayThisYear) {
    age -= 1;
  }

  return age;
}

// Shared by student.service.js and user.service.js — both have their own
// student-creation/listing branch, and both need the identical "derive age,
// never store it" treatment. Works against either a Mongoose doc or a plain
// object. Harmless (returns age: null) when called on a non-student row —
// calculateAge(undefined) is null regardless of role, so callers that map
// this over a mixed-role list (user.service.js's list()) don't need to
// branch on role themselves.
function withAge(user) {
  const plain = user.toJSON ? user.toJSON() : user;
  return { ...plain, age: calculateAge(plain.dateOfBirth) };
}

module.exports = { calculateAge, withAge };
