const locationService = require('../services/location.service');

async function create(req, res) {
  try {
    const location = await locationService.create(req.body);
    return res.status(201).json({ location });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to create location' });
  }
}

async function list(req, res) {
  try {
    const locations = await locationService.list();
    return res.status(200).json({ locations });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list locations' });
  }
}

async function getById(req, res) {
  try {
    const location = await locationService.getById(req.params.id);
    return res.status(200).json({ location });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to fetch location' });
  }
}

async function update(req, res) {
  try {
    const location = await locationService.update(req.params.id, req.body);
    return res.status(200).json({ location });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to update location' });
  }
}

async function remove(req, res) {
  try {
    await locationService.remove(req.params.id);
    return res.status(200).json({ success: true });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to delete location' });
  }
}

module.exports = { create, list, getById, update, remove };
