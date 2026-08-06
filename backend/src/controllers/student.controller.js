const studentService = require('../services/student.service');

async function create(req, res) {
  try {
    const student = await studentService.create(req.body, req.user);
    return res.status(201).json({ student });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to create student' });
  }
}

async function listMine(req, res) {
  try {
    const students = await studentService.listMine(req.user._id);
    return res.status(200).json({ students });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list students' });
  }
}

module.exports = { create, listMine };
