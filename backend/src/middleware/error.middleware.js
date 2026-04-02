module.exports = (err, _req, res, _next) => {
  const status = err.status || 500;
  const payload = {
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'Internal server error',
      details: err.details || null
    }
  };
  if (status >= 500) {
    console.error(err);
  }
  res.status(status).json(payload);
};
