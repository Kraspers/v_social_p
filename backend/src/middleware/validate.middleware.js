const ApiError = require('../utils/api-error');

module.exports = (schema, target = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[target]);
  if (!result.success) {
    return next(
      new ApiError(422, 'VALIDATION_ERROR', 'Request validation failed', result.error.flatten())
    );
  }

  req[target] = result.data;
  return next();
};
