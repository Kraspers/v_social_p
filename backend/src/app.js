const expressLib = require('express');
const routes = require('./routes');
const errorMiddleware = require('./middleware/error.middleware');
const notFoundMiddleware = require('./middleware/not-found.middleware');

const app = expressLib();
app.use(require('helmet')());
app.use(require('cors')({ origin: env.corsOrigin, credentials: true }));
app.use(expressLib.json({ limit: '2mb' }));
app.use(require('cookie-parser')());
app.use(require('morgan')('dev'));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/v1', routes);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

module.exports = app;
