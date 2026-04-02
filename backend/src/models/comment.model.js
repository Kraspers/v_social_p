const db = require('../config/db');

const createComment = async ({ id, postId, authorId, text, parentCommentId }) => {
  const q = `
    INSERT INTO comments (id, post_id, author_id, text, parent_comment_id)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `;
  const { rows } = await db.query(q, [id, postId, authorId, text, parentCommentId || null]);
  return rows[0];
};

const listCommentsByPost = async ({ postId, limit }) => {
  const q = `
    SELECT c.*, u.username, p.display_name, p.avatar_url
    FROM comments c
    JOIN users u ON u.id = c.author_id
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE c.post_id = $1 AND c.is_deleted = false
    ORDER BY c.created_at ASC
    LIMIT $2
  `;
  const { rows } = await db.query(q, [postId, limit]);
  return rows;
};

const deleteComment = async ({ commentId, userId }) => {
  const q = `
    UPDATE comments
    SET is_deleted = true, updated_at = NOW()
    WHERE id = $1 AND author_id = $2 AND is_deleted = false
    RETURNING id
  `;
  const { rows } = await db.query(q, [commentId, userId]);
  return rows[0] || null;
};

module.exports = { createComment, listCommentsByPost, deleteComment };
