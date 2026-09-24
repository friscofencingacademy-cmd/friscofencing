const privateClassSessionService = require('../services/privateClassSession.service');

async function listMine(req, res, next) {
  try {
    const sessions = await privateClassSessionService.listMine(req.user._id, req.query.window);
    return res.status(200).json({ sessions });
  } catch (error) {
    return next(error);
  }
}

async function markAttendance(req, res, next) {
  try {
    const result = await privateClassSessionService.markAttendance(
      req.params.id,
      req.body.status,
      req.user
    );
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function retryCharge(req, res, next) {
  try {
    const result = await privateClassSessionService.retryCharge(req.params.id, req.user);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = { listMine, markAttendance, retryCharge };
