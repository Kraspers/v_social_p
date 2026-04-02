const router = require('express').Router();
const controller = require('../controllers/comments.controller');
const auth = require('../middleware/auth.middleware');

router.delete('/:commentId', auth, controller.remove);

module.exports = router;
