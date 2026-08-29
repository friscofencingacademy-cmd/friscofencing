const crypto = require('crypto');
const path = require('path');
const { put } = require('@vercel/blob');

const Testimonial = require('../models/testimonial.model');

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

async function create(data) {
  return Testimonial.create(data);
}

async function list() {
  return Testimonial.find().sort({ order: 1 });
}

async function getById(id) {
  const testimonial = await Testimonial.findById(id);

  if (!testimonial) {
    throw notFoundError('Testimonial not found');
  }

  return testimonial;
}

async function update(id, data) {
  const testimonial = await Testimonial.findByIdAndUpdate(id, data, {
    new: true,
    runValidators: true,
  });

  if (!testimonial) {
    throw notFoundError('Testimonial not found');
  }

  return testimonial;
}

async function remove(id) {
  const testimonial = await Testimonial.findById(id);

  if (!testimonial) {
    throw notFoundError('Testimonial not found');
  }

  await Testimonial.deleteOne({ _id: id });

  return testimonial;
}

// Unauthenticated public listing, published only, ordered — a thin
// projection of verbatim strings, no ids/timestamps/isPublished.
async function listPublic() {
  const testimonials = await Testimonial.find({ isPublished: true }).sort({ order: 1 });

  return testimonials.map((testimonial) => ({
    quote: testimonial.quote,
    authorName: testimonial.authorName,
    caption: testimonial.caption,
    imageUrl: testimonial.imageUrl,
  }));
}

// Uploads an admin-supplied testimonial photo to Vercel Blob and returns
// its public URL — same pattern as spotlight.service.js's uploadImage
// (random UUID filename, never the uploader's original).
async function uploadImage(file) {
  if (!file) {
    throw badRequestError('An image file is required');
  }

  const extension = path.extname(file.originalname) || '';
  const pathname = `testimonials/${crypto.randomUUID()}${extension}`;

  const blob = await put(pathname, file.buffer, {
    access: 'public',
    contentType: file.mimetype,
  });

  return blob.url;
}

module.exports = { create, list, getById, update, remove, listPublic, uploadImage };
