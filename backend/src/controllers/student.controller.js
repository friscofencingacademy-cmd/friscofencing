const studentService = require('../services/student.service');

async function create(req, res, next) {
  try {
    const student = await studentService.create(req.body, req.user);
    return res.status(201).json({ student });
  } catch (error) {
    return next(error);
  }
}

async function listMine(req, res, next) {
  try {
    const students = await studentService.listMine(req.user._id);
    return res.status(200).json({ students });
  } catch (error) {
    return next(error);
  }
}

module.exports = { create, listMine };
