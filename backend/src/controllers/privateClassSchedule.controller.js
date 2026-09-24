const privateClassScheduleService = require('../services/privateClassSchedule.service');

async function create(req, res, next) {
  try {
    const coachId = req.user.role === 'coach' ? req.user._id : req.body.coachId;

    if (!coachId) {
      return res.status(400).json({ message: 'coachId is required' });
    }

    const schedule = await privateClassScheduleService.create({
      coachId,
      dayOfWeek: req.body.dayOfWeek,
      startTime: req.body.startTime,
      durationMinutes: req.body.durationMinutes,
    });

    return res.status(201).json({ schedule });
  } catch (error) {
    return next(error);
  }
}

async function listMine(req, res, next) {
  try {
    const schedules = await privateClassScheduleService.listMine(req.user._id);
    return res.status(200).json({ schedules });
  } catch (error) {
    return next(error);
  }
}

async function listAll(req, res, next) {
  try {
    const schedules = await privateClassScheduleService.listAll({
      coachId: req.query.coachId,
      available: req.query.available,
    });
    return res.status(200).json({ schedules });
  } catch (error) {
    return next(error);
  }
}

async function remove(req, res, next) {
  try {
    await privateClassScheduleService.remove(req.params.id, req.user);
    return res.status(200).json({ success: true });
  } catch (error) {
    return next(error);
  }
}

async function listPublic(req, res, next) {
  try {
    const coaches = await privateClassScheduleService.listPublic();
    return res.status(200).json({ coaches });
  } catch (error) {
    return next(error);
  }
}

module.exports = { create, listMine, listAll, remove, listPublic };
