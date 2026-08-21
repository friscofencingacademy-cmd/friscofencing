const Level = require('../models/level.model');
const GroupClass = require('../models/groupClass.model');
const Price = require('../models/price.model');

function notFoundError(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

async function create(data) {
  return Level.create(data);
}

async function list() {
  return Level.find();
}

async function getById(id) {
  const level = await Level.findById(id);

  if (!level) {
    throw notFoundError('Level not found');
  }

  return level;
}

async function update(id, data) {
  const level = await Level.findByIdAndUpdate(id, data, {
    new: true,
    runValidators: true,
  });

  if (!level) {
    throw notFoundError('Level not found');
  }

  return level;
}

async function remove(id) {
  const level = await Level.findById(id);

  if (!level) {
    throw notFoundError('Level not found');
  }

  const referencingCount = await GroupClass.countDocuments({ levelId: id });

  if (referencingCount > 0) {
    const error = new Error(
      `Cannot delete: ${referencingCount} class(es) reference this level.`
    );
    error.status = 409;
    throw error;
  }

  const referencingPrice = await Price.findOne({ levelId: id });

  if (referencingPrice) {
    const error = new Error('Cannot delete: a price is configured for this level.');
    error.status = 409;
    throw error;
  }

  await Level.deleteOne({ _id: id });

  return level;
}

module.exports = { create, list, getById, update, remove };
