const spotlightService = require('../services/spotlight.service');

async function create(req, res) {
  try {
    const spotlight = await spotlightService.create(req.body);
    return res.status(201).json({ spotlight });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to create spotlight' });
  }
}

async function list(req, res) {
  try {
    const spotlights = await spotlightService.list();
    return res.status(200).json({ spotlights });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list spotlights' });
  }
}

async function getById(req, res) {
  try {
    const spotlight = await spotlightService.getById(req.params.id);
    return res.status(200).json({ spotlight });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to fetch spotlight' });
  }
}

async function update(req, res) {
  try {
    const spotlight = await spotlightService.update(req.params.id, req.body);
    return res.status(200).json({ spotlight });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to update spotlight' });
  }
}

async function remove(req, res) {
  try {
    await spotlightService.remove(req.params.id);
    return res.status(200).json({ success: true });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to delete spotlight' });
  }
}

async function listPublic(req, res) {
  try {
    const { type } = req.query;

    if (type !== 'coach' && type !== 'student') {
      return res.status(400).json({ message: 'type must be "coach" or "student"' });
    }

    const spotlights = await spotlightService.listPublic(type);
    return res.status(200).json({ spotlights });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list spotlights' });
  }
}

async function uploadImage(req, res) {
  try {
    const imageUrl = await spotlightService.uploadImage(req.file);
    return res.status(201).json({ imageUrl });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to upload image' });
  }
}

module.exports = { create, list, getById, update, remove, listPublic, uploadImage };
