const authService = require('../services/auth.service');
const usersService = require('../services/users.service');

const register = async (req, res, next) => {
  try {
    const data = await authService.register({
      ...req.body,
      meta: { userAgent: req.headers['user-agent'], ip: req.ip }
    });
    return res.status(201).json({ data });
  } catch (e) {
    return next(e);
  }
};

const login = async (req, res, next) => {
  try {
    const data = await authService.login({
      ...req.body,
      meta: { userAgent: req.headers['user-agent'], ip: req.ip }
    });
    return res.json({ data });
  } catch (e) {
    return next(e);
  }
};

const refresh = async (req, res, next) => {
  try {
    const refreshToken = req.body.refreshToken || req.cookies.refreshToken;
    const data = await authService.refresh({ refreshToken });
    return res.json({ data });
  } catch (e) {
    return next(e);
  }
};

const logout = async (req, res, next) => {
  try {
    await authService.logout({ userId: req.auth.sub, refreshToken: req.body.refreshToken });
    return res.status(204).send();
  } catch (e) {
    return next(e);
  }
};

const me = async (req, res, next) => {
  try {
    const data = await usersService.getMe(req.auth.sub);
    return res.json({ data });
  } catch (e) {
    return next(e);
  }
};

module.exports = { register, login, refresh, logout, me };
