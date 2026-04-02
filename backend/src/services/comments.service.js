const crypto = require('crypto');
const commentModel = require('../models/comment.model');

const createComment = async ({ postId, userId, payload }) => commentModel.createComment({
  id: crypto.randomUUID(),
  postId,
  authorId: userId,
  text: payload.text,
  parentCommentId: payload.parentCommentId
});

const listComments = async ({ postId, limit = 50 }) => commentModel.listCommentsByPost({ postId, limit });

const removeComment = async ({ commentId, userId }) => commentModel.deleteComment({ commentId, userId });

module.exports = { createComment, listComments, removeComment };
