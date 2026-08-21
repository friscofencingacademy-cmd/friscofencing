const privateClassScheduleService = require('../services/privateClassSchedule.service');

async function create(req, res) {
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
    const status = error.status || 500;
    return res
      .status(status)
      .json({ message: error.message || 'Failed to create private class schedule' });
  }
}

async function listMine(req, res) {
  try {
    const schedules = await privateClassScheduleService.listMine(req.user._id);
    return res.status(200).json({ schedules });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list your slots' });
  }
}

async function listAll(req, res) {
  try {
    const schedules = await privateClassScheduleService.listAll({
      coachId: req.query.coachId,
      available: req.query.available,
    });
    return res.status(200).json({ schedules });
  } catch (error) {
    const status = error.status || 500;
    return res
      .status(status)
      .json({ message: error.message || 'Failed to list private class schedules' });
  }
}

async function remove(req, res) {
  try {
    await privateClassScheduleService.remove(req.params.id, req.user);
    return res.status(200).json({ success: true });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to delete slot' });
  }
}

async function listPublic(req, res) {
  try {
    const coaches = await privateClassScheduleService.listPublic();
    return res.status(200).json({ coaches });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to load available slots' });
  }
}

module.exports = { create, listMine, listAll, remove, listPublic };
