const trialClassService = require('../services/trialClass.service');

async function create(req, res) {
  try {
    const trialClass = await trialClassService.create(req.body, req.user);
    return res.status(201).json({ trialClass });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to book trial class' });
  }
}

async function listMine(req, res) {
  try {
    const trialClasses = await trialClassService.listMine(req.user._id);
    return res.status(200).json({ trialClasses });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list trial classes' });
  }
}

module.exports = { create, listMine };
