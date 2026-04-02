const db = require('../config/db');

const likePost = async ({ postId, userId }) => {
  const q = `
    INSERT INTO post_likes (post_id, user_id)
    VALUES ($1, $2)
    ON CONFLICT (post_id, user_id) DO NOTHING
  `;
  await db.query(q, [postId, userId]);
};

const unlikePost = async ({ postId, userId }) => {
  const q = `DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2`;
  await db.query(q, [postId, userId]);
};

module.exports = { likePost, unlikePost };
