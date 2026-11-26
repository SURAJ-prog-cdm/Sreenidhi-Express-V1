// server/index.js — hardened TransitPulse API (Express 5). Replaces the previous file.
try { process.loadEnvFile?.(); } catch {}
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, DATA_DIR, DB_FILE_PATH, EXCEL_FILE_PATH, generateExcelFileFromDb, getExcelSummary, appendSheetRow, maskPhoneNumber, getAllStudents, createSqliteBackup } from './excelStorage.js';
import { createExtras } from './dbExtras.js';
import { sendTelegramAlert } from './telegramNotifier.js';
import { getRouteStops, ROUTE_TOPOLOGY } from './routeTopology.js';
import * as webpushModule from 'web-push';
import {
  IS_PROD, signToken, verifyToken, requireAuth, requireRole, setAccessTokenValidator, hashPassword, verifyPassword, verifyDummy, rateLimit,
  buildCorsOptions, escapeHtml, normalizeRoute, haversineKm, gateToken, verifyGateToken, GATE_STEP_SECONDS,
  validateEvent, utcStamp, HttpError, CSP_HEADER,
} from './security.js';

const wp = webpushModule.default || webpushModule;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:transport@sreenidhi.edu.in';
const CARTO_API_KEY = (process.env.CARTO_API_KEY || '').trim();

let vapidConfigured = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    wp.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidConfigured = true;
  } catch (err) {
    console.warn('[WebPush] Failed to configure VAPID:', err.message);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, '../dist');
const PORT = Number(process.env.PORT) || 3001;

const extras = createExtras(db);
extras.migrate();

async function sendWebPush({ roll, routeId, userType, title, body, url = '/' } = {}) {
  if (!vapidConfigured) return;
  try {
    const subs = extras.listPushSubscriptions({ roll, routeId, userType });
    if (!subs || subs.length === 0) return;

    const payload = JSON.stringify({
      title: title || 'Sreenidhi Express',
      body: body || '',
      url: url || '/',
    });

    await Promise.allSettled(
      subs.map(async (sub) => {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        };
        try {
          await wp.sendNotification(pushSubscription, payload);
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            extras.deletePushSubscription(sub.endpoint);
          }
        }
      })
    );
  } catch (err) {
    console.warn('[WebPush] Error dispatching push:', err.message);
  }
}

setAccessTokenValidator((user) => {
  if (user.role !== 'STUDENT') return true;
  const row = extras.getStudentRow(user.sub);
  if (!row) return false;
  if (row.verification_status && row.verification_status !== 'VERIFIED') return false;
  if (row.session_version !== Number(user.sessionVersion || 0)) return false;
  if (row.must_change_password && !user.mustChangePassword) return false;
  return true;
});

const app = express();
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': CSP_HEADER,
  });
  if (IS_PROD) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});
app.use(cors(buildCorsOptions()));
app.use((req, res, next) => {
  if (req.path === '/api/admin/students/bulk-import') {
    return next();
  }
  express.json({ limit: '32kb' })(req, res, next);
});

// Request logging for API visibility and debugging
app.use((req, res, next) => {
  const t0 = Date.now();
  const url = req.originalUrl || req.url;
  res.on('finish', () => {
    if (!url.startsWith('/assets/')) {
      console.log(`[HTTP] ${req.method} ${url} -> ${res.statusCode} (${Date.now() - t0}ms) from ${req.ip}`);
    }
  });
  next();
});

const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const str = (v, max, name) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new HttpError(400, `${name} is required (max ${max} chars)`);
  return v.trim();
};
const sameStopName = (a, b) =>
  String(a || '').trim().toLowerCase().replace(/\s+/g, ' ') ===
  String(b || '').trim().toLowerCase().replace(/\s+/g, ' ');
const resolveStudentRoll = (user) => {
  if (!user) throw new HttpError(401, 'Unauthorized');
  if (user.role === 'PARENT') {
    if (!user.wardRoll || typeof user.wardRoll !== 'string' || !user.wardRoll.trim()) {
      throw new HttpError(403, 'Parent token missing wardRoll');
    }
    return user.wardRoll.trim().toUpperCase();
  }
  return user.sub;
};
const rowToStudent = (s, { maskPhone = true } = {}) => ({
  'Roll Number': s.roll_number,
  'Student Name': s.name,
  'Department / Program': s.program,
  'Assigned Route': s.route_id,
  'Pickup Stop': s.pickup_stop,
  'Parent Name': s.parent_name,
  'Parent Phone': maskPhone ? maskPhoneNumber(s.parent_phone) : s.parent_phone,
  'Pass Status': s.pass_status,
  'Fee Status': s.fee_status || 'PAID',
  'Registered At': s.registered_at,
  'Last Active': s.last_active,
  mustChangePassword: Boolean(s.must_change_password),
  studentPhone: s.student_phone || '',
  studentPhoneVerified: Boolean(s.student_phone_verified),
  parentPhoneVerified: Boolean(s.parent_phone_verified),
  riderType: (s.rider_type || 'STUDENT').toUpperCase(),
  gender: s.gender || 'M',
  verificationStatus: s.verification_status || 'VERIFIED',
  boardedToday: extras.isBoardedToday(s.roll_number, s.route_id),
});

/* ---------------- limiters ---------------- */
const loginKey = (req) => `${req.ip}|${String(req.body?.rollNumber ?? req.body?.adminId ?? req.body?.routeId ?? req.body?.code ?? '').trim().toUpperCase()}`;
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, max: IS_PROD ? 8 : 100, key: loginKey, message: 'Too many attempts. Try again in 15 minutes.' });
const ipLoginLimiter = rateLimit({ windowMs: 15 * 60_000, max: IS_PROD ? 300 : 500 }); // blunt IP-wide cap against credential stuffing (300 in prod for campus Wi-Fi & CGNAT)
const apiLimiter = rateLimit({ windowMs: 60_000, max: 240, key: (r) => r.user?.sub ?? r.ip });
const telemetryLimiter = rateLimit({ windowMs: 60_000, max: 120, key: (r) => r.user?.sub ?? r.ip });
const alertLimiter = rateLimit({ windowMs: 60_000, max: 10, key: (r) => r.user?.sub ?? r.ip, message: 'Alert rate limit reached' });
const otpRequestLimiter = rateLimit({ windowMs: 10 * 60_000, max: 3, key: (r) => `${r.ip}|${r.user?.sub || 'anonymous'}|${r.body?.userType || ''}`, message: 'Too many OTP requests. Please wait 10 minutes.' });
const dispatchLimiter = rateLimit({ windowMs: 60_000, max: 5, key: (r) => r.user?.sub ?? r.ip, message: 'Too many notification dispatches' });
const tileLimiter = rateLimit({ windowMs: 60_000, max: 600, key: (r) => r.ip });

/* ---------------- Server-Side CARTO Tile Proxy & LRU Cache ---------------- */
const TILE_CACHE_MAX = 1500;
const TILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const tileCache = new Map();
let warnedNoCartoKey = false;

app.get('/api/tiles/:theme/:z/:x/:y', tileLimiter, async (req, res) => {
  const { theme, z: rawZ, x: rawX, y: rawY } = req.params;
  if (theme !== 'voyager' && theme !== 'dark_all') {
    return res.status(400).json({ error: 'Invalid tile theme' });
  }

  const cleanY = String(rawY || '').replace(/\.png$/i, '');
  if (!/^\d+$/.test(String(rawZ)) || !/^\d+$/.test(String(rawX)) || !/^\d+$/.test(cleanY)) {
    return res.status(400).json({ error: 'Invalid tile coordinates' });
  }

  const z = Number.parseInt(rawZ, 10);
  const x = Number.parseInt(rawX, 10);
  const y = Number.parseInt(cleanY, 10);

  if (!Number.isInteger(z) || z < 0 || z > 19) {
    return res.status(400).json({ error: 'Invalid tile coordinates' });
  }

  const maxCoord = 1 << z;
  if (!Number.isInteger(x) || x < 0 || x >= maxCoord || !Number.isInteger(y) || y < 0 || y >= maxCoord) {
    return res.status(400).json({ error: 'Invalid tile coordinates' });
  }

  const cacheKey = `${theme}/${z}/${x}/${y}`;
  const cached = tileCache.get(cacheKey);
  if (cached) {
    if (Date.now() - cached.timestamp < TILE_CACHE_TTL_MS) {
      tileCache.delete(cacheKey);
      tileCache.set(cacheKey, cached);
      res.set({
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
      });
      return res.send(cached.buffer);
    }
    tileCache.delete(cacheKey);
  }

  if (!CARTO_API_KEY && !warnedNoCartoKey) {
    warnedNoCartoKey = true;
    console.warn('[tiles] CARTO_API_KEY not set — CARTO will watermark tiles');
  }

  const baseUrl = theme === 'dark_all'
    ? `https://a.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`
    : `https://a.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`;
  const upstreamUrl = CARTO_API_KEY ? `${baseUrl}?key=${encodeURIComponent(CARTO_API_KEY)}` : baseUrl;

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      signal: AbortSignal.timeout(8000),
      headers: {
        'User-Agent': 'SreenidhiExpress/1.0',
      },
    });

    const ctype = upstreamRes.headers.get('content-type') || '';
    if (!upstreamRes.ok || !ctype.startsWith('image/')) {
      return res.status(502).json({ error: 'Tile upstream unavailable' });
    }

    const arrayBuffer = await upstreamRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (tileCache.size >= TILE_CACHE_MAX) {
      const oldestKey = tileCache.keys().next().value;
      if (oldestKey) tileCache.delete(oldestKey);
    }
    tileCache.set(cacheKey, { buffer, timestamp: Date.now() });

    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    });
    return res.send(buffer);
  } catch {
    return res.status(502).json({ error: 'Tile upstream unavailable' });
  }
});

/* ---------------- health (minimal, no internals) ---------------- */
app.get('/api/health', (req, res) => res.json({ status: 'ONLINE' }));

/* ---------------- authentication ---------------- */
app.post('/api/students/register', ipLoginLimiter, async (req, res) => {
  const rollNumber = str(req.body?.rollNumber, 20, 'rollNumber').toUpperCase();
  const name = str(req.body?.name, 80, 'name');
  const email = str(req.body?.email, 120, 'email').toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const studentPhone = String(req.body?.studentPhone || '').replace(/\D/g, '').slice(-10);
  const pickupStop = str(req.body?.pickupStop, 80, 'pickupStop');

  if (!email.includes('@')) throw new HttpError(400, 'Please enter a valid college email address');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (studentPhone.length !== 10) throw new HttpError(400, 'Please enter a valid 10-digit mobile number');

  const existing = extras.getStudentRow(rollNumber);
  if (existing) {
    return res.status(409).json({
      success: false,
      error: 'Roll number is already registered. Sign in or contact the Transport Office.',
    });
  }

  const passwordHash = await hashPassword(password);
  const created = extras.createPendingStudent({
    rollNumber,
    name,
    email,
    passwordHash,
    studentPhone,
    pickupStop,
  });
  if (!created) {
    return res.status(409).json({
      success: false,
      error: 'Roll number is already registered.',
    });
  }

  appendSheetRow('Alerts_Notifications', {
    Timestamp: now(),
    'Alert ID': `REG-${Date.now()}`,
    'Recipient Name': 'Transport Office',
    Category: 'REGISTRATION',
    Title: 'New Student Self-Signup',
    Message: `${name} (${rollNumber}) requested stop "${pickupStop}" — awaiting 1-click verification.`,
    'Delivery Status': 'PENDING',
  });

  res.status(201).json({
    success: true,
    status: 'PENDING_VERIFICATION',
    rollNumber,
    message: 'Submitted — awaiting Transport Office tick-mark approval & bus assignment.',
  });
});

app.post('/api/students/login', ipLoginLimiter, loginLimiter, async (req, res) => {
  const roll = str(req.body?.rollNumber, 20, 'rollNumber').toUpperCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const row = extras.getStudentRow(roll);
  const ok = row?.password_hash ? await verifyPassword(password, row.password_hash) : await verifyDummy(password);
  if (!ok) return res.status(401).json({ success: false, error: 'Invalid roll number or password' }); // same message for both cases

  if (row.verification_status === 'PENDING_VERIFICATION') {
    return res.status(403).json({
      success: false,
      code: 'ACCOUNT_PENDING_VERIFICATION',
      error: 'Your registration is awaiting Transport Office verification.',
    });
  }
  if (row.verification_status === 'REJECTED') {
    return res.status(403).json({
      success: false,
      code: 'ACCOUNT_REJECTED',
      error: 'Your registration was rejected. Contact the Transport Office.',
    });
  }

  loginLimiter.reset(loginKey(req));
  extras.touchLastActive(roll);
  appendSheetRow('Boarding_Attendance', {
    Timestamp: now(), 'Roll Number': roll, 'Student Name': row.name, 'Route ID': row.route_id, 'Stop Name': row.pickup_stop,
    'Event Type': 'STUDENT_PORTAL_LOGIN', 'Check-In Method': 'PASSWORD', Notes: 'Authenticated student session',
  });
  const token = signToken({
    sub: roll,
    name: row.name,
    role: 'STUDENT',
    routeId: row.route_id,
    mustChangePassword: Boolean(row.must_change_password),
    sessionVersion: extras.getSessionVersion(row.roll_number),
  });
  const studentData = rowToStudent(row);
  studentData.mustChangePassword = Boolean(row.must_change_password);
  res.json({ success: true, student: studentData, token });
});

