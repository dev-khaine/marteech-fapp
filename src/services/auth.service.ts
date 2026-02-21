// ============================================================
// Auth Service
// ============================================================

import { HTTPException } from 'hono/http-exception';
import type { UserRepository } from '../repositories/user.repository';
import type { PublicUser, Env } from '../types';
import { hashPassword, verifyPassword, signJWT, logger } from '../utils';
import type { RegisterInput, LoginInput } from '../utils/schemas';

export class AuthService {
  constructor(
    private userRepo: UserRepository,
    private env: Env
  ) {}

  async register(input: RegisterInput): Promise<{ user: PublicUser; token: string }> {
    // Check email uniqueness
    const existing = await this.userRepo.findByEmail(input.email);
    if (existing) {
      throw new HTTPException(409, { message: 'Email already registered' });
    }

    const password_hash = await hashPassword(input.password);

    const user = await this.userRepo.create({
      email: input.email,
      password_hash,
      role: input.role,
      name: input.name,
      phone: input.phone,
    });

    const token = await signJWT(
      { sub: user.id, email: user.email, role: user.role },
      this.env.JWT_SECRET
    );

    logger.info('User registered', { userId: user.id, role: user.role });

    return { user: toPublicUser(user), token };
  }

  async login(input: LoginInput): Promise<{ user: PublicUser; token: string }> {
    const user = await this.userRepo.findByEmail(input.email);

    if (!user) {
      // Avoid timing attacks by still running verifyPassword
      await hashPassword('dummy_timing_safe');
      throw new HTTPException(401, { message: 'Invalid email or password' });
    }

    const valid = await verifyPassword(input.password, user.password_hash);
    if (!valid) {
      throw new HTTPException(401, { message: 'Invalid email or password' });
    }

    const token = await signJWT(
      { sub: user.id, email: user.email, role: user.role },
      this.env.JWT_SECRET
    );

    logger.info('User logged in', { userId: user.id });

    return { user: toPublicUser(user), token };
  }
}

// ── Helpers ───────────────────────────────────────────────────

function toPublicUser(row: {
  id: string;
  email: string;
  role: string;
  name: string;
  phone: string | null;
  created_at: string;
}): PublicUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role as PublicUser['role'],
    name: row.name,
    phone: row.phone,
    created_at: row.created_at,
  };
}
