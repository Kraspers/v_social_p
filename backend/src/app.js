const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const routes = require('./routes');
const errorMiddleware = require('./middleware/error.middleware');
const notFoundMiddleware = require('./middleware/not-found.middleware');

const app = express();
app.use(helmet());
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(morgan('dev'));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/', (_req, res) => res.redirect(302, 'https://v-social-p.onrender.com'));
app.use('/api/v1', routes);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

module.exports = app;