app.get('/api/students/me', requireRole('STUDENT', 'PARENT'), (req, res) => {
  const roll = resolveStudentRoll(req.user);
  const row = extras.getStudentRow(roll);
  if (!row) return res.status(404).json({ error: 'Student not found' });
  const studentData = rowToStudent(row);
  studentData.mustChangePassword = Boolean(row.must_change_password);
  res.json({ success: true, student: studentData });
});

app.post('/api/admin/login', ipLoginLimiter, loginLimiter, async (req, res) => {
  const hash = process.env.ADMIN_PASSWORD_HASH, adminId = process.env.ADMIN_ID;
  if (!hash || !adminId) return res.status(503).json({ error: 'Admin login is not configured on this server' });
  const id = str(req.body?.adminId, 80, 'adminId');
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const idOk = id.length === adminId.length && crypto.timingSafeEqual(Buffer.from(id.toUpperCase()), Buffer.from(adminId.toUpperCase()));
  const pwOk = await verifyPassword(password, hash); // always run, so timing doesn't leak whether the ID matched
  if (!idOk || !pwOk) return res.status(401).json({ success: false, error: 'Invalid credentials' });
  loginLimiter.reset(loginKey(req));
  const admin = { id: adminId, name: process.env.ADMIN_NAME || 'Transport Incharge', role: 'ADMIN' };
  appendSheetRow('Alerts_Notifications', { Timestamp: now(), 'Alert ID': `ADM-${Date.now()}`, 'Recipient Name': admin.name, Category: 'SECURITY', Title: 'Admin login', Message: `Admin login from ${req.ip}`, 'Delivery Status': 'AUDIT' });
  res.json({ success: true, admin, token: signToken({ sub: admin.id, name: admin.name, role: 'ADMIN' }, { ttlSec: 2 * 3600 }) });
});

// DRIVER_PIN_HASHES='{"route-51":"scrypt$...","route-14":"scrypt$...","route-15":"scrypt$..."}'  (one hash per bus; generate with scripts/generate-env.js; use 6+ digits)
const getDriverHashes = () => {
  try { return JSON.parse(process.env.DRIVER_PIN_HASHES || '{}'); } catch { return {}; }
};
app.post('/api/driver/login', ipLoginLimiter, loginLimiter, async (req, res) => {
  const route = normalizeRoute(str(req.body?.routeId, 40, 'routeId'));
  const pin = typeof req.body?.pin === 'string' ? req.body.pin : '';
  const stored = getDriverHashes()[route];
  let ok = false;
  if (stored) {
    ok = await verifyPassword(pin, stored);
  } else if (process.env.NODE_ENV !== 'production') {
    if ((route === 'route-51' && pin === (process.env.DRIVER_PIN_51 || '515151')) ||
        (route === 'route-14' && pin === (process.env.DRIVER_PIN_14 || '141414')) ||
        (route === 'route-15' && pin === (process.env.DRIVER_PIN_15 || '151515'))) {
      ok = true;
    } else {
      await verifyDummy(pin);
    }
  } else {
    await verifyDummy(pin);
  }
  if (!ok) return res.status(401).json({ success: false, error: 'Invalid route or PIN' });
  loginLimiter.reset(loginKey(req));
  const driver = { id: `driver-${route}`, role: 'DRIVER', routeId: route, name: `Driver (${route})` };
  appendSheetRow('Driver_Trip_Logs', { Timestamp: now(), 'Route ID': route, 'Driver Name': driver.name, Direction: 'SESSION_START' });
  res.json({ success: true, driver, token: signToken({ sub: driver.id, name: driver.name, role: 'DRIVER', routeId: route }, { ttlSec: 12 * 3600 }) });
});

// Parent portal: the student generates a 30-day code in their app and shares it. The token is scoped to that one ward.
app.post('/api/students/me/parent-access-code', requireRole('STUDENT'), alertLimiter, (req, res) =>
  res.json({ code: extras.createParentCode(req.user.sub), expiresInDays: 30 }));
app.post('/api/parents/login', ipLoginLimiter, loginLimiter, (req, res) => {
  const code = str(req.body?.code, 20, 'code').trim();
  const roll = extras.redeemParentCode(code);
  if (!roll) return res.status(401).json({ success: false, error: 'Invalid or expired parent access code. Please ask your ward to generate a code in their Student Portal.' });
  const ward = extras.getStudentRow(roll);
  if (!ward) return res.status(401).json({ success: false, error: 'Student record not found for this access code' });
  loginLimiter.reset(loginKey(req));
  const parent = { 
    id: `parent-${roll}`, 
    role: 'PARENT', 
    wardRoll: roll, 
    wardName: ward.name, 
    wardRouteId: ward.route_id,
    wardPickupStop: ward.pickup_stop,
    name: `${ward.name}'s Parent` 
  };
  res.json({ success: true, parent, token: signToken({ sub: parent.id, name: parent.name, role: 'PARENT', wardRoll: roll, routeId: ward.route_id }, { ttlSec: 7 * 24 * 3600 }) });
});

app.post('/api/students/me/password', requireRole('STUDENT'), loginLimiter, async (req, res) => {
  const { current, next } = req.body ?? {};
  if (typeof next !== 'string' || next.length < 10 || next.length > 128) throw new HttpError(400, 'New password must be 10-128 characters');
  const row = extras.getStudentRow(req.user.sub);
  if (!row?.password_hash || !(await verifyPassword(String(current ?? ''), row.password_hash))) throw new HttpError(401, 'Current password is incorrect');
  extras.setPasswordHash(req.user.sub, await hashPassword(next));
  extras.clearMustChangePassword(req.user.sub);
  const refreshedToken = signToken({
    sub: req.user.sub,
    name: row.name,
    role: 'STUDENT',
    routeId: row.route_id,
    mustChangePassword: false,
    sessionVersion: extras.getSessionVersion(row.roll_number),
  });
  res.json({ success: true, token: refreshedToken });
});

/* ---------------- admin: provisioning (replaces the public /register that overwrote records) ---------------- */
app.post('/api/admin/students', requireRole('ADMIN'), async (req, res) => {
  const b = req.body ?? {};
  const roll = str(b.rollNumber, 20, 'rollNumber').toUpperCase();
  if (!/^[0-9A-Z]{6,20}$/.test(roll)) throw new HttpError(400, 'rollNumber format invalid');
  const phone = str(b.parentPhone, 20, 'parentPhone');
  if (!/^\+?[\d\s-]{10,16}$/.test(phone)) throw new HttpError(400, 'parentPhone format invalid');
  const temp = crypto.randomBytes(9).toString('base64url');
  const created = extras.createStudent({
    roll, name: str(b.name, 80, 'name'), program: str(b.program, 80, 'program'), routeId: str(b.routeId, 60, 'routeId'),
    pickupStop: str(b.pickupStopId, 80, 'pickupStopId'), parentName: str(b.parentName, 80, 'parentName'), parentPhone: phone,
  }, await hashPassword(temp));
  if (!created) throw new HttpError(409, 'A student with this roll number already exists');
  extras.setMustChangePassword(roll, 1);
  res.status(201).json({ success: true, rollNumber: roll, temporaryPassword: temp, mustChangePassword: true }); // shown once; student must change it
});

app.post('/api/admin/students/:roll/password', requireRole('ADMIN'), async (req, res) => {
  const roll = req.params.roll.toUpperCase();
  const temp = crypto.randomBytes(9).toString('base64url');
  if (!extras.setPasswordHash(roll, await hashPassword(temp))) throw new HttpError(404, 'Student not found');
  extras.setMustChangePassword(roll, 1);
  extras.revokeStudentSessions(roll);
  appendSheetRow('Alerts_Notifications', { Timestamp: now(), 'Alert ID': `PWD-${Date.now()}`, Category: 'SECURITY', Title: 'Password reset', Message: `${req.user.sub} reset password for ${roll}`, 'Delivery Status': 'AUDIT' });
  res.json({ success: true, temporaryPassword: temp, mustChangePassword: true });
});

/* ---------------- students (scoped by role; no more "every student's data for any login") ---------------- */
app.get('/api/students', requireAuth, apiLimiter, (req, res) => {
  const { role, sub, routeId } = req.user;
  if (role === 'ADMIN') { const s = getAllStudents(false); return res.json({ success: true, count: s.length, students: s, piiMasked: false }); }
  if (role === 'STUDENT' || role === 'PARENT') { const r = extras.getStudentRow(role === 'PARENT' ? req.user.wardRoll : sub); return res.json({ success: true, count: 1, students: r ? [rowToStudent(r)] : [], piiMasked: true }); }
  const mine = getAllStudents(true).filter((s) => normalizeRoute(s['Assigned Route']) === normalizeRoute(routeId));
  res.json({ success: true, count: mine.length, students: mine, piiMasked: true });
});

/* ---------------- events (idempotent, validated, identity forced from the token) ---------------- */
function processEvent(user, item) {
  const { eventId, sheetName, data, clientTime } = item ?? {};
  if (eventId !== undefined && !/^[\w-]{8,64}$/.test(eventId)) throw new HttpError(400, 'eventId format invalid');
  const row = validateEvent(user, sheetName, data);
  row.Timestamp = utcStamp(clientTime ?? data?.Timestamp);
  return extras.tx(() => {
    if (eventId && !extras.claimEvent(`${user.sub}:${eventId}`)) return { duplicate: true };
    appendSheetRow(sheetName, row);
    return { duplicate: false };
  });
}
app.post('/api/events/record', requireAuth, apiLimiter, (req, res) => res.json({ success: true, ...processEvent(req.user, req.body) }));
app.post('/api/events/batch', requireAuth, apiLimiter, (req, res) => {
  const items = req.body?.events;
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) throw new HttpError(400, 'events must be an array of 1-50 items');
  // Per-item results so one bad row never blocks the rest of an offline backlog.
  const results = items.map((it) => {
    try { return { eventId: it?.eventId, ok: true, ...processEvent(req.user, it) }; }
    catch (e) { return { eventId: it?.eventId, ok: false, status: e.status ?? 500, error: e instanceof HttpError ? e.message : 'failed' }; }
  });
  res.json({ success: true, results });
});

/* ---------------- boarding: server-verified (fee gate + rotating gate token) ---------------- */
app.get('/api/driver/gate-token', requireRole('DRIVER'), (req, res) => {
  const t = gateToken(req.user.routeId);
  res.json({ token: t, qrPayload: `SUH-GATE:${normalizeRoute(req.user.routeId)}:${t}`, refreshInSeconds: GATE_STEP_SECONDS });
});

app.post('/api/boarding/check-in', requireRole('STUDENT'), apiLimiter, (req, res) => {
  const { routeId, method, token, rssi, eventId, clientTime } = req.body ?? {};
  if (method !== 'QR' && method !== 'BLE') throw new HttpError(400, 'method must be QR or BLE');
  const route = normalizeRoute(str(routeId, 40, 'routeId'));
  const s = extras.getStudentRow(req.user.sub);
  if (!s) throw new HttpError(401, 'Unknown student');
  if (!extras.canStudentTravel(s.roll_number)) {
    return res.status(403).json({ success: false, code: 'PASS_INACTIVE', error: 'Bus pass is locked due to pending transport fee clearance. Clear dues or request an Emergency Grace Pass.' });
  }
  if (normalizeRoute(s.route_id) !== route) throw new HttpError(403, 'You are not assigned to this bus'); // relax here if alternate-route boarding is allowed
  if (!verifyGateToken(route, token)) throw new HttpError(401, 'Gate code invalid or expired');
  if (extras.isBoardedToday(s.roll_number, s.route_id)) return res.json({ success: true, duplicate: true });
  const result = extras.tx(() => {
    if (eventId && !extras.claimEvent(`${s.roll_number}:${eventId}`)) return { duplicate: true };
    if (extras.isBoardedToday(s.roll_number, s.route_id)) return { duplicate: true };
    appendSheetRow('Boarding_Attendance', {
      Timestamp: utcStamp(clientTime), 'Roll Number': s.roll_number, 'Student Name': s.name, 'Route ID': s.route_id, 'Stop Name': s.pickup_stop,
      'Event Type': method === 'QR' ? 'BOARDED_QR' : 'BOARDED_BLE',
      'Check-In Method': method === 'QR' ? 'QR_ROTATING' : `BLE_ROTATING${typeof rssi === 'number' ? ` (${Math.round(rssi)} dBm)` : ''}`,
      Notes: 'Server-verified gate token',
    });
    const trip = extras.getTripState(route);
    const nextHeadcount = Math.min(60, (trip.headcount || 0) + 1);
    extras.setTripState(route, trip.running, trip.delayMinutes, nextHeadcount);
    return { duplicate: false, headcount: nextHeadcount };
  });
  if (!result.duplicate) {
    broadcast('STUDENT_BOARDED', {
      rollNumber: s.roll_number,
      studentName: s.name,
      routeId: s.route_id,
      stopName: s.pickup_stop,
      method: method === 'QR' ? 'QR_ROTATING' : 'BLE_ROTATING',
      headcount: result.headcount,
      timestamp: Date.now()
    }, route);
    broadcast('STOP_BOARDED', { routeId: route, stopName: s.pickup_stop, count: 1, headcount: result.headcount }, route);
    if (extras.clearStopTimerIfNoPending(route, s.pickup_stop)) {
      broadcast('STOP_TIMER_CLEARED', { routeId: route, stopName: s.pickup_stop }, route);
    }
    void sendWebPush({
      roll: s.roll_number,
      title: 'Boarding Verified',
      body: `You have successfully boarded Route ${route}. Safe travels!`,
      url: '/'
    });
    void sendWebPush({
      roll: s.roll_number,
      userType: 'PARENT',
      title: 'Ward Boarded Bus',
      body: `Your ward ${s.name} (${s.roll_number}) has safely boarded bus ${route}.`,
      url: '/'
    });
  }
  res.json({ success: true, ...result });
});

