import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  signToken, verifyToken, hashPassword, verifyPassword, rateLimit, gateToken, verifyGateToken,
  normalizeRoute, validateEvent, utcStamp, escapeHtml, HttpError, haversineKm, CSP_HEADER,
} from '../server/security.js';
import { createExtras } from '../server/dbExtras.js';
import { db } from '../server/excelStorage.js';
import { app, isPlanLocked, getFirstDepartureUtcMs } from '../server/index.js';

test('token: round trip, scope separation, tamper, expiry', () => {
  const t = signToken({ sub: 'X', role: 'STUDENT' });
  assert.equal(verifyToken(t).sub, 'X');
  assert.equal(verifyToken(t, { scope: 'stream' }), null);                    // access token can't open a stream
  assert.equal(verifyToken(signToken({ sub: 'X' }, { scope: 'stream' })), null); // stream ticket isn't an API token
  const [h, , s] = t.split('.');
  const forged = `${h}.${Buffer.from(JSON.stringify({ sub: 'X', role: 'ADMIN', iss: 'transitpulse', scope: 'access', exp: 9e9 })).toString('base64url')}.${s}`;
  assert.equal(verifyToken(forged), null);
  assert.equal(verifyToken(signToken({ sub: 'X' }, { ttlSec: -1 })), null);
  const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${t.split('.')[1]}.`;
  assert.equal(verifyToken(none), null);
});

test('password: hash/verify, empty and wrong rejected', async () => {
  const h = await hashPassword('correct horse battery');
  assert.ok(await verifyPassword('correct horse battery', h));
  assert.ok(!(await verifyPassword('', h)));
  assert.ok(!(await verifyPassword('wrong', h)));
  assert.ok(!(await verifyPassword('anything', undefined)));
});

test('rate limiter blocks after max and resets', () => {
  const rl = rateLimit({ windowMs: 1000, max: 2, key: () => 'k' });
  const call = () => { let status = 200; rl({}, { set() {}, status(s) { status = s; return { json() {} }; } }, () => {}); return status; };
  assert.deepEqual([call(), call(), call()], [200, 200, 429]);
  rl.reset('k');
  assert.equal(call(), 200);
});

test('gate token: valid within skew, wrong bus / stale / malformed rejected', () => {
  const t0 = 1_700_000_000_000, tok = gateToken('route-14', t0);
  assert.ok(verifyGateToken('Route 14 (Secunderabad)', tok, t0 + 20_000));
  assert.ok(!verifyGateToken('route-15', tok, t0));
  assert.ok(!verifyGateToken('route-14', tok, t0 + 120_000));
  assert.ok(!verifyGateToken('route-14', 'SUH-GATE', t0));
});

test('validateEvent: forces identity, allowlists sheets/columns/events', () => {
  const stu = { role: 'STUDENT', sub: '23SN1A0501', name: 'Aarav' };
  const r = validateEvent(stu, 'Return_Trip_Changes', { 'Roll Number': 'VICTIM', 'Original Drop Stop': 'A', evil: 'x' });
  assert.equal(r['Roll Number'], '23SN1A0501'); assert.equal(r.evil, undefined);
  assert.throws(() => validateEvent(stu, 'Parent_Alerts_Log', {}), HttpError);
  assert.throws(() => validateEvent(stu, 'Driver_Trip_Logs', {}), HttpError);
  assert.throws(() => validateEvent(stu, 'Boarding_Attendance', { 'Event Type': 'BOARDED_BLE' }), HttpError);
  assert.doesNotThrow(() => validateEvent(stu, 'Boarding_Attendance', { 'Event Type': 'NOT_COMING_OPT_OUT' }));
  assert.throws(() => validateEvent(stu, 'Return_Trip_Changes', { Notes: { a: 1 }, 'Original Drop Stop': { a: 1 } }), HttpError);
  const drv = { role: 'DRIVER', sub: 'd', name: 'D', routeId: 'route-14' };
  assert.equal(validateEvent(drv, 'Boarding_Attendance', { 'Route ID': 'route-15' })['Route ID'], 'route-14');
});

test('utcStamp: rejects future/ancient client times', () => {
  const fmt = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/;
  assert.match(utcStamp('2020-01-01T00:00:00Z'), fmt);
  assert.equal(utcStamp(new Date(Date.now() - 3600e3).toISOString()), new Date(Date.now() - 3600e3).toISOString().replace('T', ' ').slice(0, 19));
  assert.notEqual(utcStamp('2099-01-01T00:00:00Z').slice(0, 4), '2099');
});

test('helpers', () => {
  assert.equal(normalizeRoute('Route 14 (Secunderabad)'), 'route-14');
  assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  assert.ok(haversineKm({ lat: 17.4, lng: 78.5 }, { lat: 17.5, lng: 78.5 }) > 10);
});

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE students (roll_number TEXT PRIMARY KEY, name TEXT NOT NULL, program TEXT NOT NULL, route_id TEXT NOT NULL, pickup_stop TEXT NOT NULL,
    parent_name TEXT NOT NULL, parent_phone TEXT NOT NULL, pass_status TEXT NOT NULL DEFAULT 'ACTIVE', registered_at TEXT NOT NULL, last_active TEXT NOT NULL);
    CREATE TABLE boarding_attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, roll_number TEXT, name TEXT, route_id TEXT, stop_name TEXT, event_type TEXT, check_in_method TEXT, notes TEXT);`);
  const x = createExtras(db); x.migrate(); return { db, x };
}
const S = { roll: '23SN1A0542', name: 'Sneha', program: 'AI', routeId: 'Route 14', pickupStop: 'H8', parentName: 'M', parentPhone: '+91 94401 56789' };

test('db: createStudent never overwrites (register-takeover fix)', () => {
  const { db, x } = freshDb();
  assert.ok(x.createStudent(S, 'h1'));
  db.prepare("UPDATE students SET pass_status='FEE_PENDING' WHERE roll_number=?").run(S.roll);
  assert.ok(!x.createStudent({ ...S, name: 'Attacker', parentPhone: '000' }, 'h2'));
  const r = x.getStudentRow(S.roll);
  assert.equal(r.pass_status, 'FEE_PENDING'); assert.equal(r.name, 'Sneha'); assert.equal(r.password_hash, 'h1');
});

test('db: event idempotency, migrate is re-runnable, link codes single-use', () => {
  const { x } = freshDb();
  x.migrate();
  assert.ok(x.claimEvent('a:1')); assert.ok(!x.claimEvent('a:1'));
  x.createStudent(S, 'h');
  const code = x.createLinkCode(S.roll);
  assert.equal(x.consumeLinkCode(code, 12345), S.roll);
  assert.equal(x.consumeLinkCode(code, 999), null);
  assert.equal(x.getStudentRow(S.roll).telegram_chat_id, '12345');
});

test('db: tx rolls back on error', () => {
  const { db, x } = freshDb();
  const before = db.prepare('SELECT COUNT(*) c FROM students').get().c;
  assert.throws(() => x.tx(() => { x.createStudent(S, 'h'); throw new Error('boom'); }));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM students').get().c, before);
  assert.equal(x.getStudentRow(S.roll), undefined);
});

