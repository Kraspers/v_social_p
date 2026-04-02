const db = require('../config/db');

const follow = async ({ followerId, followingId }) => {
  const q = `
    INSERT INTO follows (follower_id, following_id)
    VALUES ($1, $2)
    ON CONFLICT (follower_id, following_id) DO NOTHING
  `;
  await db.query(q, [followerId, followingId]);
};

const unfollow = async ({ followerId, followingId }) => {
  await db.query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [followerId, followingId]);
};

const listFollowers = async (userId) => {
  const q = `
    SELECT u.id, u.username, p.display_name, p.avatar_url
    FROM follows f
    JOIN users u ON u.id = f.follower_id
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE f.following_id = $1
    ORDER BY f.created_at DESC
  `;
  const { rows } = await db.query(q, [userId]);
  return rows;
};

const listFollowing = async (userId) => {
  const q = `
    SELECT u.id, u.username, p.display_name, p.avatar_url
    FROM follows f
    JOIN users u ON u.id = f.following_id
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE f.follower_id = $1
    ORDER BY f.created_at DESC
  `;
  const { rows } = await db.query(q, [userId]);
  return rows;
};

const listFriends = async (userId) => {
  const q = `
    SELECT u.id, u.username, p.display_name, p.avatar_url
    FROM follows f1
    JOIN follows f2 ON f1.following_id = f2.follower_id AND f1.follower_id = f2.following_id
    JOIN users u ON u.id = f1.following_id
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE f1.follower_id = $1
  `;
  const { rows } = await db.query(q, [userId]);
  return rows;
};

module.exports = { follow, unfollow, listFollowers, listFollowing, listFriends };
