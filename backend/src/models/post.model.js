const db = require('../config/db');

const createPost = async ({ id, authorId, text, mediaUrl, mediaType, visibility }) => {
  const q = `
    INSERT INTO posts (id, author_id, text, media_url, media_type, visibility)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `;
  const { rows } = await db.query(q, [id, authorId, text, mediaUrl || null, mediaType || 'none', visibility || 'public']);
  return rows[0];
};

const getPostById = async (id) => {
  const q = `
    SELECT p.*, u.username, pr.display_name, pr.avatar_url,
      (SELECT COUNT(*)::int FROM post_likes pl WHERE pl.post_id = p.id) AS likes_count,
      (SELECT COUNT(*)::int FROM comments c WHERE c.post_id = p.id AND c.is_deleted = false) AS comments_count
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN profiles pr ON pr.user_id = u.id
    WHERE p.id = $1 AND p.is_deleted = false
  `;
  const { rows } = await db.query(q, [id]);
  return rows[0] || null;
};

const deletePost = async ({ postId, userId }) => {
  const q = `
    UPDATE posts
    SET is_deleted = true, updated_at = NOW()
    WHERE id = $1 AND author_id = $2 AND is_deleted = false
    RETURNING id
  `;
  const { rows } = await db.query(q, [postId, userId]);
  return rows[0] || null;
};

const listUserPosts = async ({ userId, limit }) => {
  const q = `
    SELECT * FROM posts
    WHERE author_id = $1 AND is_deleted = false
    ORDER BY created_at DESC
    LIMIT $2
  `;
  const { rows } = await db.query(q, [userId, limit]);
  return rows;
};

const getFeed = async ({ userId, limit }) => {
  const q = `
    SELECT p.*, u.username, pr.display_name, pr.avatar_url,
      (SELECT COUNT(*)::int FROM post_likes pl WHERE pl.post_id = p.id) AS likes_count,
      (SELECT COUNT(*)::int FROM comments c WHERE c.post_id = p.id AND c.is_deleted = false) AS comments_count
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN profiles pr ON pr.user_id = u.id
    WHERE p.is_deleted = false
      AND (
        p.author_id = $1
        OR p.author_id IN (SELECT following_id FROM follows WHERE follower_id = $1)
      )
    ORDER BY p.created_at DESC
    LIMIT $2
  `;
  const { rows } = await db.query(q, [userId, limit]);
  return rows;
};

module.exports = {
  createPost,
  getPostById,
  deletePost,
  listUserPosts,
  getFeed
};
