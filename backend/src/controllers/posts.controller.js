const postsService = require('../services/posts.service');

const create = async (req, res, next) => {
  try {
    const data = await postsService.createPost(req.auth.sub, req.body);
    return res.status(201).json({ data });
  } catch (e) {
    return next(e);
  }
};

const getById = async (req, res, next) => {
  try {
    const data = await postsService.getPost(req.params.postId);
    return res.json({ data });
  } catch (e) {
    return next(e);
  }
};

const remove = async (req, res, next) => {
  try {
    await postsService.removePost({ postId: req.params.postId, userId: req.auth.sub });
    return res.status(204).send();
  } catch (e) {
    return next(e);
  }
};

const feed = async (req, res, next) => {
  try {
    const data = await postsService.feed({ userId: req.auth.sub, limit: Number(req.query.limit || 20) });
    return res.json({ data });
  } catch (e) {
    return next(e);
  }
};

module.exports = { create, getById, remove, feed };
