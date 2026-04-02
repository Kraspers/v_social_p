const { z } = require('zod');

const createCommentSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  parentCommentId: z.string().uuid().optional().nullable()
});

module.exports = { createCommentSchema };
