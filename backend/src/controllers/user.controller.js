const User = require('../models/user.model');

async function list(req, res) {
  try {
    const filter = {};

    if (req.query.role) {
      filter.role = req.query.role;
    }

    // toJSON transform on the model already strips passwordHash; find()
    // returns full Mongoose documents but res.json() serializes each one
    // through that transform, so the response is already safe.
    const users = await User.find(filter);
    return res.status(200).json({ users });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list users' });
  }
}

module.exports = { list };
