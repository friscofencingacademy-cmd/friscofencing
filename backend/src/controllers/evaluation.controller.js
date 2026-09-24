const evaluationService = require('../services/evaluation.service');

async function create(req, res, next) {
  try {
    const evaluation = await evaluationService.create(req.body, req.user);
    return res.status(201).json({ evaluation });
  } catch (error) {
    return next(error);
  }
}

async function getById(req, res, next) {
  try {
    const evaluation = await evaluationService.getById(req.params.id);
    return res.status(200).json({ evaluation });
  } catch (error) {
    return next(error);
  }
}

async function getByStudent(req, res, next) {
  try {
    const evaluations = await evaluationService.getByStudent(req.params.studentId);
    return res.status(200).json({ evaluations });
  } catch (error) {
    return next(error);
  }
}

async function update(req, res, next) {
  try {
    const evaluation = await evaluationService.update(req.params.id, req.body, req.user);
    return res.status(200).json({ evaluation });
  } catch (error) {
    return next(error);
  }
}

module.exports = { create, getById, getByStudent, update };
