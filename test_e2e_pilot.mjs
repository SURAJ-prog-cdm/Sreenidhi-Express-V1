import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import process from 'node:process';
import path from 'node:path';
import fs from 'node:fs';

const projectDir = process.cwd();
const testDataDir = path.join(projectDir, 'server', 'data_pilot_test');
const TEST_PORT = 3999;
const BASE_URL = `http://localhost:${TEST_PORT}`;

async function runPilotTests() {
  console.log('=== STARTING SREENIDHI TRANSITPULSE API INTEGRATION TEST SUITE ===\n');

  // Setup isolated test database directory
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDataDir, { recursive: true });

  const srcDataDir = path.join(projectDir, 'server', 'data');
  if (fs.existsSync(path.join(srcDataDir, 'transitpulse.db'))) {
    fs.copyFileSync(path.join(srcDataDir, 'transitpulse.db'), path.join(testDataDir, 'transitpulse.db'));
  }
  if (fs.existsSync(path.join(srcDataDir, 'sreenidhi_transit_master.xlsx'))) {
    fs.copyFileSync(path.join(srcDataDir, 'sreenidhi_transit_master.xlsx'), path.join(testDataDir, 'sreenidhi_transit_master.xlsx'));
  }

  // 1. Boot Express server with isolated test database on dedicated test port
  console.log(`[1/9] Booting Express server on isolated test port ${TEST_PORT}...`);
  const serverProc = spawn(process.execPath, ['server/index.js'], {
    cwd: projectDir,
    stdio: 'pipe',
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      DATA_DIR: testDataDir,
      DB_FILE_PATH: path.join(testDataDir, 'transitpulse.db'),
      EXCEL_FILE_PATH: path.join(testDataDir, 'sreenidhi_transit_master.xlsx'),
    },
  });
  
  serverProc.stdout.on('data', (d) => {
    console.log('   [Server stdout]:', d.toString().trim());
  });
  serverProc.stderr.on('data', (d) => {
    console.error('   [Server stderr]:', d.toString().trim());
  });

  // Wait for server to boot with retry
  let booted = false;
  for (let i = 0; i < 25; i++) {
    try {
      const r = await fetch(`${BASE_URL}/api/health`);
      if (r.ok) { booted = true; break; }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!booted) throw new Error('Test server failed to respond on port ' + TEST_PORT);

  try {
    // 2. Health Check
    console.log('[2/9] Checking /api/health...');
    const healthRes = await fetch(`${BASE_URL}/api/health`);
    assert.equal(healthRes.status, 200, 'Health endpoint should return 200');
    const health = await healthRes.json();
    console.log('   -> Health Status:', health.status);
    assert.equal(health.status, 'ONLINE', 'Backend health status must be ONLINE');

    // 3. Student Authentication (23SN1A0501 / student123)
    console.log('[3/9] Testing Student Login (23SN1A0501 / student123)...');
    const stuLoginRes = await fetch(`${BASE_URL}/api/students/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rollNumber: '23SN1A0501', password: 'student123' }),
    });
    assert.equal(stuLoginRes.status, 200, 'Student login should return 200');
    const stuLogin = await stuLoginRes.json();
    assert.equal(stuLogin.success, true, 'Student login must succeed');
    assert.ok(stuLogin.token, 'Student login must yield a JWT');
    const studentToken = stuLogin.token;
    console.log('   -> Student Login Succeeded! Name:', stuLogin.student['Student Name'], 'Route:', stuLogin.student['Assigned Route']);

    // Generate Parent Access Code from Student Session
    console.log('   -> Generating 30-Day Parent Access Code from Student Session...');
    const parentCodeRes = await fetch(`${BASE_URL}/api/students/me/parent-access-code`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${studentToken}` },
    });
    assert.equal(parentCodeRes.status, 200, 'Generate parent code should return 200');
    const parentCodeData = await parentCodeRes.json();
    assert.ok(parentCodeData.code, 'Parent code must be returned');
    assert.ok(parentCodeData.code.length >= 8, 'Parent code must be at least 8 alphanumeric chars');
    console.log('   -> Generated Parent Code:', parentCodeData.code, `(Valid for ${parentCodeData.expiresInDays} days)`);

    // 4. Parent Authentication using generated parent code
    console.log('[4/9] Testing Parent Login with Parent Code...');
    const parentLoginRes = await fetch(`${BASE_URL}/api/parents/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: parentCodeData.code }),
    });
    assert.equal(parentLoginRes.status, 200, 'Parent login should return 200');
    const parentLogin = await parentLoginRes.json();
    assert.equal(parentLogin.success, true, 'Parent login must succeed');
    assert.ok(parentLogin.token, 'Parent login must yield a JWT');
    assert.equal(parentLogin.parent.wardRoll, '23SN1A0501', 'Ward roll must match student roll');
    console.log('   -> Parent Login Succeeded! Ward Name:', parentLogin.parent.wardName, 'Ward Roll:', parentLogin.parent.wardRoll);
    const parentToken = parentLogin.token;

    // Verify Parent token access to ward's pass, grace, and absence endpoints (resolveStudentRoll)
    console.log('   -> Verifying Parent Token on /api/students/me/pass, grace, absence...');
    const parentPassRes = await fetch(`${BASE_URL}/api/students/me/pass`, {
      headers: { 'Authorization': `Bearer ${parentToken}` },
    });
    assert.equal(parentPassRes.status, 200, 'Parent token should access /api/students/me/pass');
    const parentPassData = await parentPassRes.json();
    assert.equal(parentPassData.rollNumber, '23SN1A0501');

    const parentGraceRes = await fetch(`${BASE_URL}/api/students/grace`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${parentToken}` },
    });
    assert.equal(parentGraceRes.status, 200, 'Parent token should access /api/students/grace');
    const parentGraceData = await parentGraceRes.json();
    assert.equal(parentGraceData.success, true);

    const parentAbsenceRes = await fetch(`${BASE_URL}/api/students/absence`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${parentToken}`,
      },
      body: JSON.stringify({ on: true }),
    });
    assert.equal(parentAbsenceRes.status, 200, 'Parent token should access /api/students/absence');
    const parentAbsenceData = await parentAbsenceRes.json();
    assert.equal(parentAbsenceData.success, true);
    assert.equal(parentAbsenceData.rollNumber, '23SN1A0501');
    console.log('   -> Parent Ward Resolution Verified! Pass, Grace, and Absence all returned 200 OK.');

    // Verify Unauthenticated Access Protection (Must return 401 Unauthorized)
    console.log('   -> Verifying 401 Unauthorized on unauthenticated GET routes...');
    const unauthIncidents = await fetch(`${BASE_URL}/api/incidents`);
    assert.equal(unauthIncidents.status, 401, 'Unauthenticated /api/incidents must return 401');

    const unauthLost = await fetch(`${BASE_URL}/api/lost`);
    assert.equal(unauthLost.status, 401, 'Unauthenticated /api/lost must return 401');

    const unauthAnnouncements = await fetch(`${BASE_URL}/api/announcements`);
    assert.equal(unauthAnnouncements.status, 401, 'Unauthenticated /api/announcements must return 401');

    const unauthBusState = await fetch(`${BASE_URL}/api/bus/state/14`);
    assert.equal(unauthBusState.status, 401, 'Unauthenticated /api/bus/state/14 must return 401');
    console.log('   -> Unauthenticated Lockdown Verified! All 4 endpoints return 401 Unauthorized.');

    // 5. Driver Authentication (Route 14 / PIN 141414)
    console.log('[5/9] Testing Driver Login (Route 14 / PIN 141414)...');
    const driverLoginRes = await fetch(`${BASE_URL}/api/driver/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ routeId: 'route-14', pin: '141414' }),
    });
    assert.equal(driverLoginRes.status, 200, 'Driver login should return 200');
    const driverLogin = await driverLoginRes.json();
    assert.equal(driverLogin.success, true, 'Driver login must succeed');
    assert.ok(driverLogin.token, 'Driver login must yield a JWT');
    assert.equal(driverLogin.driver.routeId, 'route-14', 'Driver route must be route-14');
    console.log('   -> Driver Login Succeeded! Driver ID:', driverLogin.driver.id, 'Route:', driverLogin.driver.routeId);
    const driverToken = driverLogin.token;

    // 6. Admin Authentication (admin@sreenidhi.edu.in / admin123)
    console.log('[6/9] Testing Admin Login (admin@sreenidhi.edu.in / admin123)...');
    const adminLoginRes = await fetch(`${BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminId: 'admin@sreenidhi.edu.in', password: 'admin123' }),
    });
    assert.equal(adminLoginRes.status, 200, 'Admin login should return 200');
    const adminLogin = await adminLoginRes.json();
    assert.equal(adminLogin.success, true, 'Admin login must succeed');
    assert.ok(adminLogin.token, 'Admin login must yield a JWT');
    assert.equal(adminLogin.admin.role, 'ADMIN', 'Admin role must be ADMIN');
    console.log('   -> Admin Login Succeeded! Name:', adminLogin.admin.name, 'Role:', adminLogin.admin.role);
    const adminToken = adminLogin.token;

    // 7. Rotating Door Gate Token & Server-Verified Check-In
    console.log('[7/9] Testing Driver Gate Token & Student QR Check-In...');
    const gateRes = await fetch(`${BASE_URL}/api/driver/gate-token`, {
      headers: { 'Authorization': `Bearer ${driverToken}` }
    });
    assert.equal(gateRes.status, 200, 'Gate token endpoint should return 200');
    const gate = await gateRes.json();
    assert.ok(gate.token, 'Gate token must exist');
    assert.ok(gate.qrPayload, 'QR payload must exist');
    console.log('   -> Received Gate Code:', gate.token, 'QR Payload:', gate.qrPayload);

    const checkInRes = await fetch(`${BASE_URL}/api/boarding/check-in`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${studentToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        routeId: 'route-14',
        method: 'QR',
        token: gate.token,
        eventId: `chk-${Date.now()}`
      })
    });
    assert.equal(checkInRes.status, 200, 'Check-in endpoint should return 200');
    const checkIn = await checkInRes.json();
    assert.equal(checkIn.success, true, 'Individual check-in must be accepted');
    console.log('   -> Student Check-In Result: ACCEPTED & RECORDED', checkIn);

    // 8. Not Travelling Tomorrow & Route Headcount
    console.log('[8/9] Testing Absence Reporting & Headcount Query...');
    const absenceRes = await fetch(`${BASE_URL}/api/students/absence`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${studentToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ on: true })
    });
    assert.equal(absenceRes.status, 200, 'Absence toggle should return 200');
    const absenceData = await absenceRes.json();
    assert.equal(absenceData.success, true, 'Absence toggle must succeed');
    assert.equal(absenceData.absentTomorrow, true, 'absentTomorrow flag must be true');
    console.log('   -> Absence Flagged for Tomorrow:', absenceData.success, 'Day:', absenceData.day, 'Absent:', absenceData.absentTomorrow);

    const headcountRes = await fetch(`${BASE_URL}/api/routes/route-14/expected-headcount`, {
      headers: { 'Authorization': `Bearer ${driverToken}` }
    });
    assert.equal(headcountRes.status, 200, 'Expected headcount endpoint should return 200');
    const headcount = await headcountRes.json();
    assert.ok(headcount.expectedCount !== undefined, 'Headcount must include expectedCount');
    console.log('   -> Driver Headcount Query:', `Assigned: ${headcount.assignedCount}, Absent: ${headcount.absentCount}, Expected Tomorrow: ${headcount.expectedCount}`);

    // 9. Excel Summary and Report Generation (Requires ADMIN token)
    console.log('[9/9] Testing Excel Summary and Master Persistence...');
    const summaryRes = await fetch(`${BASE_URL}/api/excel/summary`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.equal(summaryRes.status, 200, 'Excel summary endpoint should return 200');
    const summary = await summaryRes.json();
    assert.ok(Array.isArray(summary.sheets), 'Summary must have sheets array');
    assert.ok(summary.sheets.length > 0, 'Sheets array must not be empty');
    console.log('   -> Excel Sheets verified:');
    for (const s of summary.sheets) {
      console.log(`      * ${s.sheetName}: ${s.rowCount} rows`);
    }

    console.log('\n==================================================================');
    console.log('🎉 ALL API INTEGRATION WORKFLOWS & SECURITY CHECKS PASSED 100%!');
    console.log('==================================================================\n');
  } finally {
    if (serverProc && !serverProc.killed) {
      serverProc.kill();
      await new Promise((r) => setTimeout(r, 600));
    }
    try {
      if (fs.existsSync(testDataDir)) {
        fs.rmSync(testDataDir, { recursive: true, force: true });
        console.log('   [Cleanup] Disposable test database directory removed successfully.');
      }
    } catch (e) {
      console.warn('   [Cleanup warning]:', e.message);
    }
  }
}

runPilotTests().catch((err) => {
  console.error('\n❌ PILOT TEST FAILED:', err);
  process.exit(1);
});
