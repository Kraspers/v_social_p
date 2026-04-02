const router = require('express').Router();
const controller = require('../controllers/users.controller');
const validate = require('../middleware/validate.middleware');
const auth = require('../middleware/auth.middleware');
const { updateProfileSchema } = require('../validators/users.validator');

router.get('/search', controller.search);
router.get('/:username', controller.getByUsername);
router.get('/:username/posts', controller.posts);
router.put('/me', auth, validate(updateProfileSchema), controller.updateMe);

module.exports = router;
