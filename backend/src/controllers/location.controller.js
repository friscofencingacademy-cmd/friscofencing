const locationService = require('../services/location.service');

async function create(req, res, next) {
  try {
    const location = await locationService.create(req.body);
    return res.status(201).json({ location });
  } catch (error) {
    return next(error);
  }
}

async function list(req, res, next) {
  try {
    const locations = await locationService.list();
    return res.status(200).json({ locations });
  } catch (error) {
    return next(error);
  }
}

async function getById(req, res, next) {
  try {
    const location = await locationService.getById(req.params.id);
    return res.status(200).json({ location });
  } catch (error) {
    return next(error);
  }
}

async function update(req, res, next) {
  try {
    const location = await locationService.update(req.params.id, req.body);
    return res.status(200).json({ location });
  } catch (error) {
    return next(error);
  }
}

async function remove(req, res, next) {
  try {
    await locationService.remove(req.params.id);
    return res.status(200).json({ success: true });
  } catch (error) {
    return next(error);
  }
}

async function listPublic(req, res, next) {
  try {
    const locations = await locationService.listPublic();
    return res.status(200).json({ locations });
  } catch (error) {
    return next(error);
  }
}

module.exports = { create, list, getById, update, remove, listPublic };
