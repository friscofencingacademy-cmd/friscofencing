const groupClassService = require('../services/groupClass.service');

async function create(req, res, next) {
  try {
    const groupClass = await groupClassService.create(req.body);
    return res.status(201).json({ groupClass });
  } catch (error) {
    return next(error);
  }
}

async function list(req, res, next) {
  try {
    const groupClasses = await groupClassService.list();
    return res.status(200).json({ groupClasses });
  } catch (error) {
    return next(error);
  }
}

async function getById(req, res, next) {
  try {
    const groupClass = await groupClassService.getById(req.params.id);
    return res.status(200).json({ groupClass });
  } catch (error) {
    return next(error);
  }
}

async function update(req, res, next) {
  try {
    const groupClass = await groupClassService.update(req.params.id, req.body);
    return res.status(200).json({ groupClass });
  } catch (error) {
    return next(error);
  }
}

async function remove(req, res, next) {
  try {
    await groupClassService.remove(req.params.id);
    return res.status(200).json({ success: true });
  } catch (error) {
    return next(error);
  }
}

module.exports = { create, list, getById, update, remove };
