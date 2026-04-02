const usersService = require('../services/users.service');

const getByUsername = async (req, res, next) => {
  try {
    const data = await usersService.getUserByUsername(req.params.username);
    return res.json({ data });
  } catch (e) {
    return next(e);
  }
};

const updateMe = async (req, res, next) => {
  try {
    const data = await usersService.updateMe(req.auth.sub, req.body);
    return res.json({ data });
  } catch (e) {
    return next(e);
  }
};

const search = async (req, res, next) => {
  try {
    const data = await usersService.searchUsers(req.query.q || '', Number(req.query.limit || 20));
    return res.json({ data });
  } catch (e) {
    return next(e);
  }
};

const posts = async (req, res, next) => {
  try {
    const data = await usersService.userPosts(req.params.username, Number(req.query.limit || 20));
    return res.json({ data });
  } catch (e) {
    return next(e);
  }
};

module.exports = { getByUsername, updateMe, search, posts };
