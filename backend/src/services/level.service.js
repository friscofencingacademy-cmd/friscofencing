const Level = require('../models/level.model');
const GroupClass = require('../models/groupClass.model');
const Price = require('../models/price.model');
const { notFoundError, conflictError } = require('../utils/errors');

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
    throw conflictError(
      `Cannot delete: ${referencingCount} class(es) reference this level.`
    );
  }

  const referencingPrice = await Price.findOne({ levelId: id });

  if (referencingPrice) {
    throw conflictError('Cannot delete: a price is configured for this level.');
  }

  await Level.deleteOne({ _id: id });

  return level;
}

// Unauthenticated public listing — a thin {name, order, monthlyFee}
// projection, ordered for display. A level with no configured Price is
// excluded rather than shown with a missing/invented fee.
async function listPublic() {
  const levels = await Level.find().sort({ order: 1 });
  const prices = await Price.find({ levelId: { $in: levels.map((level) => level._id) } });
  const monthlyFeeByLevelId = new Map(
    prices.map((price) => [String(price.levelId), price.monthlyFee])
  );

  return levels
    .filter((level) => monthlyFeeByLevelId.has(String(level._id)))
    .map((level) => ({
      name: level.name,
      order: level.order,
      monthlyFee: monthlyFeeByLevelId.get(String(level._id)),
    }));
}

module.exports = { create, list, getById, update, remove, listPublic };