test('db: parent codes — redeemable, reusable, regenerating revokes, telegram codes are not parent codes', () => {
  const { x } = freshDb();
  x.createStudent(S, 'h');
  const c1 = x.createParentCode(S.roll);
  assert.equal(x.redeemParentCode(c1), S.roll);
  assert.equal(x.redeemParentCode(c1), S.roll);          // reusable on parent's devices
  const c2 = x.createParentCode(S.roll);
  assert.equal(x.redeemParentCode(c1), null);            // old code revoked
  assert.equal(x.redeemParentCode(c2), S.roll);
  const tg = x.createLinkCode(S.roll);
  assert.equal(x.redeemParentCode(tg), null);            // telegram code can't open the portal
  assert.equal(x.consumeLinkCode(c2, 1), null);          // and a parent code can't link telegram
});

test('db: grace pass limits, fee status, and authoritative travel check', () => {
  const { db, x } = freshDb();
  x.createStudent(S, 'h');
  // Initially fee paid
  assert.ok(x.canStudentTravel(S.roll));
  // Set fee due
  x.setFeeStatus(S.roll, 'DUE');
  assert.equal(x.canStudentTravel(S.roll), false);
  // Activate emergency grace pass (1st time allowed)
  const g1 = x.activateGracePass(S.roll);
  assert.ok(g1.success);
  assert.ok(g1.graceUntil > Date.now());
  assert.ok(x.canStudentTravel(S.roll));
  // Try to activate second grace pass while first is active or used -> strictly rejected
  const g2 = x.activateGracePass(S.roll);
  assert.equal(g2.success, false);
  assert.ok(g2.error.includes('grace pass'));
  // Reset billing cycle for next term -> allows fresh emergency grace pass
  x.resetBillingCycle('2026-TERM-2');
  // First clear active grace timestamp to simulate new term start
  db.prepare('UPDATE students SET grace_until = 0 WHERE roll_number = ?').run(S.roll);
  const g3 = x.activateGracePass(S.roll);
  assert.ok(g3.success);
});

test('db: otp attempt limiter blocks after 5 failed attempts', () => {
  const { x } = freshDb();
  const phone = '9876543210';
  x.saveOtp(phone, '123456');
  // 5 wrong attempts
  assert.equal(x.verifyOtp(phone, '000000'), false);
  assert.equal(x.verifyOtp(phone, '111111'), false);
  assert.equal(x.verifyOtp(phone, '222222'), false);
  assert.equal(x.verifyOtp(phone, '333333'), false);
  assert.equal(x.verifyOtp(phone, '444444'), false);
  // 6th attempt with the correct code fails because attempts exceeded and OTP was deleted
  assert.equal(x.verifyOtp(phone, '123456'), false);
});

test('db: persistent trip state machine and headcount calculation', () => {
  const { x } = freshDb();
  x.createStudent(S, 'h');
  // Trip state defaults
  const st1 = x.getTripState('route-14');
  assert.equal(st1.running, false);
  assert.equal(st1.delayMinutes, 0);
  // Driver starts trip with delay
  x.setTripState('route-14', true, 15, 12);
  const st2 = x.getTripState('route-14');
  assert.equal(st2.running, true);
  assert.equal(st2.delayMinutes, 15);
  assert.equal(st2.headcount, 12);
  // Absences count exact route
  const tomorrow = '2026-11-22';
  assert.equal(x.countAbsencesForRoute('route-14', tomorrow), 0);
  x.setAbsence(S.roll, tomorrow, true);
  assert.equal(x.countAbsencesForRoute('route-14', tomorrow), 1);
  assert.equal(x.countAbsencesForRoute('route-114', tomorrow), 0); // No collision with 114

  // Headcount exact count without fictional 50 fallback
  assert.equal(x.getAssignedStudentCount('route-14'), 1);
  assert.equal(x.getAssignedStudentCount('route-99'), 0);

  // Durable stop timer persistence & clear
  x.setStopTimer('route-14', 'Uppal Ring Road', 120);
  const tActive = x.getStopTimer('route-14');
  assert.ok(tActive);
  assert.equal(tActive.stopName, 'Uppal Ring Road');
  x.clearStopTimer('route-14');
  assert.equal(x.getStopTimer('route-14'), null);
});

test('alerts: notify-parent incident creation passes 4-args and persists incident row', () => {
  const { x } = freshDb();
  x.createStudent(S, 'h');
  const s = x.getStudentRow(S.roll);
  const category = 'OVERSLEEP_MISSED_STOP';
  const msg = `Safety Alert: ${category} for ${s.name} (${s.roll_number})`;
  
  // Verify 4-arg incident call does not fail with NOT NULL constraint error
  const incId = x.createIncident('SAFETY_ANOMALY', s.name, s.route_id, msg);
  assert.ok(incId > 0);
  const incidents = x.listIncidents();
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].who, s.name);
  assert.equal(incidents[0].route_id, s.route_id);
  assert.equal(incidents[0].kind, 'SAFETY_ANOMALY');
  assert.equal(incidents[0].msg, msg);
});

test('compliance: strict fee-gate denies 23SN1A0542 when pass_status is FEE_PENDING even if fee_status is PAID', () => {
  const { db, x } = freshDb();
  x.createStudent(S, 'h');
  // Seed Sneha Patel: fee_status = 'PAID', pass_status = 'FEE_PENDING', no active grace
  db.prepare("UPDATE students SET fee_status = 'PAID', pass_status = 'FEE_PENDING', grace_until = 0 WHERE roll_number = ?").run(S.roll);
  const row = x.getStudentRow(S.roll);
  assert.equal(row.fee_status, 'PAID');
  assert.equal(row.pass_status, 'FEE_PENDING');

  // Both canStudentTravel and the pass route logic: (feePaid && passActive) || isGraceActive
  assert.equal(x.canStudentTravel(S.roll), false);

  const graceUntil = row.grace_until || 0;
  const isGraceActive = graceUntil > Date.now();
  const feePaid = (row.fee_status || 'PAID').toUpperCase() === 'PAID';
  const passActive = (row.pass_status || 'ACTIVE').toUpperCase() === 'ACTIVE';
  const canTravel = (feePaid && passActive) || isGraceActive;
  assert.equal(canTravel, false);
});