app.post('/api/boarding/self-checkin', requireRole('STUDENT'), apiLimiter, (req, res) => {
  const s = extras.getStudentRow(req.user.sub);
  if (!s) throw new HttpError(401, 'Unknown student');
  if (!extras.canStudentTravel(s.roll_number)) {
    return res.status(403).json({
      success: false,
      code: 'PASS_INACTIVE',
      error: 'Bus pass is locked due to pending transport fee clearance. Clear dues or request an Emergency Grace Pass.',
    });
  }
  const route = normalizeRoute(s.route_id);
  const trip = extras.getTripState(route);
  if (!trip || !trip.running) {
    return res.status(409).json({
      success: false,
      error: 'Bus trip is not currently active.',
    });
  }
  const rawMethod = String(req.body?.method || 'STUDENT_SELF_TAP').trim().toUpperCase();
  const checkInMethod = rawMethod === 'BLE_PROXIMITY' ? 'BLE_PROXIMITY' : 'STUDENT_SELF_TAP';

  if (extras.isBoardedToday(s.roll_number, s.route_id)) {
    return res.json({
      success: true,
      duplicate: true,
      alreadyBoarded: true,
      boardingStatus: 'ON_BOARD',
      method: checkInMethod,
      headcount: trip.headcount,
      boardedCount: trip.headcount,
    });
  }

  const result = extras.tx(() => {
    if (extras.isBoardedToday(s.roll_number, s.route_id)) {
      const latest = extras.getTripState(route);
      return { duplicate: true, headcount: latest.headcount };
    }
    appendSheetRow('Boarding_Attendance', {
      Timestamp: now(),
      'Roll Number': s.roll_number,
      'Student Name': s.name,
      'Route ID': route,
      'Stop Name': s.pickup_stop || 'Stop',
      'Event Type': 'BOARDED_CONFIRMED',
      'Check-In Method': checkInMethod,
      Notes: 'Student self check-in',
    });
    const currentTrip = extras.getTripState(route);
    const newHeadcount = Math.min(60, (currentTrip.headcount || 0) + 1);
    extras.setTripState(route, true, currentTrip.delayMinutes, newHeadcount);
    return { duplicate: false, headcount: newHeadcount };
  });

  if (!result.duplicate) {
    broadcast('STUDENT_BOARDED', {
      rollNumber: s.roll_number,
      studentName: s.name,
      routeId: route,
      stopName: s.pickup_stop || 'Stop',
      method: checkInMethod,
      headcount: result.headcount,
      timestamp: Date.now(),
    }, route);
    broadcast('STOP_BOARDED', {
      routeId: route,
      stopName: s.pickup_stop || 'Stop',
      count: 1,
      headcount: result.headcount,
    }, route);
    if (extras.clearStopTimerIfNoPending(route, s.pickup_stop)) {
      broadcast('STOP_TIMER_CLEARED', { routeId: route, stopName: s.pickup_stop }, route);
    }
    void sendWebPush({
      roll: s.roll_number,
      title: 'Boarding Confirmed',
      body: `You confirmed boarding on ${route.replace('route-', 'Route ')}. Safe travels!`,
      url: '/',
    });
    void sendWebPush({
      roll: s.roll_number,
      userType: 'PARENT',
      title: 'Ward Boarded Bus',
      body: `Your ward ${s.name} (${s.roll_number}) confirmed boarding on ${route.replace('route-', 'Route ')}.`,
      url: '/',
    });
  }

  res.json({
    success: true,
    duplicate: result.duplicate,
    alreadyBoarded: result.duplicate,
    boardingStatus: 'ON_BOARD',
    method: checkInMethod,
    headcount: result.headcount,
    boardedCount: result.headcount,
  });
});

/* ---------------- live telemetry (DRIVER only, own route only, sanity-checked) ---------------- */
const liveBus = new Map();        // routeKey -> telemetry
const staleFlag = new Set();      // routeKeys currently flagged stale
const sseClients = new Set();     // { res, routeKey|null, sub }
const STALE_AFTER_MS = 90_000;
const usedStreamTickets = new Map(); // jti -> expiresAtMs

// Prune expired stream tickets every 60s
setInterval(() => {
  const now = Date.now();
  for (const [jti, exp] of usedStreamTickets) {
    if (now > exp) usedStreamTickets.delete(jti);
  }
}, 60_000).unref();

function broadcast(type, data, routeKey) {
  const msg = `data: ${JSON.stringify({ type, data })}\n\n`;
  for (const c of sseClients) {
    if (!c.routeKey || c.routeKey === routeKey) {
      if (c.res.writableEnded || c.res.destroyed || (c.res.writableLength ?? 0) > 65536) {
        try { c.res.end(); } catch {}
        sseClients.delete(c);
        continue;
      }
      try {
        c.res.write(msg);
      } catch {
        sseClients.delete(c);
      }
    }
  }
}

app.post('/api/bus/telemetry', requireRole('DRIVER'), telemetryLimiter, (req, res) => {
  const b = req.body ?? {};
  const routeKey = normalizeRoute(req.user.routeId);
  if (b.routeId && normalizeRoute(b.routeId) !== routeKey) throw new HttpError(403, 'You can only report for your own route');
  const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : d);
  const lat = num(b.lat, -90, 90, null), lng = num(b.lng, -180, 180, null);
  if (lat === null || lng === null) throw new HttpError(400, 'lat/lng out of range');
  const prev = liveBus.get(routeKey);
  if (prev) {
    const km = haversineKm(prev, { lat, lng }), hrs = (Date.now() - prev.updatedAt) / 3.6e6;
    if (km > 0.3 && hrs > 0 && km / hrs > 200) throw new HttpError(422, 'Position jump rejected');
  }
  const t = {
    routeId: routeKey, lat, lng, speedKmh: num(b.speedKmh, 0, 140, 0), heading: num(b.heading, 0, 360, 0),
    currentStopIndex: num(b.currentStopIndex, 0, 200, 0), delayMinutes: num(b.delayMinutes, -60, 600, 0),
    flyoverBypassActive: b.flyoverBypassActive === true, batteryPct: num(b.batteryPct, 0, 100, null),
    accuracyM: num(b.accuracyM, 0, 10_000, null), updatedAt: Date.now(), reportedBy: req.user.sub,
  };
  liveBus.set(routeKey, t);
  if (staleFlag.delete(routeKey)) broadcast('BUS_RECOVERED', { routeId: routeKey }, routeKey);
  broadcast('BUS_TELEMETRY', t, routeKey);
  res.json({ success: true });
});

app.get('/api/bus/telemetry/:routeId', requireAuth, apiLimiter, (req, res) => {
  const key = normalizeRoute(req.params.routeId);
  if (req.user.role !== 'ADMIN' && normalizeRoute(req.user.routeId) !== key) throw new HttpError(403, 'Not your route');
  const t = liveBus.get(key);
  if (!t) throw new HttpError(404, 'No live telemetry yet');
  res.json({ success: true, telemetry: t, stale: Date.now() - t.updatedAt > STALE_AFTER_MS });
});

// EventSource cannot send headers, so exchange the bearer token for a 2-minute, stream-scoped ticket.
app.post('/api/bus/stream-ticket', requireAuth, apiLimiter, (req, res) => {
  const ticket = signToken(
    { sub: req.user.sub, role: req.user.role, routeId: req.user.routeId, jti: crypto.randomUUID() },
    { ttlSec: 120, scope: 'stream' }
  );
  res.json({ ticket });
});
app.get('/api/bus/live-stream', (req, res) => {
  const u = verifyToken(String(req.query.ticket ?? ''), { scope: 'stream' });
  if (!u) return res.status(401).end();
  if (!u.jti || usedStreamTickets.has(u.jti)) return res.status(401).end();
  usedStreamTickets.set(u.jti, Date.now() + 125_000);

  if (sseClients.size >= 1000 || [...sseClients].filter((c) => c.sub === u.sub).length >= 3) return res.status(429).end();
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  const client = { res, sub: u.sub, routeKey: u.role === 'ADMIN' ? null : normalizeRoute(u.routeId) };
  sseClients.add(client);
  for (const [k, t] of liveBus) if (!client.routeKey || client.routeKey === k) res.write(`data: ${JSON.stringify({ type: 'BUS_TELEMETRY', data: t })}\n\n`);
  const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch { clearInterval(hb); sseClients.delete(client); } }, 15_000);
  req.on('close', () => { clearInterval(hb); sseClients.delete(client); });
});

// Dead-battery / dead-zone watchdog: no heartbeat for 90 s => tell clients and log it for the admin.
setInterval(() => {
  for (const [k, t] of liveBus) {
    if (Date.now() - t.updatedAt > STALE_AFTER_MS && !staleFlag.has(k)) {
      staleFlag.add(k);
      broadcast('BUS_STALE', { routeId: k, lastSeen: t.updatedAt, lastBatteryPct: t.batteryPct, lat: t.lat, lng: t.lng }, k);
      appendSheetRow('Alerts_Notifications', { Timestamp: now(), 'Alert ID': `STALE-${k}-${Date.now()}`, Category: 'TELEMETRY', Title: 'Bus went silent', Message: `${k} last seen ${Math.round((Date.now() - t.updatedAt) / 1000)}s ago, battery ${t.batteryPct ?? '?'}%`, 'Delivery Status': 'AUDIT' });
    }
  }
}, 30_000).unref();
setInterval(() => extras.pruneEvents(), 6 * 3600e3).unref();

