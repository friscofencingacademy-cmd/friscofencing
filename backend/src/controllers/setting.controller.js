const settingService = require('../services/setting.service');

async function get(req, res, next) {
  try {
    const settings = await settingService.getSettings();
    return res.status(200).json({ settings });
  } catch (error) {
    return next(error);
  }
}

async function update(req, res, next) {
  try {
    const settings = await settingService.updateSettings(req.body);
    return res.status(200).json({ settings });
  } catch (error) {
    return next(error);
  }
}

module.exports = { get, update };