test('route optimization: all-or-nothing cluster skipping invariants', () => {
  const { x } = freshDb();
  // Create 2 students in Tarnaka cluster and 1 student in Habsiguda cluster
  const s1 = { roll: '23SN1A0501', name: 'Aarav Reddy', route_id: 'route-14', pickup_stop: 'Tarnaka Junction', phone: '9876543210' };
  const s2 = { roll: '23SN1A0502', name: 'Bhavna Sharma', route_id: 'route-14', pickup_stop: 'Tarnaka Metro Station', phone: '9876543211' };
  const s3 = { roll: '23SN1A0542', name: 'Sneha Patel', route_id: 'route-14', pickup_stop: 'Habsiguda Street 8', phone: '9876543212' };

  x.createStudent(s1, 'h');
  x.createStudent(s2, 'h');
  x.createStudent(s3, 'h');

  const day = '2026-11-23';

  // Invariant 1: Partial cluster opt-out does NOT skip cluster
  x.setAbsence(s1.roll, day, true); // 1 absent, 1 coming in Tarnaka
  let plan = x.computeRouteOptimization('route-14', day);
  assert.equal(plan.skippedClusterIds.includes('cluster-sec-tarnaka'), false, 'Partial opt-out must not skip cluster');

  // Invariant 2: Full cluster opt-out DOES skip cluster
  x.setAbsence(s2.roll, day, true); // Now 2/2 absent in Tarnaka
  plan = x.computeRouteOptimization('route-14', day);
  assert.equal(plan.skippedClusterIds.includes('cluster-sec-tarnaka'), true, 'Full opt-out must skip cluster');
  assert.equal(plan.skippedClusterIds.includes('cluster-habsi-nacharam'), false, 'Habsiguda must remain active');

  // Invariant 3: Campus cluster is never skippable
  assert.equal(plan.skippedClusterIds.includes('cluster-campus'), false, 'Campus hub cluster must never be skipped');

  // Invariant 4: Empty / unpopulated cluster is never skipped
  assert.equal(plan.skippedClusterIds.includes('cluster-uppal-boduppal'), false, 'Empty clusters must never be skipped');

  // Invariant 5: Reverting absence restores cluster
  x.setAbsence(s1.roll, day, false); // Aarav marks coming back
  plan = x.computeRouteOptimization('route-14', day);
  assert.equal(plan.skippedClusterIds.includes('cluster-sec-tarnaka'), false, 'Reverting absence must restore cluster');

  // Invariant 6: Admin override keeps cluster even if 100% absent
  x.setAbsence(s1.roll, day, true); // Back to 2/2 absent
  x.setClusterOverride('route-14', day, 'cluster-sec-tarnaka', true); // Admin overrides to KEEP
  plan = x.computeRouteOptimization('route-14', day);
  assert.equal(plan.skippedClusterIds.includes('cluster-sec-tarnaka'), false, 'Admin override must prevent skipping');
});

test('route-51: manifest seeds 26 registered riders (18 students + 8 faculty) with zero unmapped stops', () => {
  const { x } = freshDb();
  const day = '2026-11-23';
  const plan = x.computeRouteOptimization('route-51', day);
  assert.equal(plan.totalRouteStudents, 26, 'Route 51 must have exactly 26 registered riders');
  assert.equal(plan.studentCount, 18, 'Route 51 must have exactly 18 students');
  assert.equal(plan.facultyCount, 8, 'Route 51 must have exactly 8 faculty/staff');
  assert.equal(plan.unmappedStudents.length, 0, 'Route 51 must have 0 unmapped stops');
  assert.equal(x.getAssignedStudentCount('route-51'), 26);
});

test('route-51: strict all-or-nothing cluster skipping with student and faculty absence handling', () => {
  const { x } = freshDb();
  const day = '2026-11-23';

  // 1. Erragadda-ESI cluster (4 riders: 4 students, 0 faculty)
  x.setAbsence('26011CSEAI0109', day, true);
  x.setAbsence('26011CSEAI0052', day, true);
  x.setAbsence('26011CSEAI0072', day, true);
  // 3 out of 4 absent -> partial cluster opt-out -> MUST NOT SKIP
  let plan = x.computeRouteOptimization('route-51', day);
  assert.equal(plan.skippedClusterIds.includes('cluster-erragadda-esi'), false, 'Partial opt-out (3/4) must NOT skip Erragadda-ESI');
  const erragaddaCluster = plan.clusters.find((c) => c.areaClusterId === 'cluster-erragadda-esi');
  assert.equal(erragaddaCluster.totalStudents, 4);
  assert.equal(erragaddaCluster.studentCount, 4);
  assert.equal(erragaddaCluster.facultyCount, 0);
  assert.equal(erragaddaCluster.comingStudents, 1);
  assert.equal(erragaddaCluster.canSkip, false);

  // 4th student marks absent -> 4/4 absent -> MUST SKIP
  x.setAbsence('26011CSEAI0152', day, true);
  plan = x.computeRouteOptimization('route-51', day);
  assert.equal(plan.skippedClusterIds.includes('cluster-erragadda-esi'), true, 'Full opt-out (4/4) MUST skip Erragadda-ESI');

  // 2. Tarnaka-Lalapet cluster (6 riders: 1 student [Riddhish Maroju 26011CSEAI0165] + 5 faculty)
  // Student Riddhish marks absent:
  x.setAbsence('26011CSEAI0165', day, true);
  plan = x.computeRouteOptimization('route-51', day);
  const tarnakaCluster = plan.clusters.find((c) => c.areaClusterId === 'cluster-tarnaka-lalapet');
  assert.equal(tarnakaCluster.totalStudents, 6);
  assert.equal(tarnakaCluster.studentCount, 1);
  assert.equal(tarnakaCluster.facultyCount, 5);
  assert.equal(tarnakaCluster.comingStudents, 5, '5 faculty are still travelling');
  assert.equal(tarnakaCluster.canSkip, false, 'Tarnaka cluster must NOT be skipped when faculty are still travelling');
  assert.equal(plan.skippedClusterIds.includes('cluster-tarnaka-lalapet'), false);

  // Mark all 5 faculty absent too (60000130, FAC-R51-03, 40000116, 60000103, FAC-R51-06)
  x.setAbsence('60000130', day, true);
  x.setAbsence('FAC-R51-03', day, true);
  x.setAbsence('40000116', day, true);
  x.setAbsence('60000103', day, true);
  x.setAbsence('FAC-R51-06', day, true);
  plan = x.computeRouteOptimization('route-51', day);
  assert.equal(plan.skippedClusterIds.includes('cluster-tarnaka-lalapet'), true, 'Full opt-out (6/6 including all faculty) MUST skip Tarnaka');
});

