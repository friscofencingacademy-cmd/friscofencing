const privateClassEnrollmentService = require('../services/privateClassEnrollment.service');

async function quote(req, res, next) {
  try {
    const result = await privateClassEnrollmentService.quote(
      { studentId: req.query.studentId, scheduleId: req.query.scheduleId },
      req.user
    );
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

// Buy sessions and book the first one.
async function create(req, res, next) {
  try {
    const result = await privateClassEnrollmentService.purchaseAndBook(
      {
        studentId: req.body.studentId,
        scheduleId: req.body.scheduleId,
        day: req.body.day,
        quantity: req.body.quantity,
      },
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

module.exports = { quote, create, listMine, listAll };
