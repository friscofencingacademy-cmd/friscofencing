const kioskService = require('../services/kiosk.service');

async function state(req, res, next) {
  try {
    const result = await kioskService.getKioskState();
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function signIn(req, res, next) {
  try {
    const result = await kioskService.signIn(req.user, { studentId: req.body.studentId });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = { state, signIn };