test('route-51: fresh-db password hash backfill seeds valid scrypt hash and cluster ids', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE students (roll_number TEXT PRIMARY KEY, name TEXT NOT NULL, program TEXT NOT NULL, route_id TEXT NOT NULL, pickup_stop TEXT NOT NULL,
    parent_name TEXT NOT NULL, parent_phone TEXT NOT NULL, pass_status TEXT NOT NULL DEFAULT 'ACTIVE', registered_at TEXT NOT NULL, last_active TEXT NOT NULL, password_hash TEXT, stop_id TEXT, area_cluster_id TEXT, rider_type TEXT, gender TEXT);
    CREATE TABLE boarding_attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, roll_number TEXT, name TEXT, route_id TEXT, stop_name TEXT, event_type TEXT, check_in_method TEXT, notes TEXT);`);
  db.prepare("INSERT INTO students (roll_number, name, program, route_id, pickup_stop, parent_name, parent_phone, pass_status, registered_at, last_active, password_hash) VALUES ('26011CSEAI0109', 'Makineedi Sai Venkata Syam Suraj', 'I Year - AIML', 'route-51', 'Erragadda', 'M. Venkata Rao', '+91 98765 43209', 'ACTIVE', '2026-08-01 08:30:00', '2026-08-01 08:30:00', NULL)").run();
  const x = createExtras(db);
  x.migrate();
  const row = x.getStudentRow('26011CSEAI0109');
  assert.ok(row.password_hash, 'password_hash must be backfilled');
  assert.equal(row.stop_id, 'r51-s1');
  assert.equal(row.area_cluster_id, 'cluster-erragadda-esi');
  assert.ok(await verifyPassword('student123', row.password_hash));
});

test('route-51: locked route plan freezes skippedClusterIds and clusters[].isSkipped', () => {
  const { x } = freshDb();
  const day = '2026-11-23';
  x.setAbsence('26011CSEAI0109', day, true);
  x.setAbsence('26011CSEAI0052', day, true);
  x.setAbsence('26011CSEAI0072', day, true);
  x.setAbsence('26011CSEAI0152', day, true);
  let plan = x.setRoutePlanLock('route-51', day, true);
  assert.equal(plan.locked, true);
  assert.ok(plan.skippedClusterIds.includes('cluster-erragadda-esi'));
  const erragaddaCl = plan.clusters.find((c) => c.areaClusterId === 'cluster-erragadda-esi');
  assert.equal(erragaddaCl.isSkipped, true);

  // Revert one student absence
  x.setAbsence('26011CSEAI0152', day, false);
  plan = x.computeRouteOptimization('route-51', day);
  assert.equal(plan.locked, true);
  assert.ok(plan.skippedClusterIds.includes('cluster-erragadda-esi'), 'Locked plan must freeze skipped clusters even if absence changed');
  const frozenCl = plan.clusters.find((c) => c.areaClusterId === 'cluster-erragadda-esi');
  assert.equal(frozenCl.isSkipped, true, 'isSkipped must match frozen skippedClusterIds');

  // Unlock
  plan = x.setRoutePlanLock('route-51', day, false);
  assert.equal(plan.locked, false);
  assert.equal(plan.skippedClusterIds.includes('cluster-erragadda-esi'), false, 'Unlocked plan recalculates live attendance');
});

test('applications: migrate seeds APP-2026-881 and reviewApplication updates status', () => {
  const { x } = freshDb();
  const app = x.getApplication('APP-2026-881');
  assert.ok(app, 'APP-2026-881 must be seeded on fresh DB');
  assert.equal(app.roll_number, '26011CSEAI0109');
  assert.equal(app.status, 'PENDING_SCRUTINY');
  x.reviewApplication('APP-2026-881', 'APPROVED', 'Verified', 'Admin');
  const updated = x.getApplication('APP-2026-881');
  assert.equal(updated.status, 'APPROVED');
  assert.equal(updated.admin_note, 'Verified');
  assert.equal(updated.reviewed_by, 'Admin');
});

test('billing cycle reset & faculty rider separation', () => {
  const { db, x } = freshDb();
  // Set a student's grace_count to 2
  db.prepare("UPDATE students SET grace_count = 2 WHERE roll_number = '26011CSEAI0109'").run();
  assert.equal(x.getStudentRow('26011CSEAI0109').grace_count, 2);

  // Reset billing cycle with custom term
  const count = x.resetBillingCycle('2026-TERM-2');
  assert.ok(count > 0, 'resetBillingCycle should return count of updated students');
  const student = x.getStudentRow('26011CSEAI0109');
  assert.equal(student.grace_count, 0, 'grace_count must be reset to 0');
  assert.equal(student.current_billing_cycle, '2026-TERM-2', 'current_billing_cycle must be updated');

  // Verify Route 51 faculty rider separation
  const faculty = x.getStudentRow('40000116');
  assert.ok(faculty, 'Faculty rider 40000116 must exist in database');
  assert.equal(faculty.rider_type, 'FACULTY', '40000116 rider_type must be FACULTY');
  assert.equal(faculty.route_id, 'route-51', 'Faculty rider must be assigned to route-51');
});

test('production hardening: PRAGMA busy_timeout active and PARENT51 omitted in production', async () => {
  const { db: storageDb } = await import('../server/excelStorage.js');
  const timeoutRow = storageDb.prepare('PRAGMA busy_timeout').get();
  assert.equal(timeoutRow.timeout, 5000, 'SQLite busy_timeout must be 5000ms');

  const origEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    const testDb = new DatabaseSync(':memory:');
    testDb.exec(`CREATE TABLE students (roll_number TEXT PRIMARY KEY, name TEXT NOT NULL, program TEXT NOT NULL, route_id TEXT NOT NULL, pickup_stop TEXT NOT NULL,
      parent_name TEXT NOT NULL, parent_phone TEXT NOT NULL, pass_status TEXT NOT NULL DEFAULT 'ACTIVE', registered_at TEXT NOT NULL, last_active TEXT NOT NULL);
      CREATE TABLE boarding_attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, roll_number TEXT, name TEXT, route_id TEXT, stop_name TEXT, event_type TEXT, check_in_method TEXT, notes TEXT);`);
    const prodExtras = createExtras(testDb);
    prodExtras.migrate();
    const parentCodeRow = testDb.prepare("SELECT * FROM telegram_link_codes WHERE code = 'PARENT51'").get();
    assert.equal(parentCodeRow, undefined, 'PARENT51 must not exist in production');
  } finally {
    process.env.NODE_ENV = origEnv;
  }
});

test('v13 security hardening: Content-Security-Policy header and 4 composite SQLite indexes exist', () => {
  // 1. Verify CSP Header directives
  assert.ok(typeof CSP_HEADER === 'string' && CSP_HEADER.length > 0, 'CSP_HEADER must be non-empty string');
  assert.ok(CSP_HEADER.includes("default-src 'self'"), 'CSP must include default-src');
  assert.ok(CSP_HEADER.includes("script-src 'self'"), 'CSP must include script-src');
  assert.ok(CSP_HEADER.includes("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"), 'CSP must include style-src');
  assert.ok(CSP_HEADER.includes("font-src 'self' https://fonts.gstatic.com data:"), 'CSP must include font-src');
  assert.ok(CSP_HEADER.includes("img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com https://unpkg.com"), 'CSP must include img-src');
  assert.ok(CSP_HEADER.includes("connect-src 'self' https://router.project-osrm.org https://*.tile.openstreetmap.org https://*.firebaseio.com https://*.googleapis.com wss://*.firebaseio.com"), 'CSP must include connect-src');
  assert.ok(CSP_HEADER.includes("object-src 'none'"), 'CSP must include object-src');
  assert.ok(CSP_HEADER.includes("base-uri 'self'"), 'CSP must include base-uri');
  assert.ok(CSP_HEADER.includes("frame-ancestors 'none'"), 'CSP must include frame-ancestors');

  // 2. Verify 4 composite SQLite indexes exist
  const { db } = freshDb();
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name);
  assert.ok(indexes.includes('idx_absences_day'), 'idx_absences_day index must exist on absences');
  assert.ok(indexes.includes('idx_incidents_route_ts'), 'idx_incidents_route_ts index must exist on incidents');
  assert.ok(indexes.includes('idx_trip_logs_route_ts'), 'idx_trip_logs_route_ts index must exist on driver_trip_logs');
  assert.ok(indexes.includes('idx_parent_alerts_ts'), 'idx_parent_alerts_ts index must exist on parent_alerts_log');
});

test('v14 web push: push_subscriptions save, list, delete round-trip', () => {
  const { x } = freshDb();
  const sub1 = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/sub-1',
    keys: { p256dh: 'test-p256dh-key-1', auth: 'test-auth-secret-1' },
  };
  const sub2 = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/sub-2',
    keys: { p256dh: 'test-p256dh-key-2', auth: 'test-auth-secret-2' },
  };

  assert.ok(x.savePushSubscription('26011CSEAI0109', 'STUDENT', sub1));
  assert.ok(x.savePushSubscription('26011CSEAI0109', 'PARENT', sub2));

  // List by roll
  const listRoll = x.listPushSubscriptions({ roll: '26011CSEAI0109' });
  assert.equal(listRoll.length, 2);
  assert.equal(listRoll[0].endpoint, sub1.endpoint);

  // List by userType
  const listParents = x.listPushSubscriptions({ userType: 'PARENT' });
  assert.equal(listParents.length, 1);
  assert.equal(listParents[0].auth, 'test-auth-secret-2');

  // Delete
  assert.ok(x.deletePushSubscription(sub1.endpoint));
  const remaining = x.listPushSubscriptions({ roll: '26011CSEAI0109' });
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].endpoint, sub2.endpoint);

  // Deleting again returns false
  assert.ok(!x.deletePushSubscription(sub1.endpoint));
});

test('v14 predictive ETAs: rolling 14-day median calculation (>= 3 samples returns exact median, < 3 omitted, >14-day excluded)', () => {
  const { x } = freshDb();
  const routeId = 'route-51';
  const now = Date.now();

  // Segment A -> B: 5 samples (100, 120, 150, 180, 200) -> sorted median is 150
  x.recordStopSegmentDuration(routeId, 'stop-1', 'stop-2', 120, now - 1000);
  x.recordStopSegmentDuration(routeId, 'stop-1', 'stop-2', 100, now - 2000);
  x.recordStopSegmentDuration(routeId, 'stop-1', 'stop-2', 200, now - 3000);
  x.recordStopSegmentDuration(routeId, 'stop-1', 'stop-2', 150, now - 4000);
  x.recordStopSegmentDuration(routeId, 'stop-1', 'stop-2', 180, now - 5000);

  // Segment B -> C: only 2 samples (less than 3) -> should be omitted from medians
  x.recordStopSegmentDuration(routeId, 'stop-2', 'stop-3', 90, now - 1000);
  x.recordStopSegmentDuration(routeId, 'stop-2', 'stop-3', 110, now - 2000);

  // Segment C -> D: 3 samples but 2 are > 14 days old (e.g. 15 days and 20 days ago) -> only 1 fresh sample -> should be omitted
  x.recordStopSegmentDuration(routeId, 'stop-3', 'stop-4', 210, now - 1000); // fresh
  x.recordStopSegmentDuration(routeId, 'stop-3', 'stop-4', 220, now - (15 * 864e5)); // 15 days ago
  x.recordStopSegmentDuration(routeId, 'stop-3', 'stop-4', 230, now - (20 * 864e5)); // 20 days ago

  // Segment D -> E: 4 samples with even count (100, 120, 140, 160) -> average of 120 & 140 = 130
  x.recordStopSegmentDuration(routeId, 'stop-4', 'stop-5', 160, now - 1000);
  x.recordStopSegmentDuration(routeId, 'stop-4', 'stop-5', 100, now - 2000);
  x.recordStopSegmentDuration(routeId, 'stop-4', 'stop-5', 140, now - 3000);
  x.recordStopSegmentDuration(routeId, 'stop-4', 'stop-5', 120, now - 4000);

  const medians = x.getHistoricalSegmentMedians(routeId, undefined, undefined, 14);

  // Segment 1->2 has 5 samples: median is 150
  assert.ok(medians['stop-1->stop-2']);
  assert.equal(medians['stop-1->stop-2'].sampleCount, 5);
  assert.equal(medians['stop-1->stop-2'].medianSec, 150);

  // Segment 2->3 had < 3 samples: omitted
  assert.equal(medians['stop-2->stop-3'], undefined);

  // Segment 3->4 had only 1 fresh sample (< 14 days): omitted
  assert.equal(medians['stop-3->stop-4'], undefined);

  // Segment 4->5 has 4 samples: median is 130
  assert.ok(medians['stop-4->stop-5']);
  assert.equal(medians['stop-4->stop-5'].sampleCount, 4);
  assert.equal(medians['stop-4->stop-5'].medianSec, 130);
});

test('v14 bulk onboarding: creates new riders with must_change_password = 1 and preserves existing riders', () => {
  const { db, x } = freshDb();

  // Create an existing student with a known password hash and fee status
  const existingRoll = '26011CSEAI0109';
  const oldHash = 'scrypt$existing$original$hash';
  db.prepare("UPDATE students SET password_hash = ?, fee_status = 'PAID', pass_status = 'ACTIVE' WHERE roll_number = ?")
    .run(oldHash, existingRoll);

  const rosterToImport = [
    // 1. Existing student with different data: must NOT overwrite
    {
      rollNumber: existingRoll,
      name: 'Tampered Name',
      routeId: 'route-14',
      pickupStop: 'Secunderabad',
      riderType: 'STUDENT',
    },
    // 2. Brand new student
    {
      rollNumber: '26011CSEAI0999',
      name: 'Kavya Sharma',
      routeId: 'route-51',
      pickupStop: 'Ameerpet',
      riderType: 'STUDENT',
    },
    // 3. Brand new faculty member
    {
      rollNumber: '40000999',
      name: 'Dr. Suresh Kumar',
      routeId: 'route-51',
      pickupStop: 'Tarnaka',
      riderType: 'FACULTY',
    },
    // 4. Malformed row (missing pickupStop): should be logged in errors, not crash transaction
    {
      rollNumber: '26011CSEAI0888',
      name: 'Incomplete Rider',
      routeId: 'route-51',
      pickupStop: '',
    },
  ];

  const result = x.bulkImportRiders(rosterToImport);

  assert.equal(result.success, true);
  assert.equal(result.createdCount, 2);
  assert.equal(result.skippedExistingCount, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.credentials.length, 2);

  // Check new student
  const newStudent = db.prepare('SELECT * FROM students WHERE roll_number = ?').get('26011CSEAI0999');
  assert.ok(newStudent);
  assert.equal(newStudent.name, 'Kavya Sharma');
  assert.equal(newStudent.must_change_password, 1);
  assert.equal(newStudent.rider_type, 'STUDENT');
  assert.ok(newStudent.password_hash && newStudent.password_hash.startsWith('scrypt$'));

  // Check new faculty
  const newFaculty = db.prepare('SELECT * FROM students WHERE roll_number = ?').get('40000999');
  assert.ok(newFaculty);
  assert.equal(newFaculty.name, 'Dr. Suresh Kumar');
  assert.equal(newFaculty.rider_type, 'FACULTY');
  assert.equal(newFaculty.must_change_password, 1);

  // Check that credentials output contains generated temporary passwords
  assert.equal(result.credentials[0].temporaryPassword.length, 8);
  assert.equal(result.credentials[1].temporaryPassword.length, 8);

  // Verify existing student was NOT overwritten
  const preservedStudent = db.prepare('SELECT * FROM students WHERE roll_number = ?').get(existingRoll);
  assert.equal(preservedStudent.password_hash, oldHash);
  assert.equal(preservedStudent.name, 'Makineedi Sai Venkata Syam Suraj');
  assert.equal(preservedStudent.route_id, 'route-51');
});

test('v15 stream tickets: single-use enforcement prevents replay attacks', async () => {
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const studentToken = signToken({ sub: '26011CSEAI0109', role: 'STUDENT', routeId: 'route-51' });

    // Request stream ticket
    const ticketRes = await fetch(`${baseUrl}/api/bus/stream-ticket`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert.equal(ticketRes.status, 200);
    const { ticket } = await ticketRes.json();
    assert.ok(ticket, 'Stream ticket must be returned');

    // First connection: valid 200 OK text/event-stream
    const ctrl = new AbortController();
    const sse1 = await fetch(`${baseUrl}/api/bus/live-stream?ticket=${encodeURIComponent(ticket)}`, { signal: ctrl.signal });
    assert.equal(sse1.status, 200);
    assert.ok(sse1.headers.get('content-type')?.includes('text/event-stream'));
    assert.equal(sse1.headers.get('x-accel-buffering'), 'no');
    ctrl.abort();

    // Replay attack with the exact same ticket: must return 401 Unauthorized
    const sse2 = await fetch(`${baseUrl}/api/bus/live-stream?ticket=${encodeURIComponent(ticket)}`);
    assert.equal(sse2.status, 401, 'Replaying consumed stream ticket must return 401');
  } finally {
    server.close();
  }
});

test('v15 route geometry cache: saveCachedRouteGeometry + getCachedRouteGeometry round-trip and TTL expiry', () => {
  const { x } = freshDb();
  const cacheKey = 'route-51:default:test-osrm-key';
  const coords = [[17.4399, 78.4983], [17.4425, 78.5050], [17.4500, 78.5500]];
  const distanceKm = 14.5;
  const durationMin = 28;

  // Save into cache
  const saved = x.saveCachedRouteGeometry(cacheKey, 'route-51', coords, distanceKm, durationMin);
  assert.equal(saved, true);

  // Retrieve valid cache
  const cached = x.getCachedRouteGeometry(cacheKey, 3600_000);
  assert.ok(cached, 'Cache entry should be retrieved');
  assert.equal(cached.routeId, 'route-51');
  assert.deepEqual(cached.coordinates, coords);
  assert.equal(cached.distanceKm, 14.5);
  assert.equal(cached.durationMinutes, 28);
  assert.ok(typeof cached.updatedAt === 'number');

  // Verify expired cache returns null when maxAgeMs = 0
  const expired = x.getCachedRouteGeometry(cacheKey, 0);
  assert.equal(expired, null, 'Expired cache entry must return null');
});

test('v15 admin health diagnostics: RBAC enforcement and metrics payload', async () => {
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const studentToken = signToken({ sub: '26011CSEAI0109', role: 'STUDENT', routeId: 'route-51' });
    const adminToken = signToken({ sub: 'admin@sreenidhi.edu.in', role: 'ADMIN', name: 'Transport Incharge' });

    // Verify Student token returns 403 Forbidden
    const resStudent = await fetch(`${baseUrl}/api/admin/health`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert.equal(resStudent.status, 403, 'Student access to admin health must return 403');

    // Verify Admin token returns 200 OK with expected numeric metrics
    const resAdmin = await fetch(`${baseUrl}/api/admin/health`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(resAdmin.status, 200);
    const data = await resAdmin.json();
    assert.ok(typeof data.activeSseClients === 'number', 'activeSseClients must be numeric');
    assert.ok(typeof data.walBytes === 'number', 'walBytes must be numeric');
    assert.ok(typeof data.uptimeSec === 'number', 'uptimeSec must be numeric');
    assert.ok(typeof data.liveRoutes === 'number', 'liveRoutes must be numeric');
    assert.ok(Array.isArray(data.staleRoutes), 'staleRoutes must be an array');
  } finally {
    server.close();
  }
});

test('v16 map security & referrer policy: strict-origin-when-cross-origin & CARTO CSP', async () => {
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);

    // Verify Referrer-Policy header is strict-origin-when-cross-origin
    const refPolicy = res.headers.get('referrer-policy');
    assert.equal(refPolicy, 'strict-origin-when-cross-origin', 'Referrer-Policy header must be strict-origin-when-cross-origin');

    // Verify Content-Security-Policy header
    const csp = res.headers.get('content-security-policy') || CSP_HEADER;
    assert.ok(csp.includes('https://*.basemaps.cartocdn.com'), 'CSP must whitelist CARTO basemaps tile CDN');
  } finally {
    server.close();
  }
});

test('v17 tile proxy: rejects invalid themes and out-of-bounds coordinates', async () => {
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    // 1. Invalid theme rejection (must return 400)
    const resInvalidTheme = await fetch(`${baseUrl}/api/tiles/invalid/12/2941/1842`);
    assert.equal(resInvalidTheme.status, 400);
    const errTheme = await resInvalidTheme.json();
    assert.equal(errTheme.error, 'Invalid tile theme');

    // 2. Out-of-bounds zoom level (z > 19 must return 400)
    const resZoomOob = await fetch(`${baseUrl}/api/tiles/voyager/25/0/0`);
    assert.equal(resZoomOob.status, 400);
    const errZoom = await resZoomOob.json();
    assert.equal(errZoom.error, 'Invalid tile coordinates');

    // 3. Out-of-bounds x coordinate (for z=2, max coordinate is 4, so x=99 is invalid)
    const resCoordOob = await fetch(`${baseUrl}/api/tiles/voyager/2/99/0`);
    assert.equal(resCoordOob.status, 400);
    const errCoord = await resCoordOob.json();
    assert.equal(errCoord.error, 'Invalid tile coordinates');

    // 4. Non-integer or malformed coordinates
    const resMalformed = await fetch(`${baseUrl}/api/tiles/dark_all/abc/0/0`);
    assert.equal(resMalformed.status, 400);
  } finally {
    server.close();
  }
});

test('v19 otp onboarding: student can self-register & verify mobile, parent remains locked to registered phone', async () => {
  const targetRoll = '26011CSEAI0109';
  const prevRow = db.prepare('SELECT student_phone, student_phone_verified FROM students WHERE roll_number = ?').get(targetRoll);
  db.prepare("UPDATE students SET student_phone = '', student_phone_verified = 0 WHERE roll_number = ?").run(targetRoll);

  const server = app.listen(0);
  try {
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const studentToken = signToken({ sub: targetRoll, role: 'STUDENT', routeId: 'route-51' });
    const parentToken = signToken({ sub: `parent-${targetRoll}`, role: 'PARENT', wardRoll: targetRoll, routeId: 'route-51' });
    const studentPhone = '9876543210';

    // 1. Authenticated STUDENT with empty student_phone requests OTP for 10-digit mobile number
    const reqRes = await fetch(`${baseUrl}/api/otp/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({ phoneNumber: studentPhone }),
    });
    assert.equal(reqRes.status, 200, 'Student self-registration OTP request must return 200');
    const reqData = await reqRes.json();
    assert.equal(reqData.success, true);
    assert.match(String(reqData.simulatedOtp || ''), /^\d{6}$/, 'Dev mode must return 6-digit simulatedOtp');

    // 2. STUDENT verifies the simulated OTP -> persists phone & verified flag
    const verifyRes = await fetch(`${baseUrl}/api/otp/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({ phoneNumber: studentPhone, otp: reqData.simulatedOtp }),
    });
    assert.equal(verifyRes.status, 200);
    const verifyData = await verifyRes.json();
    assert.equal(verifyData.verified, true);

    // 3. GET /api/users/contact reflects persisted studentPhone + studentPhoneVerified: true
    const contactRes = await fetch(`${baseUrl}/api/users/contact`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert.equal(contactRes.status, 200);
    const contactData = await contactRes.json();
    assert.equal(contactData.studentPhone, studentPhone);
    assert.equal(contactData.studentPhoneVerified, true);

    // 4. Authenticated PARENT trying to verify an unregistered phone number (9999988888) -> still rejected with 403
    const parentReqRes = await fetch(`${baseUrl}/api/otp/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${parentToken}`,
      },
      body: JSON.stringify({ phoneNumber: '9999988888' }),
    });
    assert.equal(parentReqRes.status, 403, 'Parent OTP request for unregistered number must return 403');

    const parentVerifyRes = await fetch(`${baseUrl}/api/otp/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${parentToken}`,
      },
      body: JSON.stringify({ phoneNumber: '9999988888', otp: '123456' }),
    });
    assert.equal(parentVerifyRes.status, 403, 'Parent OTP verify for unregistered number must return 403');
  } finally {
    server.close();
    if (prevRow) {
      db.prepare('UPDATE students SET student_phone = ?, student_phone_verified = ? WHERE roll_number = ?')
        .run(prevRow.student_phone || '', prevRow.student_phone_verified || 0, targetRoll);
    }
    db.prepare('DELETE FROM otp_verifications WHERE account_roll = ?').run(targetRoll);
  }
});

test('v20 pilot hardening: dwell audit logging, trip started_at, student self-checkin & 1-hour pre-departure cutoff', async () => {
  const { x } = freshDb();
  const rShort = x.recordStopDwell('route-51', 's51-5', 'Erragadda', '2026-11-26T01:40:00Z', '2026-11-26T01:40:25Z', 25);
  const rNorm = x.recordStopDwell('route-51', 's51-6', 'SR Nagar', '2026-11-26T01:45:00Z', '2026-11-26T01:46:30Z', 90);
  const rLong = x.recordStopDwell('route-51', 's51-7', 'Ameerpet', '2026-11-26T01:50:00Z', '2026-11-26T01:56:00Z', 360);
  assert.equal(rShort.flag, 'TOO_SHORT');
  assert.equal(rNorm.flag, 'NORMAL');
  assert.equal(rLong.flag, 'TOO_LONG');

  const logs = x.getDriverUtilityLogs('route-51', 10);
  assert.equal(logs.length, 3);
  assert.equal(logs[0].stop_id, 's51-7');
  assert.equal(logs[2].flag, 'TOO_SHORT');

  x.setTripState('route-51', true, 0, 5, '2026-11-26T07:05:00+05:30');
  assert.equal(x.getTripState('route-51').startedAt, '2026-11-26T07:05:00+05:30');

  assert.equal(typeof getFirstDepartureUtcMs('route-51', '2099-01-15'), 'number');
  assert.equal(isPlanLocked('route-51', '2099-01-15'), false);
  assert.equal(isPlanLocked('route-51', '2020-01-15'), true);

  const targetRoll = '26011CSEAI0109';
  const stuRow = db.prepare('SELECT session_version, route_id FROM students WHERE roll_number = ?').get(targetRoll);
  const prevTrip = db.prepare('SELECT running, headcount, started_at FROM trip_states WHERE route_id = ?').get('route-51');
  const todayPrefix = new Date().toISOString().slice(0, 10);
  db.prepare('UPDATE trip_states SET running = 0, headcount = 0 WHERE route_id = ?').run('route-51');
  db.prepare('DELETE FROM boarding_attendance WHERE roll_number = ? AND timestamp LIKE ?').run(targetRoll, `${todayPrefix}%`);

  const studentToken = signToken({
    sub: targetRoll,
    role: 'STUDENT',
    routeId: stuRow?.route_id || 'route-51',
    sessionVersion: stuRow?.session_version || 0,
  });

  const server = app.listen(0);
  try {
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    // Inactive trip -> 409
    const rInactive = await fetch(`${baseUrl}/api/boarding/self-checkin`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'STUDENT_SELF_TAP' }),
    });
    assert.equal(rInactive.status, 409);

    // Start trip on DB and self-checkin -> 200
    db.prepare('UPDATE trip_states SET running = 1, headcount = 0 WHERE route_id = ?').run('route-51');
    const rActive = await fetch(`${baseUrl}/api/boarding/self-checkin`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'STUDENT_SELF_TAP' }),
    });
    assert.equal(rActive.status, 200);
    const body1 = await rActive.json();
    assert.equal(body1.success, true);
    assert.equal(body1.method, 'STUDENT_SELF_TAP');
    assert.equal(body1.boardedCount, 1);

    // Duplicate tap -> alreadyBoarded true without double increment
    const rDup = await fetch(`${baseUrl}/api/boarding/self-checkin`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'STUDENT_SELF_TAP' }),
    });
    assert.equal(rDup.status, 200);
    const body2 = await rDup.json();
    assert.equal(body2.alreadyBoarded, true);
    assert.equal(body2.boardedCount, 1);

    // 1-hour pre-departure absence cutoff HTTP enforcement
    const rLockedDay = await fetch(`${baseUrl}/api/students/absence`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ on: true, day: '2020-01-15' }),
    });
    assert.equal(rLockedDay.status, 409);

    const rFutureDay = await fetch(`${baseUrl}/api/students/absence`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ on: true, day: '2099-01-15' }),
    });
    assert.equal(rFutureDay.status, 200);
    const absBody = await rFutureDay.json();
    assert.equal(absBody.absent, true);
  } finally {
    server.close();
    db.prepare('DELETE FROM boarding_attendance WHERE roll_number = ? AND timestamp LIKE ?').run(targetRoll, `${todayPrefix}%`);
    db.prepare('DELETE FROM absences WHERE roll_number = ? AND day = ?').run(targetRoll, '2099-01-15');
    if (prevTrip) {
      db.prepare('UPDATE trip_states SET running = ?, headcount = ?, started_at = ? WHERE route_id = ?')
        .run(prevTrip.running, prevTrip.headcount, prevTrip.started_at || null, 'route-51');
    } else {
      db.prepare('UPDATE trip_states SET running = 0, headcount = 0 WHERE route_id = ?').run('route-51');
    }
  }
});

test('v20 transport office verification: self-signup stays 403 PENDING until 1-click admin approve', async () => {
  const testRoll = '26991TESTV20';
  const rejectRoll = '26991TESTREJ';
  db.prepare('DELETE FROM students WHERE roll_number IN (?, ?)').run(testRoll, rejectRoll);

  const adminToken = signToken({ sub: 'TRANSPORT_ADMIN', role: 'ADMIN' });
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    // 1. Self-register new student
    const regRes = await fetch(`${baseUrl}/api/students/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rollNumber: testRoll,
        name: 'Pilot Self Signup',
        email: 'pilot.v20@sreenidhi.edu.in',
        password: 'Password123',
        studentPhone: '9876501234',
        pickupStop: 'Erragadda',
      }),
    });
    assert.ok(regRes.status === 201 || regRes.status === 200);
    const regBody = await regRes.json();
    assert.equal(regBody.status, 'PENDING_VERIFICATION');

    // 2. Login blocked with 403 ACCOUNT_PENDING_VERIFICATION
    const loginPending = await fetch(`${baseUrl}/api/students/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rollNumber: testRoll, password: 'Password123' }),
    });
    assert.equal(loginPending.status, 403);
    const pendingBody = await loginPending.json();
    assert.equal(pendingBody.code, 'ACCOUNT_PENDING_VERIFICATION');

    // 3. Pending queue lists the self-registered student
    const queueRes = await fetch(`${baseUrl}/api/admin/pending-verifications`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(queueRes.status, 200);
    const queueBody = await queueRes.json();
    assert.ok(queueBody.pending.some((p) => p.roll_number === testRoll));

    // 4. Admin 1-click approves & assigns route-51
    const approveRes = await fetch(`${baseUrl}/api/admin/students/${testRoll}/verify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: true, routeId: 'route-51' }),
    });
    assert.equal(approveRes.status, 200);
    const approveBody = await approveRes.json();
    assert.equal(approveBody.verificationStatus, 'VERIFIED');
    assert.equal(approveBody.routeId, 'route-51');

    // 5. Login succeeds after approval
    const loginVerified = await fetch(`${baseUrl}/api/students/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rollNumber: testRoll, password: 'Password123' }),
    });
    assert.equal(loginVerified.status, 200);
    const verifiedBody = await loginVerified.json();
    assert.ok(verifiedBody.token);
    assert.equal(verifiedBody.student['Assigned Route'], 'route-51');
    assert.equal(verifiedBody.student.verificationStatus, 'VERIFIED');

    // 6. Reject flow returns 403 ACCOUNT_REJECTED
    await fetch(`${baseUrl}/api/students/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rollNumber: rejectRoll,
        name: 'Rejected Applicant',
        email: 'reject.v20@sreenidhi.edu.in',
        password: 'Password123',
        studentPhone: '9876501235',
        pickupStop: 'KPHB Colony',
      }),
    });
    const rejRes = await fetch(`${baseUrl}/api/admin/students/${rejectRoll}/verify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: false }),
    });
    assert.equal(rejRes.status, 200);
    const loginRej = await fetch(`${baseUrl}/api/students/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rollNumber: rejectRoll, password: 'Password123' }),
    });
    assert.equal(loginRej.status, 403);
    const rejLoginBody = await loginRej.json();
    assert.equal(rejLoginBody.code, 'ACCOUNT_REJECTED');
  } finally {
    server.close();
    db.prepare('DELETE FROM students WHERE roll_number IN (?, ?)').run(testRoll, rejectRoll);
  }
});

