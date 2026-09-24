const trialClassService = require('../services/trialClass.service');

async function create(req, res, next) {
  try {
    const trialClass = await trialClassService.create(req.body, req.user);
    return res.status(201).json({ trialClass });
  } catch (error) {
    return next(error);
  }
}

async function listMine(req, res, next) {
  try {
    const trialClasses = await trialClassService.listMine(req.user._id);
    return res.status(200).json({ trialClasses });
  } catch (error) {
    return next(error);
  }
}

module.exports = { create, listMine };
