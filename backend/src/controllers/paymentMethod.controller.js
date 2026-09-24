const paymentMethodService = require('../services/paymentMethod.service');

async function save(req, res, next) {
  try {
    const paymentMethod = await paymentMethodService.savePaymentMethod(req.body, req.user);
    return res.status(201).json({ paymentMethod });
  } catch (error) {
    return next(error);
  }
}

async function getMine(req, res, next) {
  try {
    const paymentMethod = await paymentMethodService.getMine(req.user._id);
    return res.status(200).json({ paymentMethod });
  } catch (error) {
    return next(error);
  }
}

module.exports = { save, getMine };
