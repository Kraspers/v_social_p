const likeModel = require('../models/like.model');

const likePost = async ({ postId, userId }) => likeModel.likePost({ postId, userId });
const unlikePost = async ({ postId, userId }) => likeModel.unlikePost({ postId, userId });

module.exports = { likePost, unlikePost };
