const Location = require('../models/location.model');
const GroupClass = require('../models/groupClass.model');

function notFoundError(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

async function create(data) {
  return Location.create(data);
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
  const location = await Location.findByIdAndUpdate(id, data, {
    new: true,
    runValidators: true,
  });

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

module.exports = { create, list, getById, update, remove };
