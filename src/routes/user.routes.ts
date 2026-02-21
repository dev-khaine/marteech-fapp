// ============================================================
// User Routes: /users/me, /users/me/addresses
// ============================================================

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, AppVariables } from '../types';
import { UserRepository } from '../repositories/user.repository';
import { authMiddleware, validateBody } from '../middleware';
import { UpdateUserSchema, AddressSchema } from '../utils/schemas';
import { ok } from '../utils';

const users = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// All /users routes require authentication
users.use('*', authMiddleware);

/**
 * GET /users/me
 * Returns the authenticated user's profile.
 */
users.get('/me', async (ctx) => {
  const { sub } = ctx.get('user');
  const repo = new UserRepository(ctx.env.DB);
  const user = await repo.findById(sub);
  if (!user) throw new HTTPException(404, { message: 'User not found' });

  // Strip password hash before returning
  const { password_hash: _, ...publicUser } = user;
  return ctx.json(ok(publicUser));
});

/**
 * PATCH /users/me
 * Updates name and/or phone for the authenticated user.
 */
users.patch('/me', async (ctx) => {
  const { sub } = ctx.get('user');
  const input = await validateBody(ctx, UpdateUserSchema);

  const repo = new UserRepository(ctx.env.DB);
  const updated = await repo.update(sub, input);
  if (!updated) throw new HTTPException(404, { message: 'User not found' });

  const { password_hash: _, ...publicUser } = updated;
  return ctx.json(ok(publicUser));
});

/**
 * GET /users/me/addresses
 * Returns all saved addresses for the authenticated user.
 */
users.get('/me/addresses', async (ctx) => {
  const { sub } = ctx.get('user');
  const repo = new UserRepository(ctx.env.DB);
  const addresses = await repo.findAddresses(sub);
  return ctx.json(ok(addresses));
});

/**
 * POST /users/me/addresses
 * Adds a new address for the authenticated user.
 */
users.post('/me/addresses', async (ctx) => {
  const { sub } = ctx.get('user');
  const input = await validateBody(ctx, AddressSchema);
  const repo = new UserRepository(ctx.env.DB);
  const address = await repo.createAddress(sub, input);
  return ctx.json(ok(address), 201);
});

/**
 * DELETE /users/me/addresses/:id
 * Deletes one of the authenticated user's addresses.
 */
users.delete('/me/addresses/:id', async (ctx) => {
  const { sub } = ctx.get('user');
  const addressId = ctx.req.param('id');
  const repo = new UserRepository(ctx.env.DB);
  const deleted = await repo.deleteAddress(addressId, sub);
  if (!deleted) throw new HTTPException(404, { message: 'Address not found' });
  return ctx.json(ok({ deleted: true }));
});

export { users as userRoutes };
