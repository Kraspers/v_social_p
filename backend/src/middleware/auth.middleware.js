const ApiError = require('../utils/api-error');
const { verifyAccessToken } = require('../utils/jwt');

module.exports = (req, _res, next) => {
  const header = req.headers.authorization || '';
  const [, token] = header.split(' ');

  if (!token) {
    return next(new ApiError(401, 'UNAUTHORIZED', 'Missing bearer token'));
  }

  try {
    req.auth = verifyAccessToken(token);
    return next();
  } catch (_e) {
    return next(new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired token'));
  }
};
