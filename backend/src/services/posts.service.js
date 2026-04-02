const crypto = require('crypto');
const ApiError = require('../utils/api-error');
const postModel = require('../models/post.model');

const createPost = async (userId, payload) => postModel.createPost({
  id: crypto.randomUUID(),
  authorId: userId,
  ...payload
});

const getPost = async (postId) => {
  const post = await postModel.getPostById(postId);
  if (!post) {
    throw new ApiError(404, 'POST_NOT_FOUND', 'Post not found');
  }
  return post;
};

const removePost = async ({ postId, userId }) => {
  const deleted = await postModel.deletePost({ postId, userId });
  if (!deleted) {
    throw new ApiError(404, 'POST_NOT_FOUND_OR_FORBIDDEN', 'Post not found or not yours');
  }
};

const feed = async ({ userId, limit = 20 }) => postModel.getFeed({ userId, limit });

module.exports = { createPost, getPost, removePost, feed };
