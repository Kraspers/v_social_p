const { z } = require('zod');

const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  bio: z.string().max(300).optional().nullable(),
  avatarUrl: z.string().url().optional().nullable(),
  location: z.string().max(120).optional().nullable(),
  website: z.string().url().optional().nullable()
});

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(8).max(100)
});

module.exports = { updateProfileSchema, changePasswordSchema };
