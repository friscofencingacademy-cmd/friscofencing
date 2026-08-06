const groupClassService = require('../services/groupClass.service');

async function create(req, res) {
  try {
    const groupClass = await groupClassService.create(req.body);
    return res.status(201).json({ groupClass });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to create group class' });
  }
}

async function list(req, res) {
  try {
    const groupClasses = await groupClassService.list();
    return res.status(200).json({ groupClasses });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list group classes' });
  }
}

async function getById(req, res) {
  try {
    const groupClass = await groupClassService.getById(req.params.id);
    return res.status(200).json({ groupClass });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to fetch group class' });
  }
}

async function update(req, res) {
  try {
    const groupClass = await groupClassService.update(req.params.id, req.body);
    return res.status(200).json({ groupClass });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to update group class' });
  }
}

async function remove(req, res) {
  try {
    await groupClassService.remove(req.params.id);
    return res.status(200).json({ success: true });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to delete group class' });
  }
}

module.exports = { create, list, getById, update, remove };
