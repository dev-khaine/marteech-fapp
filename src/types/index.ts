// ============================================================
// Core Types & Interfaces for Delivery Application
// ============================================================

export type UserRole = 'customer' | 'driver' | 'merchant' | 'admin';

export type OrderStatus =
  | 'created'
  | 'accepted'
  | 'preparing'
  | 'picked_up'
  | 'delivered'
  | 'cancelled';

// ── Database Row Types ──────────────────────────────────────

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  name: string;
  phone: string | null;
  created_at: string;
}

export interface AddressRow {
  id: string;
  user_id: string;
  label: string;
  street: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  created_at: string;
}

export interface OrderRow {
  id: string;
  customer_id: string;
  merchant_id: string;
  driver_id: string | null;
  status: OrderStatus;
  total_price: number;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  name: string;
  quantity: number;
  unit_price: number;
}

export interface DriverStatusRow {
  driver_id: string;
  is_available: boolean;
  current_lat: number | null;
  current_lng: number | null;
  updated_at: string;
}

// ── API / Domain Types ──────────────────────────────────────

export interface PublicUser {
  id: string;
  email: string;
  role: UserRole;
  name: string;
  phone: string | null;
  created_at: string;
}

export interface Location {
  lat: number;
  lng: number;
}

export interface OrderItem {
  name: string;
  quantity: number;
  unit_price: number;
}

export interface CreateOrderInput {
  merchant_id: string;
  pickup_location: Location;
  dropoff_location: Location;
  items: OrderItem[];
  notes?: string;
}

export interface UpdateOrderStatusInput {
  status: OrderStatus;
}

export interface UpdateLocationInput {
  lat: number;
  lng: number;
}

export interface NearbyDriversQuery {
  lat: number;
  lng: number;
  radius_km?: number;
}

export interface DriverLocationInfo {
  driver_id: string;
  lat: number;
  lng: number;
  distance_km: number;
  updated_at: string;
}

// ── JWT Payload ─────────────────────────────────────────────

export interface JWTPayload {
  sub: string;       // user id
  email: string;
  role: UserRole;
  iat: number;
  exp: number;
}

// ── Cloudflare Bindings ─────────────────────────────────────

export interface Env {
  // D1 Database
  DB: D1Database;

  // KV Namespaces
  SESSIONS: KVNamespace;
  RATE_LIMIT: KVNamespace;

  // Durable Objects
  DRIVER_TRACKER: DurableObjectNamespace;

  // Secrets
  JWT_SECRET: string;
  ENVIRONMENT: string;
}

// ── Context Variables (Hono) ────────────────────────────────

export interface AppVariables {
  user: JWTPayload;
}

// ── API Response Wrappers ───────────────────────────────────

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: string;
  code?: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ── Pagination ──────────────────────────────────────────────

export interface PaginationQuery {
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
}
