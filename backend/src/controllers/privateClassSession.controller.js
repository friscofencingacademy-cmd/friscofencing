const privateClassSessionService = require('../services/privateClassSession.service');

// Book a date with an already-paid session.
async function book(req, res, next) {
  try {
    const result = await privateClassSessionService.book(
      { studentId: req.body.studentId, scheduleId: req.body.scheduleId, day: req.body.day },
      req.user
    );
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
}

async function listMine(req, res, next) {
  try {
    const sessions = await privateClassSessionService.listMine(req.user._id, req.query.window);
    return res.status(200).json({ sessions });
  } catch (error) {
    return next(error);
  }
}

async function listAll(req, res, next) {
  try {
    const sessions = await privateClassSessionService.listAll({
      coachId: req.query.coachId,
      status: req.query.status,
    });
    return res.status(200).json({ sessions });
  } catch (error) {
    return next(error);
  }
}

async function markAttendance(req, res, next) {
  try {
    const result = await privateClassSessionService.markAttendance(req.params.id, req.body.status, req.user);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function cancel(req, res, next) {
  try {
    const result = await privateClassSessionService.cancel(req.params.id, req.user);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = { book, listMine, listAll, markAttendance, cancel };
