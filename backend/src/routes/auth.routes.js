const router = require('express').Router();
const controller = require('../controllers/auth.controller');
const validate = require('../middleware/validate.middleware');
const auth = require('../middleware/auth.middleware');
const { registerSchema, loginSchema, refreshSchema } = require('../validators/auth.validator');

router.post('/register', validate(registerSchema), controller.register);
router.post('/login', validate(loginSchema), controller.login);
router.post('/refresh', validate(refreshSchema), controller.refresh);
router.post('/logout', auth, controller.logout);
router.get('/me', auth, controller.me);

module.exports = router;
