const router = require('express').Router();

router.use('/auth', require('./auth.routes'));
router.use('/users', require('./users.routes'));
router.use('/posts', require('./posts.routes'));
router.use('/comments', require('./comments.routes'));
router.use('/users', require('./follows.routes'));
router.use('/feed', require('./feed.routes'));

module.exports = router;