/* ---------------- applications (persisted; students see only their own) ---------------- */
const APP_TYPES = new Set(['BUS_PASS_RENEWAL', 'ROUTE_CHANGE', 'FEE_GRACE_PERIOD', 'EXAM_SHUTTLE', 'FEE_CONCESSION']);
app.post('/api/applications', requireRole('STUDENT'), apiLimiter, (req, res) => {
  const b = req.body ?? {};
  const requestType = APP_TYPES.has(b.requestType) ? b.requestType : 'BUS_PASS_RENEWAL';
  const proofUrl = typeof b.proofUrl === 'string' && /^https:\/\//.test(b.proofUrl) ? b.proofUrl.slice(0, 500) : '';
  const id = `APP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  extras.saveApplication({ id, roll: req.user.sub, name: req.user.name, requestType, title: str(b.title ?? 'Transit Service Request', 120, 'title'),
    description: String(b.description ?? '').slice(0, 1000), proofUrl, requestedValue: String(b.requestedValue ?? '').slice(0, 200) });
  res.status(201).json({ success: true, application: extras.getApplication(id) });
});
app.get('/api/applications', requireRole('STUDENT', 'ADMIN'), apiLimiter, (req, res) =>
  res.json({ success: true, applications: extras.listApplications(req.user.role === 'ADMIN' ? null : req.user.sub) }));
app.post('/api/applications/:id/scrutiny', requireRole('ADMIN'), (req, res) => {
  if (!extras.getApplication(req.params.id)) throw new HttpError(404, 'Application not found');
  extras.reviewApplication(req.params.id, req.body?.status === 'APPROVED' ? 'APPROVED' : 'REJECTED', String(req.body?.adminNote ?? '').slice(0, 500), req.user.name);
  res.json({ success: true, application: extras.getApplication(req.params.id) });
});

/* ---------------- parent alerts via Telegram (templated server-side, chat id from DB) ---------------- */
const ALERTS = {
  PRE_ARRIVAL_10M: 'The bus is about 10 minutes from the pickup stop.',
  BOARDED: 'Has boarded the bus.',
  BOARDED_CONFIRMED: 'Has boarded the bus.',
  ARRIVED_CAMPUS: 'Has arrived at campus.',
  DELAY: 'The bus is running late.',
  BREAKDOWN: 'The bus has broken down; a replacement is being arranged.',
  OVERSLEEP_MISSED_STOP: 'May have missed their stop; the driver has been notified.',
  EARLY_EXIT: 'Has deboarded early at an unscheduled transit stop.',
  EMERGENCY: 'An emergency was reported on the bus. The transport office is responding.',
};
const STUDENT_ALERTS = new Set(['OVERSLEEP_MISSED_STOP', 'EARLY_EXIT']);

app.post('/api/alerts/notify-parent', requireRole('STUDENT', 'DRIVER', 'ADMIN'), alertLimiter, async (req, res) => {
  const category = String(req.body?.category ?? '');
  if (!ALERTS[category]) throw new HttpError(400, 'Unknown alert category');
  const roll = req.user.role === 'STUDENT' ? req.user.sub : str(req.body?.studentRoll, 20, 'studentRoll').toUpperCase();
  if (req.user.role === 'STUDENT' && !STUDENT_ALERTS.has(category)) throw new HttpError(403, 'Not allowed');
  const s = extras.getStudentRow(roll);
  if (!s) throw new HttpError(404, 'Student not found');
  if (req.user.role === 'DRIVER' && normalizeRoute(s.route_id) !== normalizeRoute(req.user.routeId)) throw new HttpError(403, 'Student is not on your bus');
  const note = req.user.role === 'STUDENT' ? '' : String(req.body?.note ?? '').slice(0, 200);
  const html = `<b>🚌 Sreenidhi Express · Safety Alert</b>\n\n<b>Student:</b> ${escapeHtml(s.name)} (${escapeHtml(s.roll_number)})\n${escapeHtml(ALERTS[category])}` + (note ? `\n\n<i>${escapeHtml(note)}</i>` : '');
  const tg = await sendTelegramAlert(s.telegram_chat_id, html);
  appendSheetRow('Parent_Alerts_Log', {
    Timestamp: now(), 'Alert ID': `ALERT-${Date.now()}`, 'Recipient Name': s.parent_name, 'Recipient Phone': s.parent_phone,
    Category: category, Title: category, Message: ALERTS[category], 'Delivery Status': tg.mode === 'LIVE_DELIVERED' ? 'DELIVERED_TELEGRAM' : tg.mode,
  });

  // Notify driver cabin immediately for critical anomalies (oversleep, early exit, emergency)
  if (['OVERSLEEP_MISSED_STOP', 'EARLY_EXIT', 'EMERGENCY'].includes(category)) {
    broadcast('STUDENT_SAFETY_ALERT', {
      routeId: s.route_id,
      rollNumber: s.roll_number,
      studentName: s.name,
      category,
      message: ALERTS[category],
      timestamp: Date.now(),
    }, s.route_id);
    extras.createIncident(
      'SAFETY_ANOMALY',
      s.name,
      s.route_id,
      `Safety Alert: ${category} for ${s.name} (${s.roll_number})`
    );
  }

  // Record in-app & WhatsApp mobile notification for parents
  const alertTitle = category.replace(/_/g, ' ');
  const alertMsg = ALERTS[category] + (note ? ` - ${note}` : '');
  try {
    extras.logNotification({
      ts: Date.now(),
      recipient_type: 'PARENT',
      roll_number: s.roll_number,
      phone_number: s.parent_phone,
      category,
      title: alertTitle,
      message: alertMsg,
      channel: 'APP_AND_WHATSAPP',
      status: 'DELIVERED',
    });
  } catch (err) {
    console.error('[notify-parent] Failed to record mobile notification:', err);
  }
  broadcast('PARENT_ALERT', { studentRoll: s.roll_number, category, title: alertTitle, message: alertMsg }, normalizeRoute(s.route_id));
  void sendWebPush({
    roll: s.roll_number,
    userType: 'PARENT',
    title: `Sreenidhi Express: ${alertTitle}`,
    body: alertMsg,
    url: '/'
  });

  res.status(tg.success ? 200 : 502).json({ success: tg.success, delivered: tg.mode === 'LIVE_DELIVERED', mode: tg.mode });
});

app.post('/api/notifications/parent-test', requireRole('PARENT', 'STUDENT', 'ADMIN'), alertLimiter, (req, res) => {
  let roll = '';
  if (req.user.role === 'ADMIN' && req.body?.rollNumber) {
    roll = str(req.body.rollNumber, 20, 'rollNumber').toUpperCase();
  } else {
    roll = resolveStudentRoll(req.user);
  }
  const s = extras.getStudentRow(roll);
  if (!s) throw new HttpError(404, 'Student not found');
  const cleanPhone = String(s.parent_phone || '').replace(/\D/g, '').slice(-10);
  const message = `Sreenidhi Express Transport Alert: Live bus tracking and arrival updates for student ${s.name} (${s.roll_number}) on ${s.route_id}. View status: ${process.env.APP_URL || 'http://localhost:3001'}`;
  const notifId = extras.logNotification({
    ts: Date.now(),
    recipient_type: 'PARENT',
    roll_number: s.roll_number,
    phone_number: s.parent_phone,
    category: 'PARENT_NOTIFICATION',
    title: 'Parent Transport Alert',
    message,
    status: 'DELIVERED',
    channel: 'APP_AND_WHATSAPP',
  });
  const whatsappUrl = cleanPhone ? `https://wa.me/91${cleanPhone}?text=${encodeURIComponent(message)}` : null;
  const notification = {
    id: notifId,
    ts: Date.now(),
    recipient_type: 'PARENT',
    roll_number: s.roll_number,
    phone_number: s.parent_phone,
    category: 'PARENT_NOTIFICATION',
    title: 'Parent Transport Alert',
    message,
    status: 'DELIVERED',
    channel: 'APP_AND_WHATSAPP',
  };
  res.json({ success: true, notification, whatsappUrl });
});

app.post('/api/students/me/parent-link-code', requireAuth, requireRole('STUDENT', 'PARENT'), alertLimiter, (req, res) => {
  const targetRoll = resolveStudentRoll(req.user);
  if (!targetRoll) throw new HttpError(400, 'Student roll required');
  const code = extras.createLinkCode(targetRoll);
  const bot = process.env.TELEGRAM_BOT_USERNAME || 'SreenidhiTransitBot';
  res.json({ code, expiresInHours: 24, deepLink: `https://t.me/${bot}?start=${code}` });
});
// Register once:  curl "https://api.telegram.org/bot$TOKEN/setWebhook" -d url=https://YOUR_HOST/api/telegram/webhook -d secret_token=$TELEGRAM_WEBHOOK_SECRET
app.post('/api/telegram/webhook', async (req, res) => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
  const got = String(req.headers['x-telegram-bot-api-secret-token'] ?? '');
  if (!secret || got.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(secret))) return res.status(401).end();
  const msg = req.body?.message;
  const m = /^\/start\s+([A-Fa-f0-9]{10})$/.exec(msg?.text ?? '');
  if (m && msg.chat?.id) {
    const roll = extras.consumeLinkCode(m[1], msg.chat.id);
    await sendTelegramAlert(String(msg.chat.id), roll ? '✅ Linked. You will now receive safety alerts for your ward.' : '⚠️ That link code is invalid or expired. Ask your ward to generate a new one in the app.');
  }
  res.json({ ok: true });
});

/* ---------------- Trip State Machine & Driver Quick Delay ---------------- */
function getTodayStr() {
  // Explicit Asia/Kolkata date policy (UTC + 5:30)
  const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
  return istNow.toISOString().slice(0, 10);
}

function getTomorrowStr() {
  // Explicit Asia/Kolkata date policy (UTC + 5:30)
  const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
  istNow.setUTCDate(istNow.getUTCDate() + 1);
  return istNow.toISOString().slice(0, 10);
}

