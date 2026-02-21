// ============================================================
// Order Routes: /orders
// ============================================================

import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import { OrderRepository } from '../repositories/order.repository';
import { OrderService } from '../services/order.service';
import { authMiddleware, requireRole, validateBody, validateQuery } from '../middleware';
import { CreateOrderSchema, UpdateOrderStatusSchema, PaginationSchema } from '../utils/schemas';
import { ok } from '../utils';

const orders = new Hono<{ Bindings: Env; Variables: AppVariables }>();

orders.use('*', authMiddleware);

/**
 * POST /orders
 * Customer creates a new order.
 */
orders.post(
  '/',
  requireRole('customer', 'admin'),
  async (ctx) => {
    const user = ctx.get('user');
    const input = await validateBody(ctx, CreateOrderSchema);
    const repo = new OrderRepository(ctx.env.DB);
    const service = new OrderService(repo, ctx.env);
    const order = await service.createOrder(user.sub, input);
    return ctx.json(ok(order), 201);
  }
);

/**
 * GET /orders/my
 * Returns orders belonging to the authenticated user (customer or driver).
 * Must be defined BEFORE /orders/:id to avoid route conflicts.
 */
orders.get('/my', async (ctx) => {
  const user = ctx.get('user');
  const { page, limit } = validateQuery(ctx, PaginationSchema);
  const repo = new OrderRepository(ctx.env.DB);
  const service = new OrderService(repo, ctx.env);
  const result = await service.getMyOrders(user.sub, user.role, page, limit);

  return ctx.json(
    ok({
      ...result,
      page,
      limit,
      has_more: result.total > page * limit,
    })
  );
});

/**
 * GET /orders/:id
 * Retrieve a specific order (restricted to parties involved or admin).
 */
orders.get('/:id', async (ctx) => {
  const user = ctx.get('user');
  const orderId = ctx.req.param('id');
  const repo = new OrderRepository(ctx.env.DB);
  const service = new OrderService(repo, ctx.env);
  const order = await service.getOrder(orderId, user.sub, user.role);
  return ctx.json(ok(order));
});

/**
 * PATCH /orders/:id/status
 * Update the status of an order.
 * Allowed transitions depend on the actor's role.
 */
orders.patch('/:id/status', async (ctx) => {
  const user = ctx.get('user');
  const orderId = ctx.req.param('id');
  const input = await validateBody(ctx, UpdateOrderStatusSchema);
  const repo = new OrderRepository(ctx.env.DB);
  const service = new OrderService(repo, ctx.env);
  const order = await service.updateOrderStatus(orderId, input, user.sub, user.role);
  return ctx.json(ok(order));
});

/**
 * POST /orders/:id/dispatch (admin only)
 * Manually trigger driver matching for an order.
 */
orders.post(
  '/:id/dispatch',
  requireRole('admin'),
  async (ctx) => {
    const orderId = ctx.req.param('id');
    const repo = new OrderRepository(ctx.env.DB);
    const service = new OrderService(repo, ctx.env);
    const result = await service.triggerDispatch(orderId);
    return ctx.json(ok(result));
  }
);

export { orders as orderRoutes };
