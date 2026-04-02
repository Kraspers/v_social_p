const ApiError = require('../utils/api-error');
const followModel = require('../models/follow.model');
const userModel = require('../models/user.model');

const follow = async ({ followerId, username }) => {
  const target = await userModel.findByUsername(username);
  if (!target) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  }
  if (target.id === followerId) {
    throw new ApiError(400, 'INVALID_TARGET', 'Cannot follow yourself');
  }
  await followModel.follow({ followerId, followingId: target.id });
};

const unfollow = async ({ followerId, username }) => {
  const target = await userModel.findByUsername(username);
  if (!target) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  }
  await followModel.unfollow({ followerId, followingId: target.id });
};

const followers = async (username) => {
  const target = await userModel.findByUsername(username);
  if (!target) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  }
  return followModel.listFollowers(target.id);
};

const following = async (username) => {
  const target = await userModel.findByUsername(username);
  if (!target) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  }
  return followModel.listFollowing(target.id);
};

const friends = async (username) => {
  const target = await userModel.findByUsername(username);
  if (!target) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  }
  return followModel.listFriends(target.id);
};

module.exports = { follow, unfollow, followers, following, friends };
