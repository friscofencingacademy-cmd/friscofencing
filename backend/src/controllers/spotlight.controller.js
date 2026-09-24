const spotlightService = require('../services/spotlight.service');

async function create(req, res, next) {
  try {
    const spotlight = await spotlightService.create(req.body);
    return res.status(201).json({ spotlight });
  } catch (error) {
    return next(error);
  }
}

async function list(req, res, next) {
  try {
    const spotlights = await spotlightService.list();
    return res.status(200).json({ spotlights });
  } catch (error) {
    return next(error);
  }
}

async function getById(req, res, next) {
  try {
    const spotlight = await spotlightService.getById(req.params.id);
    return res.status(200).json({ spotlight });
  } catch (error) {
    return next(error);
  }
}

async function update(req, res, next) {
  try {
    const spotlight = await spotlightService.update(req.params.id, req.body);
    return res.status(200).json({ spotlight });
  } catch (error) {
    return next(error);
  }
}

async function remove(req, res, next) {
  try {
    await spotlightService.remove(req.params.id);
    return res.status(200).json({ success: true });
  } catch (error) {
    return next(error);
  }
}

async function listPublic(req, res, next) {
  try {
    const { type } = req.query;

    if (type !== 'coach' && type !== 'student') {
      return res.status(400).json({ message: 'type must be "coach" or "student"' });
    }

    const spotlights = await spotlightService.listPublic(type);
    return res.status(200).json({ spotlights });
  } catch (error) {
    return next(error);
  }
}

async function uploadImage(req, res, next) {
  try {
    const imageUrl = await spotlightService.uploadImage(req.file);
    return res.status(201).json({ imageUrl });
  } catch (error) {
    return next(error);
  }
}

module.exports = { create, list, getById, update, remove, listPublic, uploadImage };
