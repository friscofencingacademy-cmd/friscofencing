const testimonialService = require('../services/testimonial.service');

async function create(req, res) {
  try {
    const testimonial = await testimonialService.create(req.body);
    return res.status(201).json({ testimonial });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to create testimonial' });
  }
}

async function list(req, res) {
  try {
    const testimonials = await testimonialService.list();
    return res.status(200).json({ testimonials });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list testimonials' });
  }
}

async function getById(req, res) {
  try {
    const testimonial = await testimonialService.getById(req.params.id);
    return res.status(200).json({ testimonial });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to fetch testimonial' });
  }
}

async function update(req, res) {
  try {
    const testimonial = await testimonialService.update(req.params.id, req.body);
    return res.status(200).json({ testimonial });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to update testimonial' });
  }
}

async function remove(req, res) {
  try {
    await testimonialService.remove(req.params.id);
    return res.status(200).json({ success: true });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to delete testimonial' });
  }
}

async function listPublic(req, res) {
  try {
    const testimonials = await testimonialService.listPublic();
    return res.status(200).json({ testimonials });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list testimonials' });
  }
}

async function uploadImage(req, res) {
  try {
    const imageUrl = await testimonialService.uploadImage(req.file);
    return res.status(201).json({ imageUrl });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to upload image' });
  }
}

module.exports = { create, list, getById, update, remove, listPublic, uploadImage };