function toCsvString(headers, rows) {
  const esc = (v) => {
    let s = String(v ?? '');
    // Neutralize spreadsheet formula injection characters (=, +, -, @, tabs)
    if (/^[=+\-@\t\r]/.test(s)) {
      s = "'" + s;
    }
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n') + '\r\n';
}

app.post('/api/bus/trip', requireRole('DRIVER', 'ADMIN'), (req, res) => {
  const rId = req.user.role === 'ADMIN' && req.body?.routeId 
    ? normalizeRoute(req.body.routeId) 
    : normalizeRoute(req.user.routeId || 'route-51');
  const running = Boolean(req.body?.running);
  const st = extras.getTripState(rId);
  const updatedDelay = running ? st.delayMinutes : 0;
  const startedAtIso = running && !st.running ? new Date().toISOString() : undefined;
  const updatedState = extras.setTripState(rId, running, updatedDelay, st.headcount, startedAtIso);
  if (running && !st.running) {
    const istStart = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
    appendSheetRow('Driver_Trip_Logs', {
      Timestamp: now(),
      'Route ID': rId,
      'Driver Name': req.user.name || `Driver (${rId})`,
      Direction: 'TRIP_START',
      Notes: `Started at ${istStart} IST (${startedAtIso})`,
    });
  }
  const msg = running ? `Bus trip for ${rId} has started from departure terminal.` : `Bus trip for ${rId} completed/paused by driver.`;
  extras.createAnnouncement(rId, msg);
  // Log e-commerce style mobile push notification
  extras.logNotification({
    recipient_type: 'ALL',
    category: running ? 'TRIP_STARTED' : 'CAMPUS_ARRIVED',
    title: running ? `🚀 Trip Started: ${rId.replace('route-', 'Route ')} En Route` : `🏫 Trip Completed: Reached SNIST`,
    message: running 
      ? `${rId.replace('route-', 'Route ')} bus has departed Erragadda terminal. Live tracking is active. Estimated arrival at campus: 08:35 AM.` 
      : `${rId.replace('route-', 'Route ')} bus has safely completed its trip and arrived at Sreenidhi University Campus.`,
    channel: 'IN_APP_SMS',
    status: 'DELIVERED'
  });
  const pushTitle = running ? `🚀 Trip Started: ${rId.replace('route-', 'Route ')}` : `🏫 Trip Ended: ${rId.replace('route-', 'Route ')}`;
  const pushBody = running 
    ? `Bus on ${rId.replace('route-', 'Route ')} has departed. Live tracking is active.` 
    : `Bus on ${rId.replace('route-', 'Route ')} completed its trip.`;
  void sendWebPush({ routeId: rId, title: pushTitle, body: pushBody, url: '/' });
  broadcast('BUS_TRIP', { routeId: rId, running, delayMinutes: updatedDelay, startedAt: updatedState.startedAt }, rId);
  res.json({ success: true, running, routeId: rId, startedAt: updatedState.startedAt });
});

app.post('/api/bus/stop-dwell', requireRole('DRIVER'), telemetryLimiter, (req, res) => {
  const b = req.body ?? {};
  const stopId = str(b.stopId, 80, 'stopId');
  const stopName = str(b.stopName, 120, 'stopName');
  const arrivedAt = str(b.arrivedAt, 64, 'arrivedAt');
  const departedAt = str(b.departedAt, 64, 'departedAt');
  const dwellSec = Number(b.dwellSec);
  if (!Number.isFinite(dwellSec) || dwellSec < 0 || dwellSec > 3600) {
    throw new HttpError(400, 'dwellSec must be a finite number between 0 and 3600');
  }
  const routeKey = normalizeRoute(req.user.routeId || 'route-51');
  const saved = extras.recordStopDwell(routeKey, stopId, stopName, arrivedAt, departedAt, dwellSec);
  res.json({ success: true, flag: saved.flag, dwellSec: saved.dwellSec });
});

app.post('/api/bus/delay', requireRole('DRIVER', 'ADMIN'), (req, res) => {
  const rId = req.user.role === 'ADMIN' && req.body?.routeId 
    ? normalizeRoute(req.body.routeId) 
    : normalizeRoute(req.user.routeId || 'route-51');
  const delayMinutes = Math.max(0, Math.min(120, Number(req.body?.delayMinutes) || 0));
  const st = extras.getTripState(rId);
  extras.setTripState(rId, st.running, delayMinutes, st.headcount);
  if (delayMinutes > 0) {
    const msg = `Traffic Delay Notice: ${rId.replace('route-', 'Route ')} is running +${delayMinutes} minutes behind schedule due to highway congestion.`;
    extras.createAnnouncement(rId, msg);
    extras.logNotification({
      recipient_type: 'ALL',
      category: 'DELAY',
      title: `⚠️ Highway Traffic Delay: +${delayMinutes}m`,
      message: `${rId.replace('route-', 'Route ')} is running +${delayMinutes} minutes behind schedule due to traffic congestion near Uppal Ring Road. Live countdown ETA updated.`,
      channel: 'IN_APP_SMS',
      status: 'DELIVERED'
    });
    void sendWebPush({
      routeId: rId,
      title: `⚠️ Traffic Delay: +${delayMinutes}m`,
      body: `${rId.replace('route-', 'Route ')} is running +${delayMinutes}m behind schedule.`,
      url: '/'
    });
  }
  broadcast('BUS_DELAY', { routeId: rId, delayMinutes }, rId);
  res.json({ success: true, delayMinutes, routeId: rId });
});

app.post('/api/driver/board-stop', requireRole('DRIVER'), (req, res) => {
  const rId = normalizeRoute(req.user.routeId || 'route-51');
  const stopName = str(req.body?.stopName || 'Current Stop', 80, 'stopName');
  const studentsList = Array.isArray(req.body?.students) ? req.body.students : [];
  const accepted = [];
  if (studentsList.length > 0) {
    for (const stu of studentsList) {
      const roll = String(stu.rollNumber || '').trim().toUpperCase();
      if (!roll) continue;
      const sRow = extras.getStudentRow(roll);
      if (!sRow || normalizeRoute(sRow.route_id) !== rId || !sameStopName(sRow.pickup_stop, stopName)) {
        continue; // reject invalid or off-route roll numbers
      }
      if (extras.isBoardedToday(roll, rId)) {
        continue; // idempotent: already boarded today on this route
      }
      appendSheetRow('Boarding_Attendance', {
        Timestamp: now(), 
        'Roll Number': roll,
        'Student Name': sRow.name,
        'Route ID': rId, 
        'Stop Name': stopName,
        'Event Type': 'BOARDED_DRIVER_CONFIRMED',
        'Check-In Method': 'DRIVER_CABIN_ROSTER',
        Notes: `Driver checked-in ${sRow.name} (${roll}) at ${stopName}`
      });
      accepted.push({ roll, name: sRow.name });
      broadcast('STUDENT_BOARDED', {
        rollNumber: roll,
        studentName: sRow.name,
        routeId: rId,
        stopName,
        method: 'DRIVER_CABIN_ROSTER',
        timestamp: Date.now()
      }, rId);
    }
  } else {
    const count = Math.max(0, Math.min(60, Number(req.body?.count) || 0));
    if (count === 0) return res.json({ success: true, routeId: rId, headcount: extras.getTripState(rId).headcount, boardedRollNumbers: [] });
    appendSheetRow('Boarding_Attendance', {
      Timestamp: now(), 'Roll Number': `BATCH-${Date.now()}`, 'Student Name': `Batch Boarding (${count} riders)`,
      'Route ID': rId, 'Stop Name': stopName,
      'Event Type': 'BATCH_BOARDED', 'Check-In Method': 'DRIVER_CABIN_STEPPER',
      Notes: `Driver checked-in ${count} passengers at ${stopName}`
    });
    for (let i = 0; i < count; i++) accepted.push({ roll: null, name: null });
  }
  const count = accepted.length;
  const st = extras.getTripState(rId);
  const newHeadcount = Math.min(60, (st.headcount || 0) + count);
  extras.setTripState(rId, st.running, st.delayMinutes, newHeadcount);
  if (extras.clearStopTimerIfNoPending(rId, stopName)) {
    broadcast('STOP_TIMER_CLEARED', { routeId: rId, stopName }, rId);
  }
  broadcast('STOP_BOARDED', { routeId: rId, stopName, count, headcount: newHeadcount }, rId);
  res.json({ success: true, routeId: rId, headcount: newHeadcount, boardedRollNumbers: accepted.map((s) => s.roll).filter(Boolean) });
});

/* ---------------- Shared Real-Time Stop Countdown Timers & Live Opt-Outs (Durable SQLite) ---------------- */
app.post('/api/trips/timer', requireRole('DRIVER'), (req, res) => {
  const rId = normalizeRoute(req.user.routeId || 'route-51');
  const stopName = str(req.body?.stopName || 'Stop', 80, 'stopName');
  const durationSeconds = Math.max(10, Math.min(300, Number(req.body?.durationSeconds) || 120));
  const timer = extras.setStopTimer(rId, stopName, durationSeconds);
  broadcast('STOP_TIMER_STARTED', { routeId: rId, stopName, durationSeconds, startedAt: timer.startedAt }, rId);
  res.json({ success: true, routeId: rId, stopName, durationSeconds, startedAt: timer.startedAt });
});

app.post('/api/trips/clear-timer', requireRole('DRIVER'), (req, res) => {
  const rId = normalizeRoute(req.user.routeId || 'route-51');
  extras.clearStopTimer(rId);
  broadcast('STOP_TIMER_CLEARED', { routeId: rId }, rId);
  res.json({ success: true, routeId: rId });
});

app.get('/api/trips/timer/:routeId', requireAuth, (req, res) => {
  const rId = normalizeRoute(req.params.routeId);
  if (req.user.role !== 'ADMIN' && normalizeRoute(rId) !== normalizeRoute(req.user.routeId)) {
    throw new HttpError(403, 'Forbidden: You can only view stop timers for your assigned route');
  }
  const timer = extras.getStopTimer(rId);
  if (!timer) return res.json({ success: true, active: false });
  // A route may have many stops. Students and parents should see the timer
  // only when the bus is at their own pickup stop.
  if (req.user.role === 'STUDENT' || req.user.role === 'PARENT') {
    const roll = req.user.role === 'PARENT' ? req.user.wardRoll : req.user.sub;
    const student = extras.getStudentRow(roll);
    if (!student || !sameStopName(student.pickup_stop, timer.stopName)) {
      return res.json({ success: true, active: false });
    }
  }
  res.json({ success: true, active: true, stopName: timer.stopName, remainingSeconds: timer.remainingSeconds, startedAt: timer.startedAt });
});

app.post('/api/trips/opt-out', requireRole('STUDENT'), (req, res) => {
  const rId = normalizeRoute(req.user.routeId || 'route-51');
  const note = str(req.body?.note || 'Skipping stop today', 200, 'note');
  const s = extras.getStudentRow(req.user.sub);
  if (!s || normalizeRoute(s.route_id) !== rId) throw new HttpError(403, 'Student is not assigned to this route');
  appendSheetRow('Boarding_Attendance', {
    Timestamp: now(), 'Roll Number': req.user.sub,
    'Student Name': req.user.name || s?.name || 'Student',
    'Route ID': rId, 'Stop Name': s?.pickup_stop || 'Stop',
    'Event Type': 'NOT_COMING_OPT_OUT',
    'Check-In Method': 'STUDENT_PORTAL_TAP',
    Notes: note
  });
  broadcast('STUDENT_OPT_OUT', {
    rollNumber: req.user.sub,
    studentName: req.user.name || s?.name || 'Student',
    routeId: rId,
    stopName: s?.pickup_stop,
    note,
    timestamp: Date.now()
  }, rId);
  if (extras.clearStopTimerIfNoPending(rId, s.pickup_stop)) {
    broadcast('STOP_TIMER_CLEARED', { routeId: rId, stopName: s.pickup_stop }, rId);
  }
  res.json({ success: true, rollNumber: req.user.sub, routeId: rId, note });
});

app.get('/api/bus/state/:routeId', requireAuth, (req, res) => {
  const rId = normalizeRoute(req.params.routeId);
  if (req.user.role !== 'ADMIN' && normalizeRoute(rId) !== normalizeRoute(req.user.routeId)) {
    throw new HttpError(403, 'Forbidden: You can only view bus state for your assigned route');
  }
  const st = extras.getTripState(rId);
  const tomorrow = getTomorrowStr();
  const plan = extras.computeRouteOptimization(rId, tomorrow);
  res.json({
    success: true,
    ...st,
    assignedCount: plan.totalRouteStudents,
    absentTomorrowCount: plan.absentRouteStudents,
    expectedTomorrow: plan.expectedRouteStudents,
    skippedClusterIds: plan.skippedClusterIds,
    hasRosterData: plan.totalRouteStudents > 0,
    routePlan: plan,
  });
});

/* ---------------- Digital Bus Pass & 1-Day Grace Activation ---------------- */
app.get('/api/students/me/pass', requireRole('STUDENT', 'PARENT'), (req, res) => {
  const roll = resolveStudentRoll(req.user);
  const row = extras.getStudentRow(roll);
  if (!row) return res.status(404).json({ error: 'Student not found' });
  const graceUntil = row.grace_until || 0;
  const isGraceActive = graceUntil > Date.now();
  const feePaid = (row.fee_status || 'PAID').toUpperCase() === 'PAID';
  const passActive = (row.pass_status || 'ACTIVE').toUpperCase() === 'ACTIVE';
  const canTravel = (feePaid && passActive) || isGraceActive;
  res.json({
    success: true,
    rollNumber: row.roll_number,
    name: row.name,
    feeStatus: row.fee_status || 'PAID',
    passStatus: row.pass_status || 'ACTIVE',
    graceUntil,
    isGraceActive,
    canTravel,
  });
});

app.post('/api/students/grace', requireRole('STUDENT', 'PARENT'), (req, res) => {
  const roll = resolveStudentRoll(req.user);
  const result = extras.activateGracePass(roll);
  if (!result.success) {
    return res.status(400).json({ success: false, error: result.error });
  }
  appendSheetRow('Alerts_Notifications', {
    Timestamp: now(), 'Alert ID': `GRC-${Date.now()}`, 'Recipient Name': req.user.name,
    Category: 'TRANSIT_PASS', Title: '1-Day Grace Pass Activated',
    Message: `Emergency 24-hr grace pass active for ${roll} until ${new Date(result.graceUntil).toLocaleString('en-IN')}`,
    'Delivery Status': 'ACTIVE',
  });
  res.json({ success: true, graceUntil: result.graceUntil, validUntilText: new Date(result.graceUntil).toLocaleString('en-IN') });
});

app.post('/api/admin/fee', requireRole('ADMIN'), (req, res) => {
  const roll = str(req.body?.rollNumber, 20, 'rollNumber').toUpperCase();
  const status = String(req.body?.status || 'PAID').toUpperCase() === 'PAID' ? 'PAID' : 'DUE';
  extras.setFeeStatus(roll, status);
  res.json({ success: true, rollNumber: roll, feeStatus: status });
});

/* ---------------- Strict Dynamic Route Optimization & Absences ---------------- */
const ABSENCE_CUTOFF_BEFORE_DEPARTURE_MIN = Number(process.env.ABSENCE_CUTOFF_BEFORE_DEPARTURE_MIN) || 60; // 1 hour before departure

function getFirstDepartureUtcMs(routeId, dayStr) {
  try {
    const parts = String(dayStr || '').split('-').map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
    const [y, m, d] = parts;
    const norm = normalizeRoute(routeId);
    const stops = getRouteStops(norm);
    let depHour = 7;
    let depMin = norm === 'route-51' ? 5 : 0;
    const sched = stops?.[0]?.scheduledMorningTime;
    if (typeof sched === 'string') {
      const match = sched.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
      if (match) {
        let h = Number(match[1]);
        const min = Number(match[2]);
        const meridiem = (match[3] || '').toUpperCase();
        if (meridiem === 'PM' && h < 12) h += 12;
        if (meridiem === 'AM' && h === 12) h = 0;
        if (Number.isFinite(h) && Number.isFinite(min)) {
          depHour = h;
          depMin = min;
        }
      }
    }
    return Date.UTC(y, m - 1, d, 0, 0, 0) + (depHour * 3600 + depMin * 60 - 5.5 * 3600) * 1000;
  } catch {
    return null;
  }
}

function getPlanLockStatus(routeId, day) {
  const plan = extras.getRoutePlan(routeId, day);
  if (plan && plan.locked === 1) return { locked: true, reason: 'ADMIN_LOCKED' };
  if (day === getTodayStr()) {
    const trip = extras.getTripState(routeId);
    if (trip && trip.running) return { locked: true, reason: 'TRIP_RUNNING' };
  }
  const depUtcMs = getFirstDepartureUtcMs(routeId, day);
  if (depUtcMs !== null) {
    // Cutoff is ABSENCE_CUTOFF_BEFORE_DEPARTURE_MIN (60 min) prior to first bus departure
    const cutoffUtcMs = depUtcMs - ABSENCE_CUTOFF_BEFORE_DEPARTURE_MIN * 60 * 1000;
    if (Date.now() >= cutoffUtcMs) return { locked: true, reason: 'CUTOFF_PASSED' };
  }
  return { locked: false, reason: null };
}

function isPlanLocked(routeId, day) {
  return getPlanLockStatus(routeId, day).locked;
}

function resolveAbsenceDay(rawDay) {
  const val = typeof rawDay === 'string' ? rawDay.trim() : '';
  if (val.toUpperCase() === 'TODAY') return getTodayStr();
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  return getTomorrowStr();
}

app.post('/api/students/absence', requireRole('STUDENT', 'PARENT'), (req, res) => {
  const roll = resolveStudentRoll(req.user);
  const on = Boolean(req.body?.on);
  const day = resolveAbsenceDay(req.body?.day);
  const student = extras.getStudentRow(roll);
  if (!student) throw new HttpError(404, 'Student not found');
  const routeId = student.route_id;

  // Enforce 1-hour pre-departure cutoff lock (or locked/active route plan)
  const lockStatus = getPlanLockStatus(routeId, day);
  if (lockStatus.locked) {
    const currentPlan = extras.computeRouteOptimization(routeId, day);
    if (!on && student.area_cluster_id && currentPlan.skippedClusterIds.includes(student.area_cluster_id)) {
      return res.status(409).json({
        error: "This trip's route is already locked and your area cluster is bypassed. Contact the Transport Office to restore your stop.",
        locked: true,
        lockReason: lockStatus.reason,
        cutoffMinutesBeforeDeparture: ABSENCE_CUTOFF_BEFORE_DEPARTURE_MIN,
      });
    }
    const lockedMsg =
      lockStatus.reason === 'ADMIN_LOCKED'
        ? 'Route plan is locked by the Transport Office. Contact Admin to unlock.'
        : `Changes closed: cutoff is ${ABSENCE_CUTOFF_BEFORE_DEPARTURE_MIN} minutes before bus departure. Contact the Transport Office for urgent updates.`;
    return res.status(409).json({
      error: lockedMsg,
      locked: true,
      lockReason: lockStatus.reason,
      cutoffMinutesBeforeDeparture: ABSENCE_CUTOFF_BEFORE_DEPARTURE_MIN,
    });
  }

  extras.setAbsence(roll, day, on);
  const plan = extras.computeRouteOptimization(routeId, day);
  const depUtcMs = getFirstDepartureUtcMs(routeId, day);
  const postLockStatus = getPlanLockStatus(routeId, day);
  broadcast('route_plan_updated', { routeId: normalizeRoute(routeId), day, plan }, normalizeRoute(routeId));
  broadcast('ROUTE_PLAN_UPDATED', { routeId: normalizeRoute(routeId), day, plan }, normalizeRoute(routeId));
  res.json({
    success: true,
    rollNumber: roll,
    day,
    absentTomorrow: on,
    absent: on,
    locked: postLockStatus.locked,
    lockReason: postLockStatus.reason,
    cutoffMinutesBeforeDeparture: ABSENCE_CUTOFF_BEFORE_DEPARTURE_MIN,
    cutoffIso: depUtcMs ? new Date(depUtcMs - ABSENCE_CUTOFF_BEFORE_DEPARTURE_MIN * 60 * 1000).toISOString() : null,
    routePlan: plan,
  });
});

app.get('/api/students/absence', requireRole('STUDENT', 'PARENT'), (req, res) => {
  const roll = resolveStudentRoll(req.user);
  const day = resolveAbsenceDay(req.query?.day);
  const absent = extras.isAbsent(roll, day);
  const student = extras.getStudentRow(roll);
  const routeId = student?.route_id || 'route-51';
  const plan = student ? extras.computeRouteOptimization(routeId, day) : null;
  const depUtcMs = getFirstDepartureUtcMs(routeId, day);
  const lockStatus = student ? getPlanLockStatus(routeId, day) : { locked: false, reason: null };
  res.json({
    success: true,
    rollNumber: roll,
    day,
    absentTomorrow: absent,
    absent,
    locked: lockStatus.locked,
    lockReason: lockStatus.reason,
    cutoffMinutesBeforeDeparture: ABSENCE_CUTOFF_BEFORE_DEPARTURE_MIN,
    cutoffIso: depUtcMs ? new Date(depUtcMs - ABSENCE_CUTOFF_BEFORE_DEPARTURE_MIN * 60 * 1000).toISOString() : null,
    routePlan: plan,
  });
});

app.get('/api/routes/:routeId/optimization', requireRole('STUDENT', 'PARENT', 'DRIVER', 'ADMIN'), (req, res) => {
  const rId = normalizeRoute(req.params.routeId);
  if (req.user.role !== 'ADMIN' && normalizeRoute(req.user.routeId) !== rId) {
    throw new HttpError(403, 'Forbidden: You can only view optimization for your assigned route');
  }
  const day = req.query?.day && typeof req.query.day === 'string' ? req.query.day.trim() : getTomorrowStr();
  const plan = extras.computeRouteOptimization(rId, day);
  res.json({ success: true, ...plan });
});

app.post('/api/admin/routes/:routeId/optimization-control', requireRole('ADMIN'), async (req, res) => {
  const rId = normalizeRoute(req.params.routeId);
  const day = req.body?.day && typeof req.body.day === 'string' ? req.body.day.trim() : getTomorrowStr();
  const action = str(req.body?.action, 40, 'action').toUpperCase();
  const clusterId = req.body?.clusterId ? String(req.body.clusterId).trim() : null;

  let plan;
  if (action === 'LOCK') {
    plan = extras.setRoutePlanLock(rId, day, true);
  } else if (action === 'UNLOCK') {
    plan = extras.setRoutePlanLock(rId, day, false);
  } else if (action === 'OVERRIDE_KEEP_CLUSTER' && clusterId) {
    plan = extras.setClusterOverride(rId, day, clusterId, true);
  } else if (action === 'CLEAR_OVERRIDE' && clusterId) {
    plan = extras.setClusterOverride(rId, day, clusterId, false);
  } else {
    throw new HttpError(400, 'Invalid optimization control action');
  }

  broadcast('route_plan_updated', { routeId: rId, day, plan }, rId);
  broadcast('ROUTE_PLAN_UPDATED', { routeId: rId, day, plan }, rId);

  // When LOCK is triggered (or trip started) with active skips, send Telegram alert to downstream students
  if (action === 'LOCK' && plan.skippedClusterIds.length > 0) {
    try {
      const skippedNames = plan.clusters
        .filter((c) => plan.skippedClusterIds.includes(c.areaClusterId))
        .map((c) => c.areaClusterName)
        .join(', ');

      const allStops = getRouteStops(rId);
      const skippedStops = allStops.filter((s) => plan.skippedClusterIds.includes(s.areaClusterId));
      const firstSkippedSeq = skippedStops.length > 0 ? Math.min(...skippedStops.map((s) => s.sequence)) : 999;
      const downstream = extras.listStudentsForRoute(rId).filter((s) => {
        const st = allStops.find((x) => x.id === s.stop_id);
        return st && st.sequence > firstSkippedSeq && !plan.skippedClusterIds.includes(s.area_cluster_id);
      });

      for (const s of downstream) {
        if (s.telegram_chat_id) {
          await sendTelegramAlert(
            s.telegram_chat_id,
            `⚡ Earlier Pickup Alert (Tomorrow): ${skippedNames} has 0 riders and is bypassed. The bus is running express and may arrive ~${plan.estimatedMinutesSaved} mins earlier at your stop (${s.pickup_stop}). Please be ready early!`
          );
        }
      }
    } catch (err) {
      console.warn('[OptimizationControl] Telegram notification error (non-fatal):', err);
    }
  }

  res.json({ success: true, action, plan });
});

app.get('/api/routes/:routeId/expected-headcount', requireRole('DRIVER', 'ADMIN'), (req, res) => {
  const rId = normalizeRoute(req.params.routeId);
  if (req.user.role === 'DRIVER' && normalizeRoute(rId) !== normalizeRoute(req.user.routeId)) {
    throw new HttpError(403, 'Forbidden: You can only view headcount for your assigned route');
  }
  const day = req.query?.day && typeof req.query.day === 'string' ? req.query.day.trim() : getTomorrowStr();
  const plan = extras.computeRouteOptimization(rId, day);
  res.json({
    success: true,
    routeId: rId,
    day,
    absentCount: plan.absentRouteStudents,
    expectedCount: plan.expectedRouteStudents,
    assignedCount: plan.totalRouteStudents,
    skippedClusterIds: plan.skippedClusterIds,
    routePlan: plan,
  });
});

/* ---------------- Incidents (SOS & Breakdown) ---------------- */
app.get('/api/incidents', requireRole('STUDENT', 'PARENT', 'DRIVER', 'ADMIN'), (req, res) => {
  const openOnly = req.query?.open !== 'false';
  const list = extras.listIncidents(openOnly);
  const filtered = req.user.role === 'ADMIN'
    ? list
    : list.filter((i) => !i.route_id || i.route_id === 'ALL' || normalizeRoute(i.route_id) === normalizeRoute(req.user.routeId));
  res.json({ success: true, incidents: filtered });
});

app.post('/api/incidents', requireRole('STUDENT', 'PARENT', 'DRIVER', 'ADMIN'), (req, res) => {
  const kind = str(req.body?.kind, 30, 'kind').toUpperCase();
  const msg = str(req.body?.msg || 'Emergency Alert reported', 280, 'msg');
  const routeId = req.user.role === 'ADMIN' && req.body?.routeId
    ? normalizeRoute(req.body.routeId)
    : normalizeRoute(req.user.routeId || 'route-51');
  const id = extras.createIncident(kind, req.user.name || req.user.sub, routeId, msg);
  appendSheetRow('Alerts_Notifications', {
    Timestamp: now(), 'Alert ID': `INC-${Date.now()}`, 'Recipient Name': 'Transport Operations & Parents',
    Category: kind === 'SOS' ? 'EMERGENCY_SOS' : 'VEHICLE_BREAKDOWN', Title: `${kind} Incident Reported`,
    Message: `${msg} (Reported by ${req.user.name} on ${routeId})`, 'Delivery Status': 'BROADCAST',
  });
  res.json({ success: true, incidentId: id });
});

app.post('/api/incidents/:id/resolve', requireRole('ADMIN'), (req, res) => {
  const id = Number(req.params.id);
  const ok = extras.resolveIncident(id);
  res.json({ success: ok, resolvedId: id });
});

/* ---------------- Announcements ---------------- */
app.get('/api/announcements', requireRole('STUDENT', 'PARENT', 'DRIVER', 'ADMIN'), (req, res) => {
  const rId = req.query?.routeId ? normalizeRoute(req.query.routeId) : null;
  res.json({ success: true, announcements: extras.listAnnouncements(rId) });
});

app.post('/api/announcements', requireRole('ADMIN', 'DRIVER'), (req, res) => {
  const msg = str(req.body?.msg, 280, 'msg');
  const rId = req.user.role === 'DRIVER' 
    ? normalizeRoute(req.user.routeId || 'route-51') 
    : (req.body?.routeId ? normalizeRoute(req.body.routeId) : 'ALL');
  const id = extras.createAnnouncement(rId, msg);
  extras.logNotification({
    recipient_type: 'ALL',
    category: 'EMERGENCY',
    title: '📢 Transport Control Announcement',
    message: msg,
    channel: 'IN_APP_SMS',
    status: 'DELIVERED'
  });
  res.json({ success: true, announcementId: id });
});

/* ---------------- Mobile Phone & OTP Verification Endpoints ---------------- */
app.get('/api/users/contact', requireRole('STUDENT', 'PARENT', 'ADMIN'), (req, res) => {
  const roll = req.user.role === 'PARENT' 
    ? req.user.wardRoll 
    : (req.user.role === 'ADMIN' && req.query?.rollNumber ? String(req.query.rollNumber).toUpperCase() : req.user.sub);
  const s = extras.getStudentRow(roll);
  if (!s) return res.status(404).json({ error: 'Student record not found' });
  res.json({
    success: true,
    rollNumber: s.roll_number,
    studentName: s.name,
    studentPhone: s.student_phone || '',
    studentPhoneVerified: Boolean(s.student_phone_verified),
    parentName: s.parent_name || '',
    parentPhone: s.parent_phone || '',
    parentPhoneVerified: Boolean(s.parent_phone_verified)
  });
});

function getOtpTarget(req) {
  const requestedType = String(req.body?.userType || '').toUpperCase();
  const userType = req.user.role === 'ADMIN'
    ? requestedType
    : req.user.role;
  const roll = req.user.role === 'PARENT'
    ? req.user.wardRoll
    : req.user.role === 'ADMIN'
      ? String(req.body?.rollNumber || '').trim().toUpperCase()
      : req.user.sub;
  if ((userType !== 'STUDENT' && userType !== 'PARENT') || !roll) {
    throw new HttpError(400, 'Choose a student or parent record for phone verification');
  }
  const student = extras.getStudentRow(roll);
  if (!student) throw new HttpError(404, 'Student record not found');
  const phone = String(req.body?.phoneNumber || '').replace(/\D/g, '').slice(-10);
  if (phone.length !== 10) throw new HttpError(400, 'Please enter a valid 10-digit mobile number');

  // Keep parents strictly locked to the Transport Office's registered parent_phone
  // so parent safety alerts cannot be hijacked, while allowing authenticated students
  // to register or update their own 10-digit mobile number.
  if (userType === 'PARENT') {
    const registeredPhone = String(student.parent_phone || '').replace(/\D/g, '').slice(-10);
    if (registeredPhone.length !== 10) {
      throw new HttpError(409, 'No parent mobile is registered. Ask the Transport Office to update the record first.');
    }
    if (phone !== registeredPhone) {
      throw new HttpError(403, 'Verification is limited to the registered mobile number');
    }
  }
  return { roll, userType, phone, student };
}

app.post('/api/otp/request', requireRole('STUDENT', 'PARENT', 'ADMIN'), otpRequestLimiter, async (req, res) => {
  const { roll, userType, phone } = getOtpTarget(req);
  const smsGateway = process.env.SMS_GATEWAY_URL;
  if (IS_PROD && !smsGateway) {
    if (userType === 'PARENT') {
      extras.updateParentPhoneVerified(roll);
    } else if (userType === 'STUDENT') {
      extras.updateStudentPhone(roll, phone);
    }
    extras.logNotification({
      recipient_type: userType,
      roll_number: roll,
      phone_number: phone,
      category: 'INFO',
      title: '📱 Alerts Activated (Direct In-App)',
      message: `Registered mobile number +91 ${phone.slice(0, 5)} ${phone.slice(5)} confirmed for In-App & WhatsApp transit alerts.`,
      status: 'DELIVERED',
      channel: 'IN_APP_SMS'
    });
    return res.json({
      success: true,
      mode: 'DIRECT_IN_APP',
      verified: true,
      phoneNumber: phone,
      message: `Registered number +91 ${phone.slice(0, 5)} ${phone.slice(5)} confirmed for In-App & WhatsApp alerts.`,
    });
  }

  const code = String(crypto.randomInt(100000, 1_000_000));
  if (smsGateway) {
    try {
      const resp = await fetch(smsGateway, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.SMS_API_KEY ? { Authorization: `Bearer ${process.env.SMS_API_KEY}` } : {}),
        },
        body: JSON.stringify({ to: phone, message: `Your Sreenidhi Express verification code is: ${code}. Valid for 10 minutes.` }),
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) return res.status(502).json({ success: false, error: `SMS gateway rejected dispatch: ${resp.statusText}` });
    } catch (err) {
      return res.status(502).json({ success: false, error: `Failed to reach SMS gateway: ${err.message}` });
    }
  } else {
    // Development only: the code is never returned to the browser.
    console.log(`[SMS Gateway Simulated Dispatch] Verification OTP for +91 ${phone}: ${code}`);
  }

  extras.saveOtp(roll, userType, phone, code);
  const respData = {
    success: true,
    phoneNumber: phone,
    message: `6-digit verification code dispatched to +91 ${phone.slice(0, 5)} ${phone.slice(5)}`,
  };
  if (process.env.NODE_ENV !== 'production' && !IS_PROD) {
    respData.simulatedOtp = code;
  }
  res.json(respData);
});

