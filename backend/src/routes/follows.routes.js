const router = require('express').Router();
const controller = require('../controllers/follows.controller');
const auth = require('../middleware/auth.middleware');

router.post('/:username/follow', auth, controller.follow);
router.delete('/:username/follow', auth, controller.unfollow);
router.get('/:username/followers', controller.followers);
router.get('/:username/following', controller.following);
router.get('/:username/friends', controller.friends);

module.exports = router;
