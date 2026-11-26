// server/security.js — auth, hashing, rate limiting, validation, gate tokens. Dependency-free (node:crypto only).
import crypto from 'node:crypto';
import { promisify } from 'node:util';

try { process.loadEnvFile?.(); } catch {}

const scrypt = promisify(crypto.scrypt);
export const IS_PROD = process.env.NODE_ENV === 'production';

function secretFromEnv(name) {
  const v = process.env[name];
  if (v && v.length >= 32) return v;
  if (IS_PROD) throw new Error(`${name} (>=32 chars) is required when NODE_ENV=production`);
  console.warn(`[security] ${name} not set — using an ephemeral dev secret (tokens die on restart)`);
  return crypto.randomBytes(48).toString('hex');
}
export const JWT_SECRET = secretFromEnv('JWT_SECRET');
export const GATE_SECRET = secretFromEnv('GATE_SECRET');

/* ---------- tokens (HS256 JWT, exp/iat in SECONDS per RFC 7519) ---------- */
const b64u = (b) => Buffer.from(b).toString('base64url');
const sign = (data, secret) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

export function signToken(payload, { ttlSec = 8 * 3600, scope = 'access', secret = JWT_SECRET } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ ...payload, iss: 'transitpulse', scope, iat: now, exp: now + ttlSec }));
  return `${header}.${body}.${sign(`${header}.${body}`, secret)}`;
}

export function verifyToken(token, { scope = 'access', secret = JWT_SECRET } = {}) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, b, s] = parts;
  try {
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;
    const a = Buffer.from(s);
    const e = Buffer.from(sign(`${h}.${b}`, secret));
    if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) return null;
    const p = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'));
    if (p.iss !== 'transitpulse' || p.scope !== scope) return null;
    if (typeof p.exp !== 'number' || Math.floor(Date.now() / 1000) >= p.exp) return null;
    return p;
  } catch {
    return null;
  }
}

/* ---------- middleware: Authorization header only (never ?token=) ---------- */
function bearer(req) {
  const h = req.headers.authorization;
  return h && h.startsWith('Bearer ') ? h.slice(7) : null;
}
// The API installs this callback at startup. It lets a password reset revoke
// issued student JWTs without creating a database import cycle here.
let accessTokenValidator = null;
export function setAccessTokenValidator(validator) {
  accessTokenValidator = typeof validator === 'function' ? validator : null;
}
function tokenIsCurrent(user) {
  try {
    return !accessTokenValidator || accessTokenValidator(user) !== false;
  } catch {
    // A validator failure must fail closed; otherwise a reset could leave an
    // old session usable.
    return false;
  }
}
export function requireAuth(req, res, next) {
  const user = verifyToken(bearer(req));
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  if (!tokenIsCurrent(user)) return res.status(401).json({ error: 'Session has expired. Please sign in again.' });
  if (user.mustChangePassword && req.path !== '/api/students/me/password' && req.path !== '/api/auth/logout') {
    return res.status(403).json({ error: 'Password change required before accessing platform features', code: 'PASSWORD_CHANGE_REQUIRED' });
  }
  req.user = user;
  next();
}
export const requireRole = (...roles) => (req, res, next) => {
  const user = verifyToken(bearer(req));
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  if (!tokenIsCurrent(user)) return res.status(401).json({ error: 'Session has expired. Please sign in again.' });
  if (!roles.includes(user.role)) return res.status(403).json({ error: 'Insufficient privileges' });
  if (user.mustChangePassword && req.path !== '/api/students/me/password' && req.path !== '/api/auth/logout') {
    return res.status(403).json({ error: 'Password change required before accessing platform features', code: 'PASSWORD_CHANGE_REQUIRED' });
  }
  req.user = user;
  next();
};

/* ---------- passwords: scrypt, constant-time verify ---------- */
const N = 16384, R = 8, P = 1;
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw), salt, 64, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
export const hashPasswordSync = hashPassword;
export async function verifyPassword(pw, stored) {
  try {
    const [alg, n, r, p, salt, hash] = String(stored || '').split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'base64url');
    const key = await scrypt(String(pw), Buffer.from(salt, 'base64url'), expected.length, { N: +n, r: +r, p: +p });
    return crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}
let dummy;
/** Burn the same CPU for unknown users so login timing doesn't reveal which roll numbers exist. */
export async function verifyDummy(pw) {
  dummy ??= await hashPassword('dummy-password');
  await verifyPassword(pw, dummy);
  return false;
}

