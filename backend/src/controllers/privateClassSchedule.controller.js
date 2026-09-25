const privateClassScheduleService = require('../services/privateClassSchedule.service');

// POST /private-class-schedules — publish availability in bulk. A coach
// publishes for themselves; an admin names the coach in the body.
async function create(req, res, next) {
  try {
    const coachId = req.user.role === 'coach' ? req.user._id : req.body.coachId;

    if (!coachId) {
      return res.status(400).json({ message: 'coachId is required' });
    }

    const schedules = await privateClassScheduleService.createBulk({
      coachId,
      daysOfWeek: req.body.daysOfWeek,
      windowStart: req.body.windowStart,
      windowEnd: req.body.windowEnd,
      slotDurationMinutes: req.body.slotDurationMinutes,
      startDate: req.body.startDate,
      endDate: req.body.endDate,
    });

    return res.status(201).json({ schedules });
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
    const schedules = await privateClassScheduleService.listAll({ coachId: req.query.coachId });
    return res.status(200).json({ schedules });
  } catch (error) {
    return next(error);
  }
}

async function remove(req, res, next) {
  try {
    const { outcome } = await privateClassScheduleService.remove(req.params.id, req.user);
    return res.status(200).json({ outcome });
  } catch (error) {
    return next(error);
  }
}

async function listPublic(req, res, next) {
  try {
    const { coaches } = await privateClassScheduleService.listPublic();
    return res.status(200).json({ coaches });
  } catch (error) {
    return next(error);
  }
}

async function listAvailableDates(req, res, next) {
  try {
    const dates = await privateClassScheduleService.listAvailableDates(req.params.id, { days: req.query.days });
    return res.status(200).json({ dates });
  } catch (error) {
    return next(error);
  }
}

module.exports = { create, listMine, listAll, remove, listPublic, listAvailableDates };
