const { z } = require('zod');

const registerSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_.-]+$/),
  password: z.string().min(8).max(100),
  displayName: z.string().min(1).max(80),
  email: z.string().email().optional()
});

const loginSchema = z.object({
  usernameOrEmail: z.string().min(1),
  password: z.string().min(1)
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1).optional()
});

module.exports = { registerSchema, loginSchema, refreshSchema };
