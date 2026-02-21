// ============================================================
// Auth Routes: /auth/register, /auth/login
// ============================================================

import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import { AuthService } from '../services/auth.service';
import { UserRepository } from '../repositories/user.repository';
import { validateBody, rateLimiter } from '../middleware';
import { RegisterSchema, LoginSchema } from '../utils/schemas';
import { ok } from '../utils';

const auth = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Strict rate limit on auth endpoints (prevent brute force)
const authRateLimit = rateLimiter({ limit: 10, windowSeconds: 60, keyPrefix: 'auth' });

/**
 * POST /auth/register
 * Creates a new user account and returns a JWT.
 */
auth.post('/register', authRateLimit, async (ctx) => {
  const input = await validateBody(ctx, RegisterSchema);
  const userRepo = new UserRepository(ctx.env.DB);
  const service = new AuthService(userRepo, ctx.env);
  const result = await service.register(input);
  return ctx.json(ok(result), 201);
});

/**
 * POST /auth/login
 * Authenticates credentials and returns a JWT.
 */
auth.post('/login', authRateLimit, async (ctx) => {
  const input = await validateBody(ctx, LoginSchema);
  const userRepo = new UserRepository(ctx.env.DB);
  const service = new AuthService(userRepo, ctx.env);
  const result = await service.login(input);
  return ctx.json(ok(result));
});

export { auth as authRoutes };
