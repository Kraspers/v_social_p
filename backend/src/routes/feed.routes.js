const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const controller = require('../controllers/posts.controller');

router.get('/', auth, controller.feed);

module.exports = router;
