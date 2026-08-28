const Location = require('../models/location.model');
const GroupClass = require('../models/groupClass.model');

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

// Every controller in this codebase does `error.status || 500` — a raw
// Mongoose ValidationError has no .status, so without this it would surface
// as a bare 500 with an internal Mongoose message. Scoped to exactly the
// new timezone validator (docs/plans/timezone-consistency-plan.md D8), not
// a general overhaul of this route's error handling — a missing required
// field (name/address) still 500s today, a separate pre-existing gap this
// plan does not fix.
function remapTimezoneValidationError(error) {
  if (error.name === 'ValidationError' && error.errors && error.errors.timezone) {
    throw badRequestError(error.errors.timezone.message);
  }

  throw error;
}

async function create(data) {
  try {
    return await Location.create(data);
  } catch (error) {
    remapTimezoneValidationError(error);
  }
}

async function list() {
  return Location.find();
}

async function getById(id) {
  const location = await Location.findById(id);

  if (!location) {
    throw notFoundError('Location not found');
  }

  return location;
}

async function update(id, data) {
  let location;

  try {
    location = await Location.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    });
  } catch (error) {
    remapTimezoneValidationError(error);
  }

  if (!location) {
    throw notFoundError('Location not found');
  }

  return location;
}

async function remove(id) {
  const location = await Location.findById(id);

  if (!location) {
    throw notFoundError('Location not found');
  }

  const referencingCount = await GroupClass.countDocuments({ locationId: id });

  if (referencingCount > 0) {
    const error = new Error(
      `Cannot delete: ${referencingCount} class(es) reference this location.`
    );
    error.status = 409;
    throw error;
  }

  await Location.deleteOne({ _id: id });

  return location;
}

// Unauthenticated public listing — a thin {name, address, timezone}
// projection.
async function listPublic() {
  const locations = await Location.find();

  return locations.map((location) => ({
    name: location.name,
    address: location.address,
    timezone: location.timezone,
  }));
}

module.exports = { create, list, getById, update, remove, listPublic };
