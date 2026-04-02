const db = require('../config/db');

const createUser = async ({ id, username, email, passwordHash }) => {
  const q = `
    INSERT INTO users (id, username, email, password_hash)
    VALUES ($1, $2, $3, $4)
    RETURNING id, username, email, created_at
  `;
  const { rows } = await db.query(q, [id, username.toLowerCase(), email || null, passwordHash]);
  return rows[0];
};

const createProfile = async ({ userId, displayName }) => {
  const q = `INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)`;
  await db.query(q, [userId, displayName]);
};

const findByLogin = async (login) => {
  const q = `
    SELECT u.*, p.display_name, p.bio, p.avatar_url
    FROM users u
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE u.username = $1 OR u.email = $1
    LIMIT 1
  `;
  const { rows } = await db.query(q, [login.toLowerCase()]);
  return rows[0] || null;
};

const findById = async (id) => {
  const q = `
    SELECT u.id, u.username, u.email, u.created_at,
      p.display_name, p.bio, p.avatar_url, p.location, p.website
    FROM users u
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE u.id = $1
  `;
  const { rows } = await db.query(q, [id]);
  return rows[0] || null;
};

const findByUsername = async (username) => {
  const q = `
    SELECT u.id, u.username, u.created_at,
      p.display_name, p.bio, p.avatar_url, p.location, p.website
    FROM users u
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE u.username = $1
  `;
  const { rows } = await db.query(q, [username.toLowerCase()]);
  return rows[0] || null;
};

const updateProfile = async (userId, payload) => {
  const fields = [];
  const values = [];
  let i = 1;

  const mapping = {
    displayName: 'display_name',
    bio: 'bio',
    avatarUrl: 'avatar_url',
    location: 'location',
    website: 'website'
  };

  Object.entries(payload).forEach(([key, value]) => {
    if (mapping[key] !== undefined) {
      fields.push(`${mapping[key]} = $${i}`);
      values.push(value);
      i += 1;
    }
  });

  if (fields.length === 0) {
    return findById(userId);
  }

  values.push(userId);

  await db.query(`UPDATE profiles SET ${fields.join(', ')}, updated_at = NOW() WHERE user_id = $${i}`, values);
  return findById(userId);
};

const searchUsers = async (query, limit) => {
  const q = `
    SELECT u.id, u.username, p.display_name, p.avatar_url
    FROM users u
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE u.username ILIKE $1 OR p.display_name ILIKE $1
    ORDER BY u.username ASC
    LIMIT $2
  `;
  const { rows } = await db.query(q, [`%${query}%`, limit]);
  return rows;
};


const findWithPasswordById = async (id) => {
  const q = `SELECT * FROM users WHERE id = $1 LIMIT 1`;
  const { rows } = await db.query(q, [id]);
  return rows[0] || null;
};

const updatePassword = async ({ userId, passwordHash }) => {
  await db.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, userId]);
};

const deleteUser = async (userId) => {
  await db.query('DELETE FROM users WHERE id = $1', [userId]);
};

module.exports = {
  createUser,
  createProfile,
  findByLogin,
  findById,
  findByUsername,
  updateProfile,
  searchUsers,
  findWithPasswordById,
  updatePassword,
  deleteUser
};
