const subscriptionService = require('../services/subscription.service');

async function cancel(req, res) {
  try {
    const subscription = await subscriptionService.cancel(req.params.id, req.user);
    return res.status(200).json({ subscription });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to cancel subscription' });
  }
}

module.exports = { cancel };
