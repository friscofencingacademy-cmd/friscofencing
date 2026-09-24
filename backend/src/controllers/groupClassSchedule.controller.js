const groupClassScheduleService = require('../services/groupClassSchedule.service');

async function create(req, res, next) {
  try {
    const schedule = await groupClassScheduleService.create(req.body);
    return res.status(201).json({ schedule });
  } catch (error) {
    return next(error);
  }
}

async function list(req, res, next) {
  try {
    const schedules = await groupClassScheduleService.list();
    return res.status(200).json({ schedules });
  } catch (error) {
    return next(error);
  }
}

async function mine(req, res, next) {
  try {
    const schedules = await groupClassScheduleService.listByCoach(req.user._id);
    return res.status(200).json({ schedules });
  } catch (error) {
    return next(error);
  }
}

async function getById(req, res, next) {
  try {
    const schedule = await groupClassScheduleService.getById(req.params.id);
    return res.status(200).json({ schedule });
  } catch (error) {
    return next(error);
  }
}

async function update(req, res, next) {
  try {
    const schedule = await groupClassScheduleService.update(req.params.id, req.body);
    return res.status(200).json({ schedule });
  } catch (error) {
    return next(error);
  }
}

async function remove(req, res, next) {
  try {
    await groupClassScheduleService.remove(req.params.id);
    return res.status(200).json({ success: true });
  } catch (error) {
    return next(error);
  }
}

async function listPublic(req, res, next) {
  try {
    const schedules = await groupClassScheduleService.listPublic();
    return res.status(200).json({ schedules });
  } catch (error) {
    return next(error);
  }
}

module.exports = { create, list, mine, getById, update, remove, listPublic };
