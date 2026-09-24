const holidayService = require('../services/holiday.service');

async function create(req, res, next) {
  try {
    const holiday = await holidayService.create(req.body);
    return res.status(201).json({ holiday });
  } catch (error) {
    return next(error);
  }
}

async function list(req, res, next) {
  try {
    const holidays = await holidayService.list();
    return res.status(200).json({ holidays });
  } catch (error) {
    return next(error);
  }
}

async function getById(req, res, next) {
  try {
    const holiday = await holidayService.getById(req.params.id);
    return res.status(200).json({ holiday });
  } catch (error) {
    return next(error);
  }
}

async function update(req, res, next) {
  try {
    const holiday = await holidayService.update(req.params.id, req.body);
    return res.status(200).json({ holiday });
  } catch (error) {
    return next(error);
  }
}

async function remove(req, res, next) {
  try {
    await holidayService.remove(req.params.id);
    return res.status(200).json({ success: true });
  } catch (error) {
    return next(error);
  }
}

module.exports = { create, list, getById, update, remove };
