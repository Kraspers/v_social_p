const db = require('../config/db');

const createSession = async ({ id, userId, tokenHash, userAgent, ip, expiresAt }) => {
  const q = `
    INSERT INTO sessions (id, user_id, refresh_token_hash, user_agent, ip, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6)
  `;
  await db.query(q, [id, userId, tokenHash, userAgent || null, ip || null, expiresAt]);
};

const findSession = async ({ userId, tokenHash }) => {
  const q = `
    SELECT * FROM sessions
    WHERE user_id = $1 AND refresh_token_hash = $2 AND revoked_at IS NULL
      AND expires_at > NOW()
    LIMIT 1
  `;
  const { rows } = await db.query(q, [userId, tokenHash]);
  return rows[0] || null;
};

const revokeSession = async ({ userId, tokenHash }) => {
  const q = `UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND refresh_token_hash = $2`;
  await db.query(q, [userId, tokenHash]);
};

module.exports = { createSession, findSession, revokeSession };
