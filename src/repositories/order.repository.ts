// ============================================================
// Order Repository - D1 Database Access Layer
// ============================================================

import type { OrderRow, OrderItemRow, OrderStatus } from '../types';
import { generateId } from '../utils';

export class OrderRepository {
  constructor(private db: D1Database) {}

  async findById(id: string): Promise<OrderRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM orders WHERE id = ?')
      .bind(id)
      .first<OrderRow>();
    return result ?? null;
  }

  async findByCustomer(
    customerId: string,
    page: number,
    limit: number
  ): Promise<{ items: OrderRow[]; total: number }> {
    const offset = (page - 1) * limit;

    const [rows, count] = await Promise.all([
      this.db
        .prepare(
          'SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
        )
        .bind(customerId, limit, offset)
        .all<OrderRow>(),
      this.db
        .prepare('SELECT COUNT(*) as cnt FROM orders WHERE customer_id = ?')
        .bind(customerId)
        .first<{ cnt: number }>(),
    ]);

    return { items: rows.results, total: count?.cnt ?? 0 };
  }

  async findByDriver(
    driverId: string,
    page: number,
    limit: number
  ): Promise<{ items: OrderRow[]; total: number }> {
    const offset = (page - 1) * limit;

    const [rows, count] = await Promise.all([
      this.db
        .prepare(
          'SELECT * FROM orders WHERE driver_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
        )
        .bind(driverId, limit, offset)
        .all<OrderRow>(),
      this.db
        .prepare('SELECT COUNT(*) as cnt FROM orders WHERE driver_id = ?')
        .bind(driverId)
        .first<{ cnt: number }>(),
    ]);

    return { items: rows.results, total: count?.cnt ?? 0 };
  }

  async create(input: {
    customer_id: string;
    merchant_id: string;
    total_price: number;
    pickup_lat: number;
    pickup_lng: number;
    dropoff_lat: number;
    dropoff_lng: number;
    notes?: string;
    items: Array<{ name: string; quantity: number; unit_price: number }>;
  }): Promise<OrderRow> {
    const orderId = generateId();
    const now = new Date().toISOString();

    // Insert order and items in a batch (atomic-ish for D1)
    const itemInserts = input.items.map((item) =>
      this.db
        .prepare(
          'INSERT INTO order_items (id, order_id, name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)'
        )
        .bind(generateId(), orderId, item.name, item.quantity, item.unit_price)
    );

    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO orders
             (id, customer_id, merchant_id, driver_id, status, total_price,
              pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, notes, created_at, updated_at)
           VALUES (?, ?, ?, NULL, 'created', ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          orderId,
          input.customer_id,
          input.merchant_id,
          input.total_price,
          input.pickup_lat,
          input.pickup_lng,
          input.dropoff_lat,
          input.dropoff_lng,
          input.notes ?? null,
          now,
          now
        ),
      ...itemInserts,
    ]);

    return (await this.findById(orderId))!;
  }

  async updateStatus(
    id: string,
    status: OrderStatus,
    driverId?: string
  ): Promise<OrderRow | null> {
    const now = new Date().toISOString();

    if (driverId !== undefined) {
      await this.db
        .prepare(
          'UPDATE orders SET status = ?, driver_id = ?, updated_at = ? WHERE id = ?'
        )
        .bind(status, driverId, now, id)
        .run();
    } else {
      await this.db
        .prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?')
        .bind(status, now, id)
        .run();
    }

    return this.findById(id);
  }

  async findItems(orderId: string): Promise<OrderItemRow[]> {
    const result = await this.db
      .prepare('SELECT * FROM order_items WHERE order_id = ?')
      .bind(orderId)
      .all<OrderItemRow>();
    return result.results;
  }

  /**
   * Find the best available driver for dispatch.
   * Returns drivers who are available and have no active order.
   */
  async findAvailableDrivers(): Promise<Array<{ driver_id: string; current_lat: number; current_lng: number }>> {
    const result = await this.db
      .prepare(
        `SELECT ds.driver_id, ds.current_lat, ds.current_lng
         FROM driver_status ds
         WHERE ds.is_available = 1
           AND ds.current_lat IS NOT NULL
           AND ds.current_lng IS NOT NULL
           AND ds.driver_id NOT IN (
             SELECT DISTINCT driver_id FROM orders
             WHERE status IN ('accepted', 'preparing', 'picked_up')
               AND driver_id IS NOT NULL
           )`
      )
      .all<{ driver_id: string; current_lat: number; current_lng: number }>();

    return result.results;
  }

  async upsertDriverStatus(
    driverId: string,
    isAvailable: boolean,
    lat?: number,
    lng?: number
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO driver_status (driver_id, is_available, current_lat, current_lng, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(driver_id) DO UPDATE SET
           is_available = excluded.is_available,
           current_lat = excluded.current_lat,
           current_lng = excluded.current_lng,
           updated_at = excluded.updated_at`
      )
      .bind(driverId, isAvailable ? 1 : 0, lat ?? null, lng ?? null, now)
      .run();
  }
}
