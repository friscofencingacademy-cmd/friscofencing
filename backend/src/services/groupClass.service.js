const GroupClass = require('../models/groupClass.model');
const Level = require('../models/level.model');
const Location = require('../models/location.model');

function notFoundError(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

async function assertRefsExist({ levelId, locationId }) {
  if (levelId !== undefined) {
    const level = await Level.findById(levelId);
    if (!level) {
      throw notFoundError('Level not found');
    }
  }

  if (locationId !== undefined) {
    const location = await Location.findById(locationId);
    if (!location) {
      throw notFoundError('Location not found');
    }
  }
}

async function create(data) {
  await assertRefsExist(data);

  return GroupClass.create(data);
}

async function list() {
  return GroupClass.find();
}

async function getById(id) {
  const groupClass = await GroupClass.findById(id);

  if (!groupClass) {
    throw notFoundError('Group class not found');
  }

  return groupClass;
}

async function update(id, data) {
  await assertRefsExist(data);

  const groupClass = await GroupClass.findByIdAndUpdate(id, data, {
    new: true,
    runValidators: true,
  });

  if (!groupClass) {
    throw notFoundError('Group class not found');
  }

  return groupClass;
}

async function remove(id) {
  const groupClass = await GroupClass.findByIdAndDelete(id);

  if (!groupClass) {
    throw notFoundError('Group class not found');
  }

  return groupClass;
}

module.exports = { create, list, getById, update, remove };
