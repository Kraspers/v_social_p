const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const ApiError = require('../utils/api-error');
const userModel = require('../models/user.model');
const sessionModel = require('../models/session.model');
const env = require('../config/env');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const buildAuthPayload = (user) => ({
  id: user.id,
  username: user.username,
  displayName: user.display_name,
  avatarUrl: user.avatar_url
});

const register = async ({ username, password, displayName, email, meta }) => {
  const exists = await userModel.findByLogin(username);
  if (exists) {
    throw new ApiError(409, 'USERNAME_EXISTS', 'Username already exists');
  }

  const passwordHash = await bcrypt.hash(password, env.bcryptRounds);
  const userId = crypto.randomUUID();
  const created = await userModel.createUser({ id: userId, username, email, passwordHash });
  await userModel.createProfile({ userId, displayName });

  const accessToken = signAccessToken({ sub: userId, username: created.username });
  const refreshToken = signRefreshToken({ sub: userId });
  const decoded = verifyRefreshToken(refreshToken);

  await sessionModel.createSession({
    id: crypto.randomUUID(),
    userId,
    tokenHash: hashToken(refreshToken),
    userAgent: meta.userAgent,
    ip: meta.ip,
    expiresAt: new Date(decoded.exp * 1000)
  });

  const user = await userModel.findById(userId);
  return { user: buildAuthPayload(user), accessToken, refreshToken };
};

const login = async ({ usernameOrEmail, password, meta }) => {
  const user = await userModel.findByLogin(usernameOrEmail);
  if (!user) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
  }

  const accessToken = signAccessToken({ sub: user.id, username: user.username });
  const refreshToken = signRefreshToken({ sub: user.id });
  const decoded = verifyRefreshToken(refreshToken);

  await sessionModel.createSession({
    id: crypto.randomUUID(),
    userId: user.id,
    tokenHash: hashToken(refreshToken),
    userAgent: meta.userAgent,
    ip: meta.ip,
    expiresAt: new Date(decoded.exp * 1000)
  });

  return { user: buildAuthPayload(user), accessToken, refreshToken };
};

const refresh = async ({ refreshToken }) => {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (_e) {
    throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token');
  }

  const tokenHash = hashToken(refreshToken);
  const session = await sessionModel.findSession({ userId: payload.sub, tokenHash });
  if (!session) {
    throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is revoked or expired');
  }

  await sessionModel.revokeSession({ userId: payload.sub, tokenHash });

  const nextRefresh = signRefreshToken({ sub: payload.sub });
  const nextAccess = signAccessToken({ sub: payload.sub, username: payload.username });
  const decoded = verifyRefreshToken(nextRefresh);

  await sessionModel.createSession({
    id: crypto.randomUUID(),
    userId: payload.sub,
    tokenHash: hashToken(nextRefresh),
    userAgent: null,
    ip: null,
    expiresAt: new Date(decoded.exp * 1000)
  });

  return { accessToken: nextAccess, refreshToken: nextRefresh };
};

const logout = async ({ userId, refreshToken }) => {
  if (!refreshToken) {
    return;
  }
  await sessionModel.revokeSession({ userId, tokenHash: hashToken(refreshToken) });
};

module.exports = { register, login, refresh, logout };
