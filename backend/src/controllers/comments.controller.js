const commentsService = require('../services/comments.service');

const create = async (req, res, next) => {
  try {
    const data = await commentsService.createComment({ postId: req.params.postId, userId: req.auth.sub, payload: req.body });
    return res.status(201).json({ data });
  } catch (e) {
    return next(e);
  }
};

const list = async (req, res, next) => {
  try {
    const data = await commentsService.listComments({ postId: req.params.postId, limit: Number(req.query.limit || 50) });
    return res.json({ data });
  } catch (e) {
    return next(e);
  }
};

const remove = async (req, res, next) => {
  try {
    await commentsService.removeComment({ commentId: req.params.commentId, userId: req.auth.sub });
    return res.status(204).send();
  } catch (e) {
    return next(e);
  }
};

module.exports = { create, list, remove };