app.post('/api/otp/verify', requireRole('STUDENT', 'PARENT', 'ADMIN'), (req, res) => {
  const { roll, userType, phone } = getOtpTarget(req);
  const otp = String(req.body?.otp || '').trim();
  if (!/^\d{6}$/.test(otp)) return res.status(400).json({ error: 'Enter the 6-digit verification code' });

  const ok = extras.verifyOtp(roll, userType, phone, otp);
  if (!ok) return res.status(400).json({ error: 'Invalid or expired 6-digit OTP, or maximum verification attempts exceeded.' });

  if (userType === 'PARENT') {
    extras.updateParentPhoneVerified(roll);
  } else {
    extras.updateStudentPhone(roll, phone);
  }

  // Log welcome e-commerce style SMS notification
  extras.logNotification({
    recipient_type: userType,
    roll_number: roll,
    phone_number: phone,
    category: 'INFO',
    title: '📱 Sreenidhi Express Alerts Activated',
    message: `Mobile notifications successfully configured for +91 ${phone}. You will now receive live bus dispatch, arrival countdown, and traffic delay alerts.`,
    channel: 'IN_APP_SMS',
    status: 'DELIVERED'
  });

  res.json({ success: true, verified: true, phoneNumber: phone, userType });
});

/* ---------------- Mobile Notifications Feed & Preferences ---------------- */
app.get('/api/notifications/feed', requireRole('STUDENT', 'PARENT', 'ADMIN'), (req, res) => {
  const userType = req.user.role === 'PARENT' ? 'PARENT' : (req.user.role === 'ADMIN' && req.query?.userType ? String(req.query.userType).toUpperCase() : 'STUDENT');
  const roll = req.user.role === 'PARENT' ? req.user.wardRoll : (req.user.role === 'ADMIN' && req.query?.rollNumber ? String(req.query.rollNumber).toUpperCase() : req.user.sub);
  const notifications = extras.listNotifications(roll, userType);
  res.json({ success: true, notifications });
});

