const bcrypt = require('bcryptjs');
const ApiError = require('../utils/api-error');
const userModel = require('../models/user.model');
const postModel = require('../models/post.model');
const env = require('../config/env');

const getMe = async (userId) => {
  const user = await userModel.findById(userId);
  if (!user) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  }
  return user;
};

const getUserByUsername = async (username) => {
  const user = await userModel.findByUsername(username);
  if (!user) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  }
  return user;
};

const updateMe = async (userId, payload) => userModel.updateProfile(userId, payload);

const searchUsers = async (q, limit = 20) => userModel.searchUsers(q || '', limit);

const userPosts = async (username, limit = 20) => {
  const user = await getUserByUsername(username);
  return postModel.listUserPosts({ userId: user.id, limit });
};

const changePassword = async ({ userId, oldPassword, newPassword }) => {
  const user = await userModel.findWithPasswordById(userId);
  if (!user) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  }
  const ok = await bcrypt.compare(oldPassword, user.password_hash);
  if (!ok) {
    throw new ApiError(400, 'INVALID_OLD_PASSWORD', 'Invalid old password');
  }
  const passwordHash = await bcrypt.hash(newPassword, env.bcryptRounds);
  await userModel.updatePassword({ userId, passwordHash });
};

const deleteMe = async (userId) => {
  await userModel.deleteUser(userId);
};

module.exports = { getMe, getUserByUsername, updateMe, searchUsers, userPosts, changePassword, deleteMe };
