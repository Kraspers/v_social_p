const router = require('express').Router();
const controller = require('../controllers/posts.controller');
const commentsController = require('../controllers/comments.controller');
const likesController = require('../controllers/likes.controller');
const validate = require('../middleware/validate.middleware');
const auth = require('../middleware/auth.middleware');
const { createPostSchema } = require('../validators/posts.validator');
const { createCommentSchema } = require('../validators/comments.validator');

router.post('/', auth, validate(createPostSchema), controller.create);
router.get('/:postId', controller.getById);
router.delete('/:postId', auth, controller.remove);

router.get('/:postId/comments', commentsController.list);
router.post('/:postId/comments', auth, validate(createCommentSchema), commentsController.create);

router.post('/:postId/likes', auth, likesController.like);
router.delete('/:postId/likes', auth, likesController.unlike);

module.exports = router;
