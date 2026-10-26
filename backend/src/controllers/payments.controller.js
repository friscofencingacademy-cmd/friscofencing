const paymentsConfigService = require('../services/paymentsConfig.service');

async function getConfig(req, res, next) {
  try {
    return res.status(200).json(paymentsConfigService.getPublicConfig());
  } catch (error) {
    return next(error);
  }
}

module.exports = { getConfig };
