const likesService = require('../services/likes.service');

const like = async (req, res, next) => {
  try {
    await likesService.likePost({ postId: req.params.postId, userId: req.auth.sub });
    return res.status(201).json({ data: { ok: true } });
  } catch (e) {
    return next(e);
  }
};

const unlike = async (req, res, next) => {
  try {
    await likesService.unlikePost({ postId: req.params.postId, userId: req.auth.sub });
    return res.status(204).send();
  } catch (e) {
    return next(e);
  }
};

module.exports = { like, unlike };
