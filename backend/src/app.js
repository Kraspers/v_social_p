const fs = require('fs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const routes = require('./routes');
const errorMiddleware = require('./middleware/error.middleware');
const notFoundMiddleware = require('./middleware/not-found.middleware');

const app = express();
const indexPath = path.join(webRoot, 'index.html');
const hasFrontend = fs.existsSync(indexPath);

app.use(helmet());
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(morgan('dev'));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
if (hasFrontend) {
  app.use(express.static(webRoot));
  app.get('/', (_req, res) => res.sendFile(indexPath));
} else {
  app.get('/', (_req, res) => res.redirect(302, 'https://v-social-p.onrender.com'));
}
app.use('/api/v1', routes);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

module.exports = app;
