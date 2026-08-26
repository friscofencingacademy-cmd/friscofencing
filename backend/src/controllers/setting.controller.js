const settingService = require('../services/setting.service');

async function get(req, res) {
  try {
    const settings = await settingService.getSettings();
    return res.status(200).json({ settings });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to fetch settings' });
  }
}

async function update(req, res) {
  try {
    const settings = await settingService.updateSettings(req.body);
    return res.status(200).json({ settings });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to update settings' });
  }
}

module.exports = { get, update };
