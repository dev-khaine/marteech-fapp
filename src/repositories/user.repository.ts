// ============================================================
// User Repository - D1 Database Access Layer
// ============================================================

import type { UserRow, AddressRow, Env } from '../types';
import { generateId } from '../utils';

export class UserRepository {
  constructor(private db: D1Database) {}

  async findById(id: string): Promise<UserRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(id)
      .first<UserRow>();
    return result ?? null;
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM users WHERE email = ?')
      .bind(email)
      .first<UserRow>();
    return result ?? null;
  }

  async create(input: {
    email: string;
    password_hash: string;
    role: string;
    name: string;
    phone?: string;
  }): Promise<UserRow> {
    const id = generateId();
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT INTO users (id, email, password_hash, role, name, phone, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, input.email, input.password_hash, input.role, input.name, input.phone ?? null, now)
      .run();

    return (await this.findById(id))!;
  }

  async update(
    id: string,
    input: Partial<Pick<UserRow, 'name' | 'phone'>>
  ): Promise<UserRow | null> {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      fields.push('name = ?');
      values.push(input.name);
    }
    if (input.phone !== undefined) {
      fields.push('phone = ?');
      values.push(input.phone);
    }

    if (fields.length === 0) return this.findById(id);

    values.push(id);
    await this.db
      .prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    return this.findById(id);
  }

  // ── Addresses ─────────────────────────────────────────────

  async findAddresses(userId: string): Promise<AddressRow[]> {
    const result = await this.db
      .prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY created_at DESC')
      .bind(userId)
      .all<AddressRow>();
    return result.results;
  }

  async createAddress(
    userId: string,
    input: {
      label: string;
      street: string;
      city: string;
      country: string;
      lat: number;
      lng: number;
    }
  ): Promise<AddressRow> {
    const id = generateId();
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT INTO addresses (id, user_id, label, street, city, country, lat, lng, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, userId, input.label, input.street, input.city, input.country, input.lat, input.lng, now)
      .run();

    const row = await this.db
      .prepare('SELECT * FROM addresses WHERE id = ?')
      .bind(id)
      .first<AddressRow>();

    return row!;
  }

  async deleteAddress(id: string, userId: string): Promise<boolean> {
    const result = await this.db
      .prepare('DELETE FROM addresses WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .run();
    return result.meta.changes > 0;
  }
}
