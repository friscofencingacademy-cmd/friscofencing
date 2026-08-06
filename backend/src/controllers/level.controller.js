const levelService = require('../services/level.service');

async function create(req, res) {
  try {
    const level = await levelService.create(req.body);
    return res.status(201).json({ level });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to create level' });
  }
}

async function list(req, res) {
  try {
    const levels = await levelService.list();
    return res.status(200).json({ levels });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list levels' });
  }
}

async function getById(req, res) {
  try {
    const level = await levelService.getById(req.params.id);
    return res.status(200).json({ level });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to fetch level' });
  }
}

async function update(req, res) {
  try {
    const level = await levelService.update(req.params.id, req.body);
    return res.status(200).json({ level });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to update level' });
  }
}

async function remove(req, res) {
  try {
    await levelService.remove(req.params.id);
    return res.status(200).json({ success: true });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to delete level' });
  }
}

module.exports = { create, list, getById, update, remove };
