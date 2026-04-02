const router = require('express').Router();
const controller = require('../controllers/users.controller');
const validate = require('../middleware/validate.middleware');
const auth = require('../middleware/auth.middleware');
const { updateProfileSchema, changePasswordSchema } = require('../validators/users.validator');

router.get('/search', controller.search);
router.get('/:username', controller.getByUsername);
router.get('/:username/posts', controller.posts);
router.put('/me', auth, validate(updateProfileSchema), controller.updateMe);
router.put('/me/password', auth, validate(changePasswordSchema), controller.changePassword);
router.delete('/me', auth, controller.deleteMe);

module.exports = router;