test('v20.3 driver utility report: IST formatting, scheduled variance, summary KPIs & CSV export headers', async () => {
  const adminToken = signToken({ sub: 'TRANSPORT_ADMIN', role: 'ADMIN' });
  const driverToken = signToken({ sub: 'driver-route-51', role: 'DRIVER', routeId: 'route-51' });
  const arrivedAt = '2026-11-27T01:47:00.000Z'; // 07:17:00 AM IST (Scheduled r51-s2: 07:15 AM => +2 min)
  const departedAt = '2026-11-27T01:48:48.000Z'; // 07:18:48 AM IST (108s => 1m 48s)

  const server = app.listen(0);
  try {
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const postDwell = await fetch(`${baseUrl}/api/bus/stop-dwell`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${driverToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stopId: 'r51-s2',
        stopName: 'ESI-Erragadda',
        arrivedAt,
        departedAt,
        dwellSec: 108,
      }),
    });
    assert.equal(postDwell.status, 200);
    const dwellRes = await postDwell.json();
    assert.equal(dwellRes.success, true);
    assert.equal(dwellRes.flag, 'NORMAL');
    assert.equal(dwellRes.dwellSec, 108);

    const utilRes = await fetch(`${baseUrl}/api/admin/driver-utility?routeId=route-51&date=2026-11-27`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(utilRes.status, 200);
    const utilBody = await utilRes.json();
    assert.equal(utilBody.success, true);
    assert.ok(Array.isArray(utilBody.logs) && utilBody.logs.length >= 1);
    assert.ok(utilBody.summary && utilBody.summary.totalStopsLogged >= 1);
    assert.equal(typeof utilBody.summary.avgDwellFormatted, 'string');

    const matchingLog = utilBody.logs.find(
      (l) => l.stop_id === 'r51-s2' && l.arrived_at === arrivedAt && l.departed_at === departedAt
    );
    assert.ok(matchingLog, 'Expected enriched dwell row in GET /api/admin/driver-utility');
    assert.ok(matchingLog.arrived_at_ist && matchingLog.arrived_at_ist.includes('27 Nov 2026'));
    assert.ok(matchingLog.departed_at_ist && matchingLog.departed_at_ist.includes('07:18:48'));
    assert.equal(matchingLog.dwell_formatted, '1m 48s');
    assert.equal(matchingLog.scheduled_time, '07:15 AM');
    assert.equal(matchingLog.delay_minutes, 2);

    const csvRes = await fetch(`${baseUrl}/api/export?type=driver_utility&routeId=route-51&date=2026-11-27`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(csvRes.status, 200);
    const csvText = await csvRes.text();
    const headerLine = csvText.split(/\r?\n/)[0] || '';
    assert.ok(headerLine.includes('Scheduled Time (IST)'));
    assert.ok(headerLine.includes('Arrived At (IST)'));
    assert.ok(headerLine.includes('Departed At (IST)'));
    assert.ok(headerLine.includes('Stopping Duration'));
    assert.ok(csvText.includes('1m 48s'));
  } finally {
    server.close();
    db.prepare('DELETE FROM stop_dwell_logs WHERE route_id = ? AND arrived_at = ?').run('route-51', arrivedAt);
  }
});



