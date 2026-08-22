const Spotlight = require('../models/spotlight.model');

function notFoundError(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

async function create(data) {
  return Spotlight.create(data);
}

async function list() {
  return Spotlight.find().sort({ order: 1 });
}

async function getById(id) {
  const spotlight = await Spotlight.findById(id);

  if (!spotlight) {
    throw notFoundError('Spotlight not found');
  }

  return spotlight;
}

async function update(id, data) {
  const spotlight = await Spotlight.findByIdAndUpdate(id, data, {
    new: true,
    runValidators: true,
  });

  if (!spotlight) {
    throw notFoundError('Spotlight not found');
  }

  return spotlight;
}

async function remove(id) {
  const spotlight = await Spotlight.findById(id);

  if (!spotlight) {
    throw notFoundError('Spotlight not found');
  }

  await Spotlight.deleteOne({ _id: id });

  return spotlight;
}

// Unauthenticated public listing for one type, published only, ordered —
// a thin projection of verbatim strings, no ids/timestamps/isPublished.
async function listPublic(type) {
  const spotlights = await Spotlight.find({ type, isPublished: true }).sort({ order: 1 });

  return spotlights.map((spotlight) => ({
    name: spotlight.name,
    title: spotlight.title,
    body: spotlight.body,
    bullets: spotlight.bullets,
    imageUrl: spotlight.imageUrl,
  }));
}

module.exports = { create, list, getById, update, remove, listPublic };
