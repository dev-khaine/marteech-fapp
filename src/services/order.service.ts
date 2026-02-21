// ============================================================
// Order Service - Business Logic & Dispatch
// ============================================================

import { HTTPException } from 'hono/http-exception';
import type { OrderRepository } from '../repositories/order.repository';
import type { OrderRow, OrderStatus, Env } from '../types';
import { haversineDistance, logger } from '../utils';
import type { CreateOrderInput, UpdateOrderStatusInput } from '../utils/schemas';

// Valid status transitions per actor role
const ALLOWED_TRANSITIONS: Record<string, OrderStatus[]> = {
  merchant: ['accepted', 'preparing', 'cancelled'],
  driver: ['picked_up', 'delivered'],
  customer: ['cancelled'],
  admin: ['accepted', 'preparing', 'picked_up', 'delivered', 'cancelled'],
};

export class OrderService {
  constructor(
    private orderRepo: OrderRepository,
    private env: Env
  ) {}

  // ── Create Order ─────────────────────────────────────────

  async createOrder(
    customerId: string,
    input: CreateOrderInput
  ): Promise<OrderRow & { items: unknown[] }> {
    // Compute total price from items
    const total_price = input.items.reduce(
      (sum, item) => sum + item.quantity * item.unit_price,
      0
    );

    const order = await this.orderRepo.create({
      customer_id: customerId,
      merchant_id: input.merchant_id,
      total_price,
      pickup_lat: input.pickup_location.lat,
      pickup_lng: input.pickup_location.lng,
      dropoff_lat: input.dropoff_location.lat,
      dropoff_lng: input.dropoff_location.lng,
      notes: input.notes,
      items: input.items,
    });

    logger.info('Order created', { orderId: order.id, customerId });

    // Attempt automatic dispatch in background (non-blocking)
    // In production, use a Queue instead
    this.dispatchOrder(order).catch((e) =>
      logger.warn('Auto-dispatch failed', { orderId: order.id, error: e?.message })
    );

    const items = await this.orderRepo.findItems(order.id);
    return { ...order, items };
  }

  // ── Get Order ─────────────────────────────────────────────

  async getOrder(
    orderId: string,
    requestingUserId: string,
    role: string
  ): Promise<OrderRow & { items: unknown[] }> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) throw new HTTPException(404, { message: 'Order not found' });

    // Access control: only involved parties or admin
    const canView =
      role === 'admin' ||
      order.customer_id === requestingUserId ||
      order.merchant_id === requestingUserId ||
      order.driver_id === requestingUserId;

    if (!canView) {
      throw new HTTPException(403, { message: 'Access denied' });
    }

    const items = await this.orderRepo.findItems(orderId);
    return { ...order, items };
  }

  // ── List My Orders ────────────────────────────────────────

  async getMyOrders(
    userId: string,
    role: string,
    page: number,
    limit: number
  ) {
    if (role === 'driver') {
      return this.orderRepo.findByDriver(userId, page, limit);
    }
    return this.orderRepo.findByCustomer(userId, page, limit);
  }

  // ── Update Status ─────────────────────────────────────────

  async updateOrderStatus(
    orderId: string,
    input: UpdateOrderStatusInput,
    requestingUserId: string,
    role: string
  ): Promise<OrderRow> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) throw new HTTPException(404, { message: 'Order not found' });

    // Authorization check
    const isParty =
      role === 'admin' ||
      order.customer_id === requestingUserId ||
      order.merchant_id === requestingUserId ||
      order.driver_id === requestingUserId;

    if (!isParty) throw new HTTPException(403, { message: 'Access denied' });

    // Role-based transition guard
    const allowed = ALLOWED_TRANSITIONS[role] ?? [];
    if (!allowed.includes(input.status)) {
      throw new HTTPException(400, {
        message: `Role '${role}' cannot set status to '${input.status}'`,
      });
    }

    // Logical ordering guard
    if (!isValidTransition(order.status, input.status)) {
      throw new HTTPException(400, {
        message: `Cannot transition from '${order.status}' to '${input.status}'`,
      });
    }

    const updated = await this.orderRepo.updateStatus(orderId, input.status);

    logger.info('Order status updated', {
      orderId,
      from: order.status,
      to: input.status,
      by: requestingUserId,
    });

    return updated!;
  }

  // ── Dispatch / Matching Logic ─────────────────────────────

  /**
   * Finds the nearest available driver to the pickup location
   * and assigns them to the order.
   *
   * Algorithm:
   * 1. Query D1 for drivers marked available with no active order
   * 2. Calculate haversine distance from pickup
   * 3. Assign nearest driver (with atomic update to prevent double-assignment)
   */
  async dispatchOrder(order: OrderRow): Promise<void> {
    const availableDrivers = await this.orderRepo.findAvailableDrivers();

    if (availableDrivers.length === 0) {
      logger.info('No available drivers for order', { orderId: order.id });
      return;
    }

    // Sort by distance from pickup location
    const sorted = availableDrivers
      .map((d) => ({
        ...d,
        distance: haversineDistance(
          order.pickup_lat,
          order.pickup_lng,
          d.current_lat,
          d.current_lng
        ),
      }))
      .sort((a, b) => a.distance - b.distance);

    const nearest = sorted[0];

    // Assign driver - the SQL UPSERT + status check prevents race conditions
    // In high-throughput scenarios, use Durable Object for locking
    await this.orderRepo.updateStatus(order.id, 'accepted', nearest.driver_id);

    logger.info('Driver dispatched', {
      orderId: order.id,
      driverId: nearest.driver_id,
      distance_km: nearest.distance.toFixed(2),
    });
  }

  /**
   * Manually trigger dispatch for a specific order (admin use)
   */
  async triggerDispatch(orderId: string): Promise<{ assigned: boolean; driver_id?: string }> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) throw new HTTPException(404, { message: 'Order not found' });
    if (order.status !== 'created') {
      throw new HTTPException(400, { message: 'Order already dispatched or completed' });
    }

    await this.dispatchOrder(order);

    const updated = await this.orderRepo.findById(orderId);
    return {
      assigned: updated?.driver_id != null,
      driver_id: updated?.driver_id ?? undefined,
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────

/**
 * Enforces logical status ordering to prevent invalid jumps.
 */
function isValidTransition(current: OrderStatus, next: OrderStatus): boolean {
  if (next === 'cancelled') {
    // Can cancel from any non-terminal state
    return current !== 'delivered' && current !== 'cancelled';
  }

  const order: Record<OrderStatus, number> = {
    created: 0,
    accepted: 1,
    preparing: 2,
    picked_up: 3,
    delivered: 4,
    cancelled: -1,
  };

  return order[next] > order[current];
}