/* ---------- rate limiting (in-memory, single process; use Redis if you scale out) ---------- */
export function rateLimit({ windowMs, max, key = (req) => req.ip, message = 'Too many requests, slow down' }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, e] of hits) if (e.reset <= now) hits.delete(k);
  }, Math.min(windowMs, 60_000)).unref();
  const mw = (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    let e = hits.get(k);
    if (!e || e.reset <= now) hits.set(k, (e = { count: 0, reset: now + windowMs }));
    if (++e.count > max) {
      res.set('Retry-After', String(Math.ceil((e.reset - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
  mw.reset = (k) => hits.delete(k);
  return mw;
}

/* ---------- CORS: exact origins and local LAN devices ---------- */
export function buildCorsOptions() {
  const allowed = new Set([
    'http://localhost:5173', 'http://127.0.0.1:5173',
    'http://localhost:3001', 'http://127.0.0.1:3001',
    'https://localhost',        // Capacitor Android (androidScheme: 'https')
    'capacitor://localhost',    // Capacitor iOS
    ...String(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  ]);

  const isAllowedOrigin = (origin) => {
    if (!origin) return true;
    if (allowed.has(origin)) return true;
    try {
      const u = new URL(origin);
      const host = u.hostname;
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return true;
      // Allow RFC1918 private IPv4 networks (e.g. 10.x.x.x, 192.168.x.x, 172.16-31.x.x) and link-local (169.254.x.x)
      if (/^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3})$/.test(host)) return true;
      // Allow private IPv6 addresses
      if (/^(fe80:|fc|fd)/i.test(host)) return true;
    } catch {
      return false;
    }
    return false;
  };

  return {
    origin: (origin, cb) => (isAllowedOrigin(origin) ? cb(null, true) : cb(null, false)),
    credentials: false, // bearer tokens, no cookies
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    maxAge: 600,
  };
}

/* ---------- CSP Header ---------- */
export const CSP_HEADER = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com https://unpkg.com; connect-src 'self' https://router.project-osrm.org https://*.tile.openstreetmap.org https://*.firebaseio.com https://*.googleapis.com wss://*.firebaseio.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

/* ---------- misc helpers ---------- */
export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** 'Route 14 (Secunderabad)' | 'ROUTE-14' | 'route-14' -> 'route-14'. Adjust if your ids are zero-padded. */
export function normalizeRoute(s) {
  const m = /(\d+)/.exec(String(s ?? ''));
  return m ? `route-${parseInt(m[1], 10)}` : String(s ?? '').trim().toLowerCase();
}

export function haversineKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(x));
}

/* ---------- rotating gate token (QR on driver phone, or BLE beacon firmware, e.g. ESP32) ---------- */
const STEP_MS = 30_000;
const busKey = (route) => crypto.createHmac('sha256', GATE_SECRET).update(`bus|${normalizeRoute(route)}`).digest();
/** Flash busKey(route) into that bus's beacon; it computes the same value. Never ship GATE_SECRET itself. */
export const gateToken = (route, now = Date.now()) =>
  crypto.createHmac('sha256', busKey(route)).update(String(Math.floor(now / STEP_MS))).digest('hex').slice(0, 12);
export function verifyGateToken(route, token, now = Date.now(), skew = 1) {
  if (typeof token !== 'string' || !/^[0-9a-f]{12}$/.test(token)) return false;
  for (let d = -skew; d <= skew; d++) {
    if (crypto.timingSafeEqual(Buffer.from(gateToken(route, now + d * STEP_MS)), Buffer.from(token))) return true;
  }
  return false;
}
export const GATE_STEP_SECONDS = STEP_MS / 1000;

/* ---------- event validation: per-role sheet + column allowlists, identity forced from the token ---------- */
const COLS = {
  Boarding_Attendance: ['Timestamp', 'Roll Number', 'Student Name', 'Route ID', 'Stop Name', 'Event Type', 'Check-In Method', 'Notes'],
  Return_Trip_Changes: ['Timestamp', 'Roll Number', 'Student Name', 'Route ID', 'Original Drop Stop', 'Selected Alternate Stop', 'Parent Notification Status'],
  Lost_Item_Claims: ['Timestamp', 'Claim ID', 'Roll Number', 'Student Name', 'Route ID', 'Item Type', 'Seat Zone', 'Status'],
  Driver_Trip_Logs: ['Timestamp', 'Route ID', 'Driver Name', 'Bus Registration', 'Direction', 'Skipped Clusters', 'Fuel Saved (L)', 'Cost Saved (INR)'],
};
const ROLE_SHEETS = {
  STUDENT: ['Return_Trip_Changes', 'Lost_Item_Claims', 'Boarding_Attendance'],
  DRIVER: ['Driver_Trip_Logs', 'Boarding_Attendance'],
  ADMIN: Object.keys(COLS),
};
// Students may log only these self-reported boarding events. Real boardings go through /api/boarding/check-in.
export const STUDENT_BOARDING_EVENTS = new Set(['NOT_COMING_OPT_OUT', 'WAKEUP_ACK']);

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function validateEvent(user, sheetName, data) {
  if (!COLS[sheetName] || !ROLE_SHEETS[user.role]?.includes(sheetName)) throw new HttpError(403, `Not allowed to write "${sheetName}"`);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'data must be an object');
  const row = {};
  for (const col of COLS[sheetName]) {
    const v = data[col];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string' && typeof v !== 'number') throw new HttpError(400, `Invalid value for "${col}"`);
    const s = String(v).slice(0, 300);
    row[col] = s;
  }
  if (user.role === 'STUDENT') {
    row['Roll Number'] = user.sub;            // identity comes from the token, never the body
    row['Student Name'] = user.name;
    if (sheetName === 'Boarding_Attendance' && !STUDENT_BOARDING_EVENTS.has(row['Event Type'])) {
      throw new HttpError(403, 'Students cannot self-report that event type');
    }
  }
  if (user.role === 'DRIVER') {
    row['Route ID'] = user.routeId;           // a driver can only write for their own bus
    if (sheetName === 'Driver_Trip_Logs') row['Driver Name'] = user.name;
  }
  return row;
}

/** Client timestamps are accepted only if ISO-8601, not in the future, and < 7 days old; stored as UTC 'YYYY-MM-DD HH:MM:SS'. */
export function utcStamp(input) {
  const t = input ? Date.parse(input) : NaN;
  const now = Date.now();
  const ms = Number.isFinite(t) && t <= now + 60_000 && t > now - 7 * 864e5 ? t : now;
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}
