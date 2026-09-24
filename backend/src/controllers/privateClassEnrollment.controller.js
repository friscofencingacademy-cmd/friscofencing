const privateClassEnrollmentService = require('../services/privateClassEnrollment.service');

async function create(req, res, next) {
  try {
    const result = await privateClassEnrollmentService.create(
      { studentId: req.body.studentId, scheduleId: req.body.scheduleId },
      req.user
    );
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
}

async function listMine(req, res, next) {
  try {
    const enrollments = await privateClassEnrollmentService.listMine(req.user._id);
    return res.status(200).json({ enrollments });
  } catch (error) {
    return next(error);
  }
}

async function listAll(req, res, next) {
  try {
    const enrollments = await privateClassEnrollmentService.listAll({
      status: req.query.status,
      coachId: req.query.coachId,
    });
    return res.status(200).json({ enrollments });
  } catch (error) {
    return next(error);
  }
}

async function cancel(req, res, next) {
  try {
    const enrollment = await privateClassEnrollmentService.cancel(req.params.id, req.user);
    return res.status(200).json({ enrollment });
  } catch (error) {
    return next(error);
  }
}

module.exports = { create, listMine, listAll, cancel };
