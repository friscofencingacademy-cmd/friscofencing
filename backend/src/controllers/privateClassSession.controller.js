const privateClassSessionService = require('../services/privateClassSession.service');

async function listMine(req, res) {
  try {
    const sessions = await privateClassSessionService.listMine(req.user._id, req.query.window);
    return res.status(200).json({ sessions });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list your sessions' });
  }
}

async function markAttendance(req, res) {
  try {
    const result = await privateClassSessionService.markAttendance(
      req.params.id,
      req.body.status,
      req.user
    );
    return res.status(200).json(result);
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to record attendance' });
  }
}

async function retryCharge(req, res) {
  try {
    const result = await privateClassSessionService.retryCharge(req.params.id, req.user);
    return res.status(200).json(result);
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to retry the charge' });
  }
}

module.exports = { listMine, markAttendance, retryCharge };
