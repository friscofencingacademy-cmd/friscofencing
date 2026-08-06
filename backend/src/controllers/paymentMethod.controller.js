const paymentMethodService = require('../services/paymentMethod.service');

async function save(req, res) {
  try {
    const paymentMethod = await paymentMethodService.savePaymentMethod(req.body, req.user);
    return res.status(201).json({ paymentMethod });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to save payment method' });
  }
}

async function getMine(req, res) {
  try {
    const paymentMethod = await paymentMethodService.getMine(req.user._id);
    return res.status(200).json({ paymentMethod });
  } catch (error) {
    const status = error.status || 500;
    return res
      .status(status)
      .json({ message: error.message || 'Failed to fetch payment method' });
  }
}

module.exports = { save, getMine };
