// ============================================================
// Utility Functions (Web Crypto API - Workers Compatible)
// ============================================================

import type { JWTPayload, ApiSuccess, ApiError } from '../types';

// ── Password Hashing (PBKDF2 via Web Crypto) ────────────────

/**
 * Hash a password using PBKDF2 + SHA-256
 * Returns: "iterations:salt_hex:hash_hex"
 */
export async function hashPassword(password: string): Promise<string> {
  const ITERATIONS = 100_000;
  const encoder = new TextEncoder();

  // Generate random salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Import password as key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  // Derive bits
  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );

  const saltHex = bufferToHex(salt);
  const hashHex = bufferToHex(new Uint8Array(hashBuffer));

  return `${ITERATIONS}:${saltHex}:${hashHex}`;
}

/**
 * Verify a password against a stored hash
 */
export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [iterStr, saltHex, storedHash] = stored.split(':');
  if (!iterStr || !saltHex || !storedHash) return false;

  const iterations = parseInt(iterStr, 10);
  const salt = hexToBuffer(saltHex);
  const encoder = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );

  const hashHex = bufferToHex(new Uint8Array(hashBuffer));

  // Constant-time comparison
  return timingSafeEqual(hashHex, storedHash);
}

// ── JWT (HS256 via Web Crypto) ──────────────────────────────

/**
 * Sign a JWT using HMAC-SHA256
 */
export async function signJWT(
  payload: Omit<JWTPayload, 'iat' | 'exp'>,
  secret: string,
  expiresInSeconds = 86400 // 24h default
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JWTPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(fullPayload));
  const unsigned = `${header}.${body}`;

  const key = await importHMACKey(secret);
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(unsigned)
  );

  return `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Verify and decode a JWT
 */
export async function verifyJWT(
  token: string,
  secret: string
): Promise<JWTPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, sig] = parts;
  const unsigned = `${header}.${body}`;

  try {
    const key = await importHMACKey(secret);
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlDecode(sig),
      new TextEncoder().encode(unsigned)
    );

    if (!isValid) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(body))
    ) as JWTPayload;

    // Check expiry
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

// ── ID Generation ───────────────────────────────────────────

/** Generate a URL-safe UUID v4 */
export function generateId(): string {
  return crypto.randomUUID();
}

// ── Geo Distance ────────────────────────────────────────────

/**
 * Haversine formula - returns distance in kilometers
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Response Helpers ────────────────────────────────────────

export function ok<T>(data: T): ApiSuccess<T> {
  return { success: true, data };
}

export function err(error: string, code?: string): ApiError {
  return { success: false, error, code };
}

// ── Internal Helpers ────────────────────────────────────────

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function bufferToHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function importHMACKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function base64UrlEncode(input: string | Uint8Array): string {
  const bytes =
    typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlDecode(input: string): Uint8Array {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ── Logger ──────────────────────────────────────────────────

export const logger = {
  info: (msg: string, data?: unknown) =>
    console.log(JSON.stringify({ level: 'INFO', msg, data, ts: new Date().toISOString() })),
  warn: (msg: string, data?: unknown) =>
    console.warn(JSON.stringify({ level: 'WARN', msg, data, ts: new Date().toISOString() })),
  error: (msg: string, data?: unknown) =>
    console.error(JSON.stringify({ level: 'ERROR', msg, data, ts: new Date().toISOString() })),
};
