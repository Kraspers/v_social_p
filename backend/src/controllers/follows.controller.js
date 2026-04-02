const followsService = require('../services/follows.service');

const follow = async (req, res, next) => {
  try {
    await followsService.follow({ followerId: req.auth.sub, username: req.params.username });
    return res.status(201).json({ data: { ok: true } });
  } catch (e) {
    return next(e);
  }
};

const unfollow = async (req, res, next) => {
  try {
    await followsService.unfollow({ followerId: req.auth.sub, username: req.params.username });
    return res.status(204).send();
  } catch (e) {
    return next(e);
  }
};

const followers = async (req, res, next) => {
  try {
    const data = await followsService.followers(req.params.username);
    return res.json({ data });
  } catch (e) {
    return next(e);
  }
};

const following = async (req, res, next) => {
  try {
    const data = await followsService.following(req.params.username);
    return res.json({ data });
  } catch (e) {
    return next(e);
  }
};

const friends = async (req, res, next) => {
  try {
    const data = await followsService.friends(req.params.username);
    return res.json({ data });
  } catch (e) {
    return next(e);
  }
};

module.exports = { follow, unfollow, followers, following, friends };
