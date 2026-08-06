const Price = require('../models/price.model');
const Level = require('../models/level.model');

function notFoundError(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

async function assertLevelExists(levelId) {
  if (levelId === undefined) {
    return;
  }

  const level = await Level.findById(levelId);

  if (!level) {
    throw notFoundError('Level not found');
  }
}

async function assertNoExistingPrice(levelId, excludeId) {
  const existing = await Price.findOne({ levelId });

  if (existing && String(existing._id) !== String(excludeId)) {
    const error = new Error('A price already exists for this level');
    error.status = 409;
    throw error;
  }
}

async function create(data) {
  await assertLevelExists(data.levelId);
  await assertNoExistingPrice(data.levelId);

  return Price.create(data);
}

async function list() {
  return Price.find();
}

async function getById(id) {
  const price = await Price.findById(id);

  if (!price) {
    throw notFoundError('Price not found');
  }

  return price;
}

async function update(id, data) {
  await assertLevelExists(data.levelId);

  if (data.levelId !== undefined) {
    await assertNoExistingPrice(data.levelId, id);
  }

  const price = await Price.findByIdAndUpdate(id, data, {
    new: true,
    runValidators: true,
  });

  if (!price) {
    throw notFoundError('Price not found');
  }

  return price;
}

async function remove(id) {
  const price = await Price.findByIdAndDelete(id);

  if (!price) {
    throw notFoundError('Price not found');
  }

  return price;
}

module.exports = { create, list, getById, update, remove };
