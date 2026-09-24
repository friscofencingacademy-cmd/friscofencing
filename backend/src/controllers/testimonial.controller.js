const testimonialService = require('../services/testimonial.service');

async function create(req, res, next) {
  try {
    const testimonial = await testimonialService.create(req.body);
    return res.status(201).json({ testimonial });
  } catch (error) {
    return next(error);
  }
}

async function list(req, res, next) {
  try {
    const testimonials = await testimonialService.list();
    return res.status(200).json({ testimonials });
  } catch (error) {
    return next(error);
  }
}

async function getById(req, res, next) {
  try {
    const testimonial = await testimonialService.getById(req.params.id);
    return res.status(200).json({ testimonial });
  } catch (error) {
    return next(error);
  }
}

async function update(req, res, next) {
  try {
    const testimonial = await testimonialService.update(req.params.id, req.body);
    return res.status(200).json({ testimonial });
  } catch (error) {
    return next(error);
  }
}

async function remove(req, res, next) {
  try {
    await testimonialService.remove(req.params.id);
    return res.status(200).json({ success: true });
  } catch (error) {
    return next(error);
  }
}

async function listPublic(req, res, next) {
  try {
    const testimonials = await testimonialService.listPublic();
    return res.status(200).json({ testimonials });
  } catch (error) {
    return next(error);
  }
}

async function uploadImage(req, res, next) {
  try {
    const imageUrl = await testimonialService.uploadImage(req.file);
    return res.status(201).json({ imageUrl });
  } catch (error) {
    return next(error);
  }
}

module.exports = { create, list, getById, update, remove, listPublic, uploadImage };
