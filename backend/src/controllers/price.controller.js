const priceService = require('../services/price.service');

async function create(req, res, next) {
  try {
    const price = await priceService.create(req.body);
    return res.status(201).json({ price });
  } catch (error) {
    return next(error);
  }
}

async function list(req, res, next) {
  try {
    const prices = await priceService.list();
    return res.status(200).json({ prices });
  } catch (error) {
    return next(error);
  }
}

async function getById(req, res, next) {
  try {
    const price = await priceService.getById(req.params.id);
    return res.status(200).json({ price });
  } catch (error) {
    return next(error);
  }
}

async function update(req, res, next) {
  try {
    const price = await priceService.update(req.params.id, req.body);
    return res.status(200).json({ price });
  } catch (error) {
    return next(error);
  }
}

async function remove(req, res, next) {
  try {
    await priceService.remove(req.params.id);
    return res.status(200).json({ success: true });
  } catch (error) {
    return next(error);
  }
}

module.exports = { create, list, getById, update, remove };
