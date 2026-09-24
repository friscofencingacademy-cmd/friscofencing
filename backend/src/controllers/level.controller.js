const levelService = require('../services/level.service');

async function create(req, res, next) {
  try {
    const level = await levelService.create(req.body);
    return res.status(201).json({ level });
  } catch (error) {
    return next(error);
  }
}

async function list(req, res, next) {
  try {
    const levels = await levelService.list();
    return res.status(200).json({ levels });
  } catch (error) {
    return next(error);
  }
}

async function getById(req, res, next) {
  try {
    const level = await levelService.getById(req.params.id);
    return res.status(200).json({ level });
  } catch (error) {
    return next(error);
  }
}

async function update(req, res, next) {
  try {
    const level = await levelService.update(req.params.id, req.body);
    return res.status(200).json({ level });
  } catch (error) {
    return next(error);
  }
}

async function remove(req, res, next) {
  try {
    await levelService.remove(req.params.id);
    return res.status(200).json({ success: true });
  } catch (error) {
    return next(error);
  }
}

async function listPublic(req, res, next) {
  try {
    const levels = await levelService.listPublic();
    return res.status(200).json({ levels });
  } catch (error) {
    return next(error);
  }
}

module.exports = { create, list, getById, update, remove, listPublic };
