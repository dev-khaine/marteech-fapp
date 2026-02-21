// ============================================================
// Driver Routes: /drivers
// ============================================================

import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import { OrderRepository } from '../repositories/order.repository';
import { DriverService } from '../services/driver.service';
import { authMiddleware, requireRole, validateBody, validateQuery } from '../middleware';
import { UpdateLocationSchema, NearbyDriversSchema } from '../utils/schemas';
import { ok } from '../utils';

const drivers = new Hono<{ Bindings: Env; Variables: AppVariables }>();

drivers.use('*', authMiddleware);

/**
 * POST /drivers/location
 * Driver updates their current GPS location.
 * This hits the Durable Object for real-time tracking.
 */
drivers.post(
  '/location',
  requireRole('driver'),
  async (ctx) => {
    const { sub } = ctx.get('user');
    const input = await validateBody(ctx, UpdateLocationSchema);
    const repo = new OrderRepository(ctx.env.DB);
    const service = new DriverService(repo, ctx.env);
    await service.updateLocation(sub, input.lat, input.lng);
    return ctx.json(ok({ updated: true }));
  }
);

/**
 * DELETE /drivers/location
 * Driver marks themselves as offline / removes from active pool.
 */
drivers.delete(
  '/location',
  requireRole('driver'),
  async (ctx) => {
    const { sub } = ctx.get('user');
    const repo = new OrderRepository(ctx.env.DB);
    const service = new DriverService(repo, ctx.env);
    await service.goOffline(sub);
    return ctx.json(ok({ offline: true }));
  }
);

/**
 * PATCH /drivers/availability
 * Driver toggles their availability without changing location.
 */
drivers.patch(
  '/availability',
  requireRole('driver'),
  async (ctx) => {
    const { sub } = ctx.get('user');
    const body = await ctx.req.json<{ available: boolean }>();
    const repo = new OrderRepository(ctx.env.DB);
    const service = new DriverService(repo, ctx.env);
    await service.setAvailability(sub, body.available);
    return ctx.json(ok({ available: body.available }));
  }
);

/**
 * GET /drivers/nearby
 * Merchant or admin queries for nearby available drivers.
 * Uses the Durable Object for real-time positions.
 */
drivers.get(
  '/nearby',
  requireRole('merchant', 'admin', 'customer'),
  async (ctx) => {
    const { lat, lng, radius_km } = validateQuery(ctx, NearbyDriversSchema);
    const repo = new OrderRepository(ctx.env.DB);
    const service = new DriverService(repo, ctx.env);
    const drivers = await service.getNearbyDrivers(lat, lng, radius_km);
    return ctx.json(ok({ drivers, count: drivers.length }));
  }
);

export { drivers as driverRoutes };
