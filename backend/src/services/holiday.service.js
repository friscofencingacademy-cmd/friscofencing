const Holiday = require('../models/holiday.model');
const { dateOnlyUTC } = require('../utils/dateShapes');

const MAX_DURATION_DAYS = 31;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function notFoundError(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function badRequestError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function conflictError(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

// Parses + normalizes a client-supplied date (a 'YYYY-MM-DD' string, or
// anything `new Date()` can parse) into a calendar-day sentinel via the
// sanctioned dateShapes.js gate. Throws 400 on anything unparseable.
function parseSentinel(value, label) {
  const raw = new Date(value);

  if (Number.isNaN(raw.getTime())) {
    throw badRequestError(`Invalid ${label}`);
  }

  return dateOnlyUTC(raw);
}

// Overlap = any date shared between the two inclusive ranges. Sentinel-vs-
// sentinel comparison only (D3) — both sides are always UTC-midnight Dates.
function buildOverlapQuery(startSentinel, endSentinel, excludeId) {
  const query = {
    startDate: { $lte: endSentinel },
    endDate: { $gte: startSentinel },
  };

  if (excludeId) {
    query._id = { $ne: excludeId };
  }

  return query;
}

async function assertValidRange(startSentinel, endSentinel) {
  if (endSentinel < startSentinel) {
    throw badRequestError('End date must be on or after the start date');
  }

  const diffDays = (endSentinel.getTime() - startSentinel.getTime()) / MS_PER_DAY;

  if (diffDays > MAX_DURATION_DAYS - 1) {
    throw badRequestError(`Holiday duration cannot exceed ${MAX_DURATION_DAYS} days`);
  }
}

async function assertNoOverlap(startSentinel, endSentinel, excludeId) {
  const overlapping = await Holiday.find(buildOverlapQuery(startSentinel, endSentinel, excludeId));

  if (overlapping.length > 0) {
    const names = overlapping.map((h) => h.name).join(', ');
    throw conflictError(`Holiday overlaps with: ${names}`);
  }
}

async function assertUniqueName(name, excludeId) {
  const query = { name };

  if (excludeId) {
    query._id = { $ne: excludeId };
  }

  const existing = await Holiday.findOne(query);

  if (existing) {
    throw conflictError('A holiday with this name already exists');
  }
}

async function create({ name, startDate, endDate }) {
  if (!name || !name.trim()) {
    throw badRequestError('Name is required');
  }

  const startSentinel = parseSentinel(startDate, 'startDate');
  const endSentinel = parseSentinel(endDate, 'endDate');

  await assertValidRange(startSentinel, endSentinel);
  await assertUniqueName(name.trim());
  await assertNoOverlap(startSentinel, endSentinel);

  return Holiday.create({ name: name.trim(), startDate: startSentinel, endDate: endSentinel });
}

async function list() {
  return Holiday.find().sort({ startDate: 1 });
}

async function getById(id) {
  const holiday = await Holiday.findById(id);

  if (!holiday) {
    throw notFoundError('Holiday not found');
  }

  return holiday;
}

async function update(id, { name, startDate, endDate }) {
  const holiday = await Holiday.findById(id);

  if (!holiday) {
    throw notFoundError('Holiday not found');
  }

  const resolvedName = name !== undefined ? name.trim() : holiday.name;

  if (!resolvedName) {
    throw badRequestError('Name is required');
  }

  const startSentinel = startDate !== undefined ? parseSentinel(startDate, 'startDate') : holiday.startDate;
  const endSentinel = endDate !== undefined ? parseSentinel(endDate, 'endDate') : holiday.endDate;

  await assertValidRange(startSentinel, endSentinel);

  if (resolvedName !== holiday.name) {
    await assertUniqueName(resolvedName, id);
  }

  await assertNoOverlap(startSentinel, endSentinel, id);

  holiday.name = resolvedName;
  holiday.startDate = startSentinel;
  holiday.endDate = endSentinel;

  await holiday.save();

  return holiday;
}

async function remove(id) {
  const holiday = await Holiday.findByIdAndDelete(id);

  if (!holiday) {
    throw notFoundError('Holiday not found');
  }

  return holiday;
}

// The one query every consumer (session listing/filtering/attendance)
// should use — a single DB round trip covering a whole date range, rather
// than one query per session. `.lean()` since callers only ever read these.
async function getHolidaysInRange(startSentinel, endSentinel) {
  return Holiday.find({
    startDate: { $lte: endSentinel },
    endDate: { $gte: startSentinel },
  }).lean();
}

// Returns the covering holiday (or null) for a single calendar-day sentinel,
// against an optional pre-fetched `holidays` array (avoids an N+1 query when
// filtering/annotating a list of sessions — fetch once via
// getHolidaysInRange, then call this per session).
function findHolidayForDate(dateSentinel, holidays) {
  return holidays.find((h) => dateSentinel >= h.startDate && dateSentinel <= h.endDate) ?? null;
}

module.exports = {
  create,
  list,
  getById,
  update,
  remove,
  getHolidaysInRange,
  findHolidayForDate,
};
