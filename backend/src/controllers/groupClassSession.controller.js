const groupClassSessionService = require('../services/groupClassSession.service');

async function byScheduleId(req, res) {
  try {
    const sessions = await groupClassSessionService.listBySchedule(req.params.scheduleId);
    return res.status(200).json({ sessions });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list sessions' });
  }
}

async function getById(req, res) {
  try {
    const session = await groupClassSessionService.getById(req.params.id);
    return res.status(200).json({ session });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to fetch session' });
  }
}

module.exports = { byScheduleId, getById };
