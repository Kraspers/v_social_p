const { z } = require('zod');

const createPostSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  mediaUrl: z.string().url().optional().nullable(),
  mediaType: z.enum(['none', 'image', 'video']).optional(),
  visibility: z.enum(['public', 'followers', 'private']).optional()
});

const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).optional()
});

module.exports = { createPostSchema, paginationSchema };
