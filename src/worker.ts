// ============================================================
// Cloudflare Worker Entry Point
// ============================================================

import { Hono } from 'hono';
import type { Env, AppVariables } from './types';

// Routes
import { authRoutes } from './routes/auth.routes';
import { userRoutes } from './routes/user.routes';
import { orderRoutes } from './routes/order.routes';
import { driverRoutes } from './routes/driver.routes';

// Middleware
import { corsMiddleware, errorHandler, requestLogger } from './middleware';

// Re-export Durable Object so Cloudflare runtime can find it
export { DriverTracker } from './durable-objects/DriverTracker';

// ── App Bootstrap ─────────────────────────────────────────────

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// ── Global Middleware ─────────────────────────────────────────

app.use('*', corsMiddleware);
app.use('*', requestLogger);

// ── Health Check ──────────────────────────────────────────────

app.get('/', (ctx) =>
  ctx.json({
    service: 'Delivery API',
    version: '1.0.0',
    status: 'ok',
    timestamp: new Date().toISOString(),
  })
);

app.get('/health', async (ctx) => {
  // Quick D1 connectivity check
  try {
    await ctx.env.DB.prepare('SELECT 1').first();
    return ctx.json({ status: 'healthy', db: 'ok' });
  } catch {
    return ctx.json({ status: 'degraded', db: 'error' }, 503);
  }
});

// ── API Routes ────────────────────────────────────────────────

const api = new Hono<{ Bindings: Env; Variables: AppVariables }>();

api.route('/auth', authRoutes);
api.route('/users', userRoutes);
api.route('/orders', orderRoutes);
api.route('/drivers', driverRoutes);

app.route('/api/v1', api);

// ── 404 Fallback ──────────────────────────────────────────────

app.notFound((ctx) =>
  ctx.json({ success: false, error: `Route ${ctx.req.path} not found` }, 404)
);

// ── Error Handler ─────────────────────────────────────────────

app.onError(errorHandler);

// ── Export default fetch handler ──────────────────────────────

export default app;