app.get('/api/notifications/preferences', requireRole('STUDENT', 'PARENT', 'ADMIN'), (req, res) => {
  const userType = req.user.role === 'PARENT' ? 'PARENT' : (req.user.role === 'ADMIN' && req.query?.userType ? String(req.query.userType).toUpperCase() : 'STUDENT');
  const roll = req.user.role === 'PARENT' ? req.user.wardRoll : (req.user.role === 'ADMIN' && req.query?.rollNumber ? String(req.query.rollNumber).toUpperCase() : req.user.sub);
  const preferences = extras.getNotificationPreferences(roll, userType);
  res.json({ success: true, preferences });
});

app.post('/api/notifications/preferences', requireRole('STUDENT', 'PARENT', 'ADMIN'), (req, res) => {
  const userType = req.user.role === 'PARENT' ? 'PARENT' : (req.user.role === 'ADMIN' && req.body?.userType ? String(req.body.userType).toUpperCase() : 'STUDENT');
  const roll = req.user.role === 'PARENT' ? req.user.wardRoll : (req.user.role === 'ADMIN' && req.body?.rollNumber ? String(req.body.rollNumber).toUpperCase() : req.user.sub);
  const prefs = req.body?.preferences || req.body;
  const ok = extras.saveNotificationPreferences(roll, userType, prefs);
  res.json({ success: ok, preferences: extras.getNotificationPreferences(roll, userType) });
});

app.post('/api/notifications/simulate', requireRole('ADMIN'), (req, res) => {
  if (IS_PROD) return res.status(403).json({ error: 'Notification simulator is disabled in production' });
  const roll = String(req.body?.rollNumber || req.user?.sub || '23SN1A0501').toUpperCase();
  const userType = String(req.body?.userType || req.user?.role || 'STUDENT').toUpperCase();
  const category = String(req.body?.category || 'APPROACHING_STOP').toUpperCase();
  const title = String(req.body?.title || '⏱️ Approaching Pickup Stop');
  const message = String(req.body?.message || 'Bus #14 is 5 minutes away from Tarnaka X Road. Please proceed to the boarding bay.');
  const id = extras.logNotification({
    recipient_type: userType,
    roll_number: roll,
    phone_number: req.body?.phoneNumber || '+91 98765 43210',
    category,
    title,
    message,
    channel: 'IN_APP_SMS',
    status: 'DELIVERED'
  });
  res.json({ success: true, notificationId: id, title, message });
});

app.post('/api/announcements/:id/delete', requireRole('ADMIN'), (req, res) => {
  const id = Number(req.params.id);
  const ok = extras.deleteAnnouncement(id);
  res.json({ success: ok, deletedId: id });
});

app.delete('/api/announcements/:id', requireRole('ADMIN'), (req, res) => {
  const id = Number(req.params.id);
  const ok = extras.deleteAnnouncement(id);
  res.json({ success: ok, deletedId: id });
});

/* ---------------- Server-Side External Notification Dispatch (No secrets in client) ---------------- */
app.post('/api/notifications/external-dispatch', requireRole('ADMIN', 'DRIVER', 'STUDENT'), dispatchLimiter, async (req, res) => {
  const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;
  const apiKey = process.env.NOTIFICATION_API_KEY;
  if (!webhookUrl || !apiKey) {
    return res.status(503).json({ success: false, error: 'External notification provider not configured on server' });
  }
  let { rollNumber, title, message, category } = req.body || {};
  title = str(title || 'Transit Alert', 100, 'title');
  message = str(message || '', 300, 'message');
  category = String(category || 'UPDATE').toUpperCase();
  // Recipient phone numbers are never taken from a browser request. Every
  // dispatch is tied to one registered student record and its stored parent
  // number, which prevents a valid session from becoming an arbitrary SMS API.
  if (req.user.role === 'STUDENT') rollNumber = req.user.sub;
  rollNumber = String(rollNumber || '').trim().toUpperCase();
  if (!rollNumber) return res.status(400).json({ error: 'A registered student recipient is required' });
  const student = extras.getStudentRow(rollNumber);
  if (!student || !student.parent_phone) return res.status(404).json({ error: 'Registered parent mobile not found' });
  if (req.user.role === 'STUDENT') {
    const allowedCategories = ['DELAY', 'EMERGENCY_BROADCAST', 'STUDENT_BOARDED', 'EARLY_EXIT'];
    if (!allowedCategories.includes(category)) return res.status(403).json({ error: 'Students may only dispatch approved safety updates' });
  }
  if (req.user.role === 'DRIVER') {
    if (normalizeRoute(student.route_id) !== normalizeRoute(req.user.routeId)) {
      return res.status(403).json({ error: 'Drivers can only message passengers assigned to their route' });
    }
    const driverCategories = ['DELAY', 'BREAKDOWN', 'EMERGENCY_BROADCAST', 'TRIP_STARTED', 'UPDATE'];
    if (!driverCategories.includes(category)) return res.status(403).json({ error: 'Drivers may only dispatch approved safety or delay alerts' });
  }
  const phoneNumber = student.parent_phone;

  try {
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-TransitPulse-Source': 'Sreenidhi-Express-Server',
      },
      body: JSON.stringify({
        to: phoneNumber,
        userType: 'PARENT',
        category,
        title,
        message,
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(8000),
    });
    extras.logNotification({
      recipient_type: 'PARENT', roll_number: student.roll_number, phone_number: phoneNumber,
      category, title, message, channel: 'EXTERNAL_WEBHOOK', status: resp.ok ? 'DISPATCHED' : 'PROVIDER_REJECTED'
    });
    res.status(resp.ok ? 200 : 502).json({ success: resp.ok, status: resp.status });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

/* ---------------- Admin Billing-Cycle Grace Pass Reset ---------------- */
app.post('/api/admin/billing-cycle/reset', requireRole('ADMIN'), (req, res) => {
  const rawCycle = typeof req.body?.newCycle === 'string' ? req.body.newCycle.trim() : '';
  const defaultCycle = `${new Date().getFullYear()}-TERM-${new Date().getMonth() < 6 ? '1' : '2'}`;
  const newCycle = rawCycle ? str(rawCycle, 30, 'newCycle') : defaultCycle;
  const count = extras.resetBillingCycle(newCycle);
  res.json({ success: true, newCycle, resetCount: count });
});

/* ---------------- Lost & Found Desk ---------------- */
app.get('/api/lost', requireRole('STUDENT', 'PARENT', 'DRIVER', 'ADMIN'), (req, res) => {
  const openOnly = req.query?.open !== 'false';
  res.json({ success: true, items: extras.listLostItems(openOnly) });
});

app.post('/api/lost', requireRole('STUDENT', 'PARENT', 'DRIVER', 'ADMIN'), (req, res) => {
  const msg = str(req.body?.msg, 280, 'msg');
  const contact = req.body?.contact ? str(req.body.contact, 80, 'contact') : req.user.name || req.user.sub;
  const id = extras.reportLostItem(req.user.name || req.user.sub, contact, msg);
  res.json({ success: true, itemId: id });
});

app.post('/api/lost/:id/resolve', requireRole('ADMIN'), (req, res) => {
  const id = Number(req.params.id);
  const ok = extras.resolveLostItem(id);
  res.json({ success: ok, resolvedId: id });
});

/* ---------------- Ride Quality & Feedback ---------------- */
app.get('/api/feedback', requireRole('ADMIN'), (req, res) => {
  res.json({ success: true, feedback: extras.listFeedback() });
});

app.post('/api/feedback', requireRole('STUDENT', 'PARENT'), (req, res) => {
  const rating = Math.max(1, Math.min(5, Number(req.body?.rating) || 5));
  const msg = req.body?.msg ? str(req.body.msg, 280, 'msg') : 'No comment provided';
  const rId = normalizeRoute(req.body?.routeId || req.user.routeId || 'route-51');
  const id = extras.saveFeedback(req.user.sub, req.user.name || req.user.sub, rId, rating, msg);
  res.json({ success: true, feedbackId: id });
});

/* ---------------- Multi-Category CSV Data Exports ---------------- */
app.get('/api/export', requireRole('ADMIN'), (req, res) => {
  const type = String(req.query?.type || 'boardings').toLowerCase();
  let filename = `${type}.csv`;
  let csvContent = '';

  if (type === 'incidents') {
    const rows = extras.listIncidents(false).map((r) => [
      new Date(r.ts).toLocaleString('en-IN'),
      r.kind,
      r.who,
      r.route_id,
      r.msg,
      r.open ? 'OPEN' : 'RESOLVED',
    ]);
    csvContent = toCsvString(['Timestamp (IST)', 'Kind', 'Reported By', 'Route', 'Details', 'Status'], rows);
  } else if (type === 'feedback') {
    const rows = extras.listFeedback().map((r) => [
      new Date(r.ts).toLocaleString('en-IN'),
      r.roll_number,
      r.student_name,
      r.route_id,
      r.rating,
      r.msg,
    ]);
    csvContent = toCsvString(['Timestamp (IST)', 'Roll Number', 'Student Name', 'Route', 'Star Rating', 'Comments'], rows);
  } else if (type === 'absences') {
    const rows = extras.listAbsences().map((r) => [
      r.day,
      r.roll_number,
      r.name || 'Student',
      r.route_id || 'Route 14',
      r.pickup_stop || '',
      new Date(r.created_at).toLocaleString('en-IN'),
    ]);
    csvContent = toCsvString(['Date of Absence', 'Roll Number', 'Student Name', 'Route', 'Pickup Stop', 'Marked At'], rows);
  } else if (type === 'lost') {
    const rows = extras.listLostItems(false).map((r) => [
      new Date(r.ts).toLocaleString('en-IN'),
      r.who,
      r.contact,
      r.msg,
      r.open ? 'UNCLAIMED' : 'RETURNED',
    ]);
    csvContent = toCsvString(['Reported At (IST)', 'Reported By', 'Contact', 'Item Description', 'Status'], rows);
  } else if (type === 'driver_utility') {
    const rFilter = req.query?.routeId ? normalizeRoute(String(req.query.routeId)) : null;
    const dwellRows = extras.getDriverUtilityLogs(rFilter, 5000).map((r) => [
      r.route_id,
      r.stop_id,
      r.stop_name,
      r.arrived_at,
      r.departed_at,
      r.dwell_sec,
      r.flag,
    ]);
    const tripRows = (rFilter
      ? db.prepare('SELECT route_id, started_at, running, headcount FROM trip_states WHERE route_id = ? AND started_at IS NOT NULL').all(rFilter)
      : db.prepare('SELECT route_id, started_at, running, headcount FROM trip_states WHERE started_at IS NOT NULL ORDER BY route_id ASC').all()
    ).map((r) => [
      r.route_id,
      'TRIP_START',
      'DRIVER',
      r.started_at,
      '',
      0,
      r.running ? `ACTIVE (Headcount: ${r.headcount || 0})` : `COMPLETED (Headcount: ${r.headcount || 0})`,
    ]);
    csvContent = toCsvString(
      ['Route ID', 'Stop ID', 'Stop Name', 'Arrived At', 'Departed At', 'Dwell Sec', 'Flag / Notes'],
      [...tripRows, ...dwellRows]
    );
    filename = 'driver_utility_audit.csv';
  } else {
    // Default to boardings
    const rows = db.prepare('SELECT * FROM boarding_attendance ORDER BY id DESC LIMIT 5000').all().map((r) => [
      r.timestamp,
      r.roll_number,
      r.name,
      r.route_id,
      r.stop_name,
      r.event_type,
      r.check_in_method,
      r.notes,
    ]);
    csvContent = toCsvString(['Timestamp (UTC)', 'Roll Number', 'Student Name', 'Route ID', 'Stop Name', 'Event Type', 'Method', 'Notes'], rows);
    filename = 'boarding_attendance.csv';
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csvContent);
});

/* ---------------- admin export (rebuilt at most every 30 s; atomic write is in excelStorage patch) ---------------- */
let lastExport = 0;
app.get('/api/excel/summary', requireRole('ADMIN'), (req, res) => res.json(getExcelSummary()));
app.get('/api/excel/download', requireRole('ADMIN'), (req, res, next) => {
  if (Date.now() - lastExport > 30_000) { generateExcelFileFromDb(); lastExport = Date.now(); }
  appendSheetRow('Alerts_Notifications', { Timestamp: now(), 'Alert ID': `EXP-${Date.now()}`, Category: 'SECURITY', Title: 'Master export downloaded', Message: `by ${req.user.sub} from ${req.ip}`, 'Delivery Status': 'AUDIT' });
  res.download(EXCEL_FILE_PATH, 'sreenidhi_transit_master.xlsx', (err) => { if (err && !res.headersSent) next(err); });
});

/* ---------------- Web Push Notifications (VAPID, ₹0) ---------------- */
app.get('/api/push/vapid-public-key', requireAuth, (req, res) => {
  res.json({
    enabled: Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && vapidConfigured),
    publicKey: VAPID_PUBLIC_KEY || null,
  });
});

app.post('/api/push/subscribe', requireAuth, apiLimiter, (req, res) => {
  const { endpoint, keys } = req.body ?? {};
  if (!endpoint || typeof endpoint !== 'string' || !endpoint.startsWith('https://')) {
    throw new HttpError(400, 'Invalid subscription endpoint: must start with https://');
  }
  if (!keys || typeof keys.p256dh !== 'string' || !keys.p256dh.trim() || typeof keys.auth !== 'string' || !keys.auth.trim()) {
    throw new HttpError(400, 'Invalid subscription keys: p256dh and auth are required');
  }
  let roll;
  if (req.user.role === 'DRIVER' || req.user.role === 'ADMIN') {
    roll = req.user.sub;
  } else {
    roll = resolveStudentRoll(req.user);
  }
  extras.savePushSubscription(roll, req.user.role, { endpoint, keys });
  res.json({ success: true });
});

app.delete('/api/push/subscribe', requireAuth, (req, res) => {
  if (req.body?.endpoint) {
    extras.deletePushSubscription(req.body.endpoint);
  }
  res.json({ success: true });
});

/* ---------------- Predictive ETAs (Rolling 14-Day Median in SQLite) ---------------- */
app.post('/api/bus/segment-arrival', requireRole('DRIVER'), telemetryLimiter, (req, res) => {
  const b = req.body ?? {};
  const fromStopId = str(b.fromStopId, 80, 'fromStopId');
  const toStopId = str(b.toStopId, 80, 'toStopId');
  const durationSec = Number(b.durationSec);
  if (!Number.isFinite(durationSec) || durationSec < 30 || durationSec > 3600) {
    throw new HttpError(400, 'durationSec must be an integer between 30 and 3600');
  }
  const routeKey = normalizeRoute(req.user.routeId || 'route-51');
  extras.recordStopSegmentDuration(routeKey, fromStopId, toStopId, durationSec);
  res.json({ success: true });
});

app.get('/api/routes/:routeId/eta-model', requireAuth, apiLimiter, (req, res) => {
  const routeKey = normalizeRoute(req.params.routeId);
  const istDate = new Date(Date.now() + 5.5 * 3600e3);
  const dayOfWeek = req.query.dayOfWeek !== undefined ? Number(req.query.dayOfWeek) : istDate.getUTCDay();
  const shift = typeof req.query.shift === 'string' ? req.query.shift.toUpperCase() : (istDate.getUTCHours() < 12 ? 'MORNING' : 'EVENING');
  const segments = extras.getHistoricalSegmentMedians(routeKey, dayOfWeek, shift);
  res.json({ routeId: routeKey, dayOfWeek, shift, segments });
});

/* ---------------- Canonical Route Topology API ---------------- */
app.get('/api/routes', requireAuth, apiLimiter, (req, res) => {
  res.json({ routes: ROUTE_TOPOLOGY });
});

/* ---------------- Server-Side OSRM Proxy & Geometry Cache ---------------- */
app.post('/api/routes/:routeId/geometry', requireAuth, apiLimiter, async (req, res) => {
  const routeId = normalizeRoute(req.params.routeId);
  const waypoints = req.body?.waypoints;
  if (!Array.isArray(waypoints) || waypoints.length < 2 || waypoints.length > 25) {
    throw new HttpError(400, 'waypoints must be an array of 2 to 25 [lat, lng] pairs');
  }
  for (const pt of waypoints) {
    if (!Array.isArray(pt) || pt.length < 2) throw new HttpError(400, 'Invalid coordinate pair');
    const [lat, lng] = pt;
    if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) throw new HttpError(400, 'lat out of range');
    if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) throw new HttpError(400, 'lng out of range');
  }
  const variant = typeof req.body?.variant === 'string' ? req.body.variant.trim() : 'default';
  const coordsHashStr = waypoints.map(([lat, lng]) => `${lat.toFixed(4)},${lng.toFixed(4)}`).join(';');
  const cacheKey = crypto.createHash('sha256').update(`${routeId}:${variant}:${coordsHashStr}`).digest('hex');

  const cached = extras.getCachedRouteGeometry(cacheKey);
  if (cached) {
    return res.json({
      coordinates: cached.coordinates,
      distanceKm: cached.distanceKm,
      durationMinutes: cached.durationMinutes,
      source: 'SERVER_CACHE',
    });
  }

  const coordsParam = waypoints.map(([lat, lng]) => `${lng},${lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coordsParam}?overview=full&geometries=geojson&steps=false`;

  try {
    const osrmRes = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!osrmRes.ok) throw new Error(`OSRM HTTP ${osrmRes.status}`);
    const data = await osrmRes.json();
    const route = data.routes?.[0];
    if (!route || !route.geometry?.coordinates) throw new Error('Invalid OSRM response');
    const coordinates = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    const distanceKm = Number((route.distance / 1000).toFixed(2));
    const durationMinutes = Math.round(route.duration / 60);
    extras.saveCachedRouteGeometry(cacheKey, routeId, coordinates, distanceKm, durationMinutes);
    res.json({ coordinates, distanceKm, durationMinutes, source: 'OSRM_SERVER' });
  } catch {
    res.status(502).json({ error: 'OSRM unavailable' });
  }
});

