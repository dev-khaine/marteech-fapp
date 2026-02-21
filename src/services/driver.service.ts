// ============================================================
// Driver Location Service
// Bridges the Worker ↔ DriverTracker Durable Object
// ============================================================

import type { Env, DriverLocationInfo } from '../types';
import { logger } from '../utils';
import type { OrderRepository } from '../repositories/order.repository';

export class DriverService {
  constructor(
    private orderRepo: OrderRepository,
    private env: Env
  ) {}

  /**
   * Get the singleton DriverTracker DO stub.
   * We use a fixed ID so all workers share one instance globally.
   * For regional sharding, derive the ID from a geohash bucket.
   */
  private getTracker(): DurableObjectStub {
    const id = this.env.DRIVER_TRACKER.idFromName('global');
    return this.env.DRIVER_TRACKER.get(id);
  }

  // ── Update Location ───────────────────────────────────────

  async updateLocation(
    driverId: string,
    lat: number,
    lng: number
  ): Promise<void> {
    const stub = this.getTracker();

    // Update Durable Object (real-time)
    const res = await stub.fetch('http://do/location', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driver_id: driverId, lat, lng }),
    });

    if (!res.ok) {
      const body = await res.json<{ error: string }>();
      throw new Error(`DO error: ${body.error}`);
    }

    // Also persist to D1 for dispatch queries (eventual consistency is fine here)
    await this.orderRepo.upsertDriverStatus(driverId, true, lat, lng);

    logger.info('Driver location updated', { driverId, lat, lng });
  }

  // ── Get Nearby Drivers ────────────────────────────────────

  async getNearbyDrivers(
    lat: number,
    lng: number,
    radius_km: number
  ): Promise<DriverLocationInfo[]> {
    const stub = this.getTracker();

    const res = await stub.fetch('http://do/nearby', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng, radius_km }),
    });

    if (!res.ok) {
      throw new Error('Failed to query nearby drivers');
    }

    const body = await res.json<{ success: boolean; data: DriverLocationInfo[] }>();
    return body.data;
  }

  // ── Go Offline ────────────────────────────────────────────

  async goOffline(driverId: string): Promise<void> {
    const stub = this.getTracker();

    await stub.fetch(`http://do/location/${driverId}`, { method: 'DELETE' });
    await this.orderRepo.upsertDriverStatus(driverId, false);

    logger.info('Driver went offline', { driverId });
  }

  // ── Set Availability ──────────────────────────────────────

  async setAvailability(driverId: string, available: boolean): Promise<void> {
    await this.orderRepo.upsertDriverStatus(driverId, available);
  }
}
