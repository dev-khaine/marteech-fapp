// ============================================================
// Zod Validation Schemas
// ============================================================

import { z } from 'zod';

// ── Auth ────────────────────────────────────────────────────

export const RegisterSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password too long'),
  name: z.string().min(1, 'Name is required').max(100),
  phone: z.string().regex(/^\+?[0-9\s\-()]{7,20}$/, 'Invalid phone number').optional(),
  role: z.enum(['customer', 'driver', 'merchant']).default('customer'),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password required'),
});

// ── User ────────────────────────────────────────────────────

export const UpdateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  phone: z.string().regex(/^\+?[0-9\s\-()]{7,20}$/).optional(),
});

export const AddressSchema = z.object({
  label: z.string().min(1).max(50),
  street: z.string().min(1).max(200),
  city: z.string().min(1).max(100),
  country: z.string().min(1).max(100),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

// ── Order ───────────────────────────────────────────────────

const LocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const OrderItemSchema = z.object({
  name: z.string().min(1).max(200),
  quantity: z.number().int().positive().max(100),
  unit_price: z.number().positive().max(100_000),
});

export const CreateOrderSchema = z.object({
  merchant_id: z.string().uuid('Invalid merchant ID'),
  pickup_location: LocationSchema,
  dropoff_location: LocationSchema,
  items: z.array(OrderItemSchema).min(1, 'At least one item required'),
  notes: z.string().max(500).optional(),
});

export const UpdateOrderStatusSchema = z.object({
  status: z.enum(['accepted', 'preparing', 'picked_up', 'delivered', 'cancelled']),
});

// ── Driver ──────────────────────────────────────────────────

export const UpdateLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const NearbyDriversSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius_km: z.coerce.number().positive().max(50).default(10),
});

// ── Pagination ──────────────────────────────────────────────

export const PaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// ── Type Exports ────────────────────────────────────────────

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;
export type UpdateOrderStatusInput = z.infer<typeof UpdateOrderStatusSchema>;
export type UpdateLocationInput = z.infer<typeof UpdateLocationSchema>;