/* ---------------- Driver Utility & Transport Office Verification (v20) ---------------- */
app.get('/api/admin/driver-utility', requireRole('ADMIN'), (req, res) => {
  const routeId = req.query?.routeId ? normalizeRoute(String(req.query.routeId)) : null;
  const limit = Number(req.query?.limit) || 200;
  const logs = extras.getDriverUtilityLogs(routeId, limit);
  const tripStarts = routeId
    ? db.prepare('SELECT route_id, started_at, running, headcount FROM trip_states WHERE route_id = ? AND started_at IS NOT NULL').all(routeId)
    : db.prepare('SELECT route_id, started_at, running, headcount FROM trip_states WHERE started_at IS NOT NULL ORDER BY route_id ASC').all();
  res.json({ success: true, logs, tripStarts });
});

app.get('/api/admin/pending-verifications', requireRole('ADMIN'), (_req, res) => {
  const pending = extras.listPendingVerifications();
  res.json({ success: true, pending });
});

app.post('/api/admin/students/:rollNumber/verify', requireRole('ADMIN'), (req, res) => {
  const rollNumber = str(req.params.rollNumber, 32, 'rollNumber').toUpperCase();
  const approved = req.body?.approved !== undefined
    ? Boolean(req.body.approved)
    : String(req.body?.status || '').trim().toUpperCase() === 'VERIFIED';
  const routeId = req.body?.routeId ? normalizeRoute(str(req.body.routeId, 32, 'routeId')) : undefined;
  const pickupStop = req.body?.pickupStop ? str(req.body.pickupStop, 120, 'pickupStop') : undefined;

  const result = extras.verifyStudentRegistration(rollNumber, { approved, routeId, pickupStop });
  if (!result) throw new HttpError(404, 'Student not found');

  try {
    appendSheetRow('Admin_Audit', {
      Timestamp: utcStamp(),
      Admin_ID: String(req.user?.sub || 'ADMIN'),
      Action: approved ? 'STUDENT_VERIFIED' : 'STUDENT_REJECTED',
      Target: rollNumber,
      Route: result.routeId || '',
      Pickup_Stop: result.pickupStop || '',
    });
  } catch {}

  res.json(result);
});

/* ---------------- Bulk Excel Onboarding (256kb body limit) ---------------- */
app.post('/api/admin/students/bulk-import', requireRole('ADMIN'), express.json({ limit: '256kb' }), (req, res) => {
  const riders = Array.isArray(req.body?.riders) ? req.body.riders : [];
  if (riders.length === 0) throw new HttpError(400, 'riders array cannot be empty');
  if (riders.length > 500) throw new HttpError(400, 'Maximum 500 riders per bulk import');
  const result = extras.bulkImportRiders(riders);
  res.json(result);
});

/* ---------------- Live SQLite Backup (VACUUM INTO) ---------------- */
app.post('/api/admin/db/backup', requireRole('ADMIN'), (req, res) => {
  const result = createSqliteBackup();
  res.json({ success: true, fileName: result.fileName, backupCount: result.backupCount });
});

/* ---------------- Admin Live Diagnostics ---------------- */
app.get('/api/admin/health', requireRole('ADMIN'), apiLimiter, (req, res) => {
  const walPath = `${DB_FILE_PATH}-wal`;
  let walBytes = 0;
  try {
    if (fs.existsSync(walPath)) {
      walBytes = fs.statSync(walPath).size;
    }
  } catch {}

  const backupsDir = path.join(DATA_DIR, 'backups');
  let lastBackupFile = null;
  let lastBackupAt = null;
  try {
    if (fs.existsSync(backupsDir)) {
      const files = fs.readdirSync(backupsDir)
        .filter((f) => f.endsWith('.db'))
        .map((f) => {
          const fp = path.join(backupsDir, f);
          const st = fs.statSync(fp);
          return { file: f, mtimeMs: st.mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      if (files.length > 0) {
        lastBackupFile = files[0].file;
        lastBackupAt = Math.round(files[0].mtimeMs);
      }
    }
  } catch {}

  res.json({
    activeSseClients: sseClients.size,
    liveRoutes: liveBus.size,
    staleRoutes: [...staleFlag],
    walBytes,
    lastBackupFile,
    lastBackupAt,
    uptimeSec: Math.round(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / 1048576),
  });
});

/* ---------------- static frontend + SPA fallback ---------------- */
app.use(express.static(distPath, {
  maxAge: '1h',
  setHeaders: (res, f) => { if (/(index\.html|sw\.js|\.webmanifest)$/.test(f)) res.set('Cache-Control', 'no-store'); },
}));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
  if (req.path.startsWith('/assets/') || /\.(js|css|json|png|jpe?g|gif|ico|svg|woff2?|map)$/i.test(req.path)) return res.status(404).type('text/plain').send('Not found');
  res.set('Cache-Control', 'no-store').sendFile(path.join(distPath, 'index.html'));
});

/* ---------------- errors: never echo internals ---------------- */
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(err.status ?? 400).json({ error: 'Invalid request body' });
  console.error('[api] unhandled:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const isMainModule = Boolean(process.argv[1] && path.resolve(fileURLToPath(import.meta.url)).toLowerCase() === path.resolve(process.argv[1]).toLowerCase());
let server = null;

if (isMainModule) {
  server = app.listen(PORT, () => console.log(`[TransitPulse] listening on port ${PORT} (${IS_PROD ? 'production' : 'development'})`));
  server.on('error', (err) => { console.error('[TransitPulse] server error:', err.code === 'EADDRINUSE' ? `port ${PORT} already in use` : err); process.exit(1); });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
    for (const c of sseClients) { try { c.res.end(); } catch {} }
    sseClients.clear();
    server?.closeIdleConnections?.();
    server?.closeAllConnections?.();
    server?.close(() => { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch {} process.exit(0); });
    setTimeout(() => process.exit(1), 8000).unref();
  });
}

export { app, server, sseClients, usedStreamTickets, liveBus, staleFlag, tileCache, isPlanLocked, getFirstDepartureUtcMs };
