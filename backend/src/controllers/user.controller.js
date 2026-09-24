const userService = require('../services/user.service');

async function list(req, res, next) {
  try {
    const filter = {};

    if (req.query.role) {
      filter.role = req.query.role;
    }

    // toJSON transform on the model already strips passwordHash; find()
    // returns full Mongoose documents but res.json() serializes each one
    // through that transform, so the response is already safe.
    const users = await userService.list(filter, req.user.role);
    return res.status(200).json({ users });
  } catch (error) {
    return next(error);
  }
}

async function create(req, res, next) {
  try {
    const user = await userService.create(req.body, req.user.role);
    return res.status(201).json({ user });
  } catch (error) {
    return next(error);
  }
}

async function update(req, res, next) {
  try {
    const user = await userService.update(req.params.id, req.body, req.user.role);
    return res.status(200).json({ user });
  } catch (error) {
    return next(error);
  }
}

async function updatePassword(req, res, next) {
  try {
    const result = await userService.updatePassword(req.params.id, req.body.password, req.user.role);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function remove(req, res, next) {
  try {
    await userService.remove(req.params.id, req.user.role, req.user._id);
    return res.status(200).json({ success: true });
  } catch (error) {
    return next(error);
  }
}

module.exports = { list, create, update, updatePassword, remove };
