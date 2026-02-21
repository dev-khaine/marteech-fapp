// ============================================================
// Durable Object: DriverTracker
//
// Stores all driver locations in-memory inside a single DO
// instance per geographic region (or a global singleton).
// Provides fast geospatial nearest-driver queries.
// ============================================================

import { haversineDistance } from '../utils';

interface DriverLocation {
  driver_id: string;
  lat: number;
  lng: number;
  updated_at: string;
}

interface LocationStore {
  [driver_id: string]: DriverLocation;
}

/**
 * DriverTracker Durable Object
 *
 * Deployed as a singleton (or sharded by region).
 * Handles HTTP requests from the Worker:
 *   PUT  /location             - upsert driver position
 *   GET  /location/:driver_id  - get single driver position
 *   POST /nearby               - find drivers within radius
 *   DELETE /location/:driver_id - remove driver (offline)
 */
export class DriverTracker implements DurableObject {
  private state: DurableObjectState;
  // In-memory cache; loaded from storage on first access
  private locations: LocationStore = {};
  private loaded = false;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  // ── Load persisted state ──────────────────────────────────

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const stored = await this.state.storage.get<LocationStore>('locations');
    this.locations = stored ?? {};
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await this.state.storage.put('locations', this.locations);
  }

  // ── Fetch handler ─────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    await this.ensureLoaded();

    const url = new URL(request.url);
    const segments = url.pathname.replace(/^\//, '').split('/');
    // segments: ['location'] | ['location', driver_id] | ['nearby']

    try {
      // PUT /location - update driver location
      if (request.method === 'PUT' && segments[0] === 'location') {
        return await this.handleUpdateLocation(request);
      }

      // GET /location/:driver_id
      if (request.method === 'GET' && segments[0] === 'location' && segments[1]) {
        return this.handleGetLocation(segments[1]);
      }

      // DELETE /location/:driver_id
      if (request.method === 'DELETE' && segments[0] === 'location' && segments[1]) {
        return await this.handleRemoveLocation(segments[1]);
      }

      // POST /nearby - find drivers within radius
      if (request.method === 'POST' && segments[0] === 'nearby') {
        return await this.handleNearby(request);
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (err) {
      console.error('[DriverTracker] Error:', err);
      return jsonResponse({ error: 'Internal error' }, 500);
    }
  }

  // ── Route Handlers ────────────────────────────────────────

  private async handleUpdateLocation(request: Request): Promise<Response> {
    const body = await request.json<{ driver_id: string; lat: number; lng: number }>();

    if (!body.driver_id || body.lat == null || body.lng == null) {
      return jsonResponse({ error: 'Missing fields' }, 400);
    }

    const entry: DriverLocation = {
      driver_id: body.driver_id,
      lat: body.lat,
      lng: body.lng,
      updated_at: new Date().toISOString(),
    };

    this.locations[body.driver_id] = entry;
    await this.persist();

    return jsonResponse({ success: true, data: entry });
  }

  private handleGetLocation(driverId: string): Response {
    const loc = this.locations[driverId];
    if (!loc) return jsonResponse({ error: 'Driver not found' }, 404);
    return jsonResponse({ success: true, data: loc });
  }

  private async handleRemoveLocation(driverId: string): Promise<Response> {
    if (!this.locations[driverId]) {
      return jsonResponse({ error: 'Driver not found' }, 404);
    }
    delete this.locations[driverId];
    await this.persist();
    return jsonResponse({ success: true });
  }

  private async handleNearby(request: Request): Promise<Response> {
    const body = await request.json<{ lat: number; lng: number; radius_km: number }>();
    const { lat, lng, radius_km = 10 } = body;

    if (lat == null || lng == null) {
      return jsonResponse({ error: 'lat and lng required' }, 400);
    }

    // Prune stale entries (older than 5 minutes) before returning
    const staleThreshold = Date.now() - 5 * 60 * 1000;
    let pruned = false;
    for (const [id, loc] of Object.entries(this.locations)) {
      if (new Date(loc.updated_at).getTime() < staleThreshold) {
        delete this.locations[id];
        pruned = true;
      }
    }
    if (pruned) await this.persist();

    // Compute distances and filter
    const nearby = Object.values(this.locations)
      .map((loc) => ({
        ...loc,
        distance_km: haversineDistance(lat, lng, loc.lat, loc.lng),
      }))
      .filter((loc) => loc.distance_km <= radius_km)
      .sort((a, b) => a.distance_km - b.distance_km);

    return jsonResponse({ success: true, data: nearby });
  }
}

// ── Helpers ───────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
