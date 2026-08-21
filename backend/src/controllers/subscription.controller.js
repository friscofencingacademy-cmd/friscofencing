const subscriptionService = require('../services/subscription.service');

async function list(req, res) {
  try {
    const { status, q, page, limit } = req.query;
    const result = await subscriptionService.listAll({ status, q, page, limit });
    return res.status(200).json(result);
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list subscriptions' });
  }
}

async function cancel(req, res) {
  try {
    const subscription = await subscriptionService.cancel(req.params.id, req.user);
    return res.status(200).json({ subscription });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to cancel subscription' });
  }
}

async function reactivate(req, res) {
  try {
    const subscription = await subscriptionService.reactivate(req.params.id, req.user);
    return res.status(200).json({ subscription });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to reactivate subscription' });
  }
}

async function changeSchedule(req, res) {
  try {
    const subscription = await subscriptionService.changeSchedule(req.params.id, req.body.newScheduleId);
    return res.status(200).json({ subscription });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to change schedule' });
  }
}

module.exports = { list, cancel, reactivate, changeSchedule };
