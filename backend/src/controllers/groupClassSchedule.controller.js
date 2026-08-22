const groupClassScheduleService = require('../services/groupClassSchedule.service');

async function create(req, res) {
  try {
    const schedule = await groupClassScheduleService.create(req.body);
    return res.status(201).json({ schedule });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to create schedule' });
  }
}

async function list(req, res) {
  try {
    const schedules = await groupClassScheduleService.list();
    return res.status(200).json({ schedules });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list schedules' });
  }
}

async function mine(req, res) {
  try {
    const schedules = await groupClassScheduleService.listByCoach(req.user._id);
    return res.status(200).json({ schedules });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list schedules' });
  }
}

async function getById(req, res) {
  try {
    const schedule = await groupClassScheduleService.getById(req.params.id);
    return res.status(200).json({ schedule });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to fetch schedule' });
  }
}

async function update(req, res) {
  try {
    const schedule = await groupClassScheduleService.update(req.params.id, req.body);
    return res.status(200).json({ schedule });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to update schedule' });
  }
}

async function remove(req, res) {
  try {
    await groupClassScheduleService.remove(req.params.id);
    return res.status(200).json({ success: true });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to delete schedule' });
  }
}

async function listPublic(req, res) {
  try {
    const schedules = await groupClassScheduleService.listPublic();
    return res.status(200).json({ schedules });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list schedules' });
  }
}

module.exports = { create, list, mine, getById, update, remove, listPublic };
