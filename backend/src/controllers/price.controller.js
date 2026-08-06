const priceService = require('../services/price.service');

async function create(req, res) {
  try {
    const price = await priceService.create(req.body);
    return res.status(201).json({ price });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to create price' });
  }
}

async function list(req, res) {
  try {
    const prices = await priceService.list();
    return res.status(200).json({ prices });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list prices' });
  }
}

async function getById(req, res) {
  try {
    const price = await priceService.getById(req.params.id);
    return res.status(200).json({ price });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to fetch price' });
  }
}

async function update(req, res) {
  try {
    const price = await priceService.update(req.params.id, req.body);
    return res.status(200).json({ price });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to update price' });
  }
}

async function remove(req, res) {
  try {
    await priceService.remove(req.params.id);
    return res.status(200).json({ success: true });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to delete price' });
  }
}

module.exports = { create, list, getById, update, remove };
