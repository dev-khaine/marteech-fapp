// ============================================================
// Middleware: Auth, Role Guard, Error Handler, Rate Limiter
// ============================================================

import { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, AppVariables, UserRole } from '../types';
import { verifyJWT, logger } from '../utils';

type HonoContext = Context<{ Bindings: Env; Variables: AppVariables }>;

// ── JWT Auth Middleware ─────────────────────────────────────

/**
 * Validates the Bearer token and injects the JWT payload into ctx.var.user
 */
export async function authMiddleware(ctx: HonoContext, next: Next) {
  const authHeader = ctx.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new HTTPException(401, { message: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7);
  const payload = await verifyJWT(token, ctx.env.JWT_SECRET);

  if (!payload) {
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }

  ctx.set('user', payload);
  await next();
}

// ── Role Guard Middleware ───────────────────────────────────

/**
 * Factory that returns a middleware requiring one of the specified roles
 */
export function requireRole(...roles: UserRole[]) {
  return async (ctx: HonoContext, next: Next) => {
    const user = ctx.get('user');
    if (!user) {
      throw new HTTPException(401, { message: 'Authentication required' });
    }
    if (!roles.includes(user.role)) {
      throw new HTTPException(403, {
        message: `Access denied. Required role: ${roles.join(' or ')}`,
      });
    }
    await next();
  };
}

// ── Rate Limiting Middleware ────────────────────────────────

interface RateLimitOptions {
  /** Max requests allowed in the window */
  limit: number;
  /** Window duration in seconds */
  windowSeconds: number;
  /** Key prefix for KV storage */
  keyPrefix?: string;
}

/**
 * Sliding window rate limiter backed by Cloudflare KV
 */
export function rateLimiter(opts: RateLimitOptions) {
  return async (ctx: HonoContext, next: Next) => {
    const { limit, windowSeconds, keyPrefix = 'rl' } = opts;

    // Use IP + route as key (CF Workers exposes cf.ip via request)
    const ip =
      ctx.req.header('CF-Connecting-IP') ||
      ctx.req.header('X-Forwarded-For') ||
      'unknown';
    const key = `${keyPrefix}:${ip}:${ctx.req.path}`;

    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;

    // Fetch current request log from KV
    const stored = await ctx.env.RATE_LIMIT.get(key);
    let timestamps: number[] = stored ? JSON.parse(stored) : [];

    // Filter out old timestamps
    timestamps = timestamps.filter((ts) => ts > windowStart);

    if (timestamps.length >= limit) {
      const resetAt = Math.ceil((timestamps[0] + windowSeconds * 1000) / 1000);
      ctx.header('X-RateLimit-Limit', limit.toString());
      ctx.header('X-RateLimit-Remaining', '0');
      ctx.header('X-RateLimit-Reset', resetAt.toString());
      throw new HTTPException(429, { message: 'Too many requests. Please try again later.' });
    }

    // Record current request
    timestamps.push(now);
    await ctx.env.RATE_LIMIT.put(key, JSON.stringify(timestamps), {
      expirationTtl: windowSeconds + 5,
    });

    ctx.header('X-RateLimit-Limit', limit.toString());
    ctx.header('X-RateLimit-Remaining', (limit - timestamps.length).toString());

    await next();
  };
}

// ── Request Validation Helper ───────────────────────────────

import { ZodSchema, ZodError } from 'zod';

/**
 * Parse and validate request JSON body against a Zod schema.
 * Throws 422 on validation failure.
 */
export async function validateBody<T>(
  ctx: HonoContext,
  schema: ZodSchema<T>
): Promise<T> {
  let body: unknown;
  try {
    body = await ctx.req.json();
  } catch {
    throw new HTTPException(400, { message: 'Invalid JSON body' });
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    const errors = formatZodErrors(result.error);
    const res = ctx.json({ success: false, error: 'Validation failed', details: errors }, 422);
    throw new HTTPException(422, { res });
  }

  return result.data;
}

/**
 * Parse and validate query string against a Zod schema.
 */
export function validateQuery<T>(ctx: HonoContext, schema: ZodSchema<T>): T {
  const query = Object.fromEntries(new URL(ctx.req.url).searchParams);
  const result = schema.safeParse(query);
  if (!result.success) {
    const errors = formatZodErrors(result.error);
    const res = ctx.json({ success: false, error: 'Invalid query parameters', details: errors }, 422);
    throw new HTTPException(422, { res });
  }
  return result.data;
}

function formatZodErrors(error: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || 'root';
    if (!out[path]) out[path] = [];
    out[path].push(issue.message);
  }
  return out;
}

// ── Global Error Handler ────────────────────────────────────

/**
 * Hono onError handler - formats all errors into ApiError shape
 */
export function errorHandler(err: Error, ctx: HonoContext) {
  if (err instanceof HTTPException) {
    // Already formatted
    if (err.res) return err.getResponse();

    logger.warn('HTTP Exception', { status: err.status, message: err.message });
    return ctx.json({ success: false, error: err.message }, err.status);
  }

  // Unexpected errors
  logger.error('Unhandled error', { message: err.message, stack: err.stack });
  return ctx.json({ success: false, error: 'Internal server error' }, 500);
}

// ── CORS Middleware ─────────────────────────────────────────

export async function corsMiddleware(ctx: HonoContext, next: Next) {
  const allowedOrigins = ['http://localhost:3000', 'https://yourdomain.com'];
  const origin = ctx.req.header('Origin') || '';

  const isAllowed = allowedOrigins.includes(origin) || ctx.env.ENVIRONMENT === 'development';
  const corsOrigin = isAllowed ? origin : allowedOrigins[0];

  ctx.header('Access-Control-Allow-Origin', corsOrigin);
  ctx.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  ctx.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  ctx.header('Access-Control-Max-Age', '86400');

  if (ctx.req.method === 'OPTIONS') {
    return ctx.body(null, 204);
  }

  await next();
}

// ── Request Logger Middleware ───────────────────────────────

export async function requestLogger(ctx: HonoContext, next: Next) {
  const start = Date.now();
  const method = ctx.req.method;
  const path = new URL(ctx.req.url).pathname;

  await next();

  const duration = Date.now() - start;
  const status = ctx.res.status;
  logger.info(`${method} ${path} ${status} ${duration}ms`);
}
