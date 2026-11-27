// server/dbExtras.js — schema additions + queries the hardened API needs. Pass in the DatabaseSync from excelStorage.
import crypto from 'node:crypto';
import { resolveStopForStudent, ROUTE_TOPOLOGY, normalizeRouteTopologyId, ROUTE_51_SEED_RIDERS } from './routeTopology.js';
import { hashPassword } from './security.js';

export function createExtras(db) {
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  const addCol = (t, c, def) => { if (!cols(t).includes(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`); };

  function migrate() {
    addCol('students', 'password_hash', 'TEXT');
    addCol('students', 'telegram_chat_id', 'TEXT');
    addCol('students', 'fee_status', "TEXT NOT NULL DEFAULT 'PAID'");
    addCol('students', 'grace_until', 'INTEGER NOT NULL DEFAULT 0');
    addCol('students', 'grace_count', 'INTEGER NOT NULL DEFAULT 0');
    addCol('students', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0');
    addCol('students', 'session_version', 'INTEGER NOT NULL DEFAULT 0');
    addCol('students', 'student_phone', "TEXT DEFAULT ''");
    addCol('students', 'student_phone_verified', 'INTEGER NOT NULL DEFAULT 0');
    addCol('students', 'parent_phone_verified', 'INTEGER NOT NULL DEFAULT 0');
    addCol('students', 'current_billing_cycle', "TEXT NOT NULL DEFAULT '2026-TERM-1'");
    addCol('students', 'last_grace_cycle', "TEXT DEFAULT ''");
    addCol('students', 'stop_id', 'TEXT');
    addCol('students', 'area_cluster_id', 'TEXT');
    addCol('students', 'rider_type', "TEXT NOT NULL DEFAULT 'STUDENT'");
    addCol('students', 'gender', "TEXT DEFAULT 'M'");
    addCol('students', 'verification_status', "TEXT NOT NULL DEFAULT 'VERIFIED'");
    addCol('students', 'email', "TEXT DEFAULT ''");
    db.exec(`
      CREATE TABLE IF NOT EXISTS processed_events (event_id TEXT PRIMARY KEY, received_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS driver_trip_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, route_id TEXT, driver_name TEXT,
        bus_reg TEXT, direction TEXT, skipped_clusters TEXT, fuel_saved TEXT, cost_saved TEXT);
      CREATE TABLE IF NOT EXISTS parent_alerts_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, recipient_phone TEXT,
        student_roll TEXT, message TEXT, alert_type TEXT, delivery_status TEXT);
      CREATE TABLE IF NOT EXISTS applications (
        id TEXT PRIMARY KEY, roll_number TEXT NOT NULL, student_name TEXT, request_type TEXT, title TEXT,
        description TEXT, proof_url TEXT, requested_value TEXT, status TEXT NOT NULL DEFAULT 'PENDING_SCRUTINY',
        admin_note TEXT, reviewed_by TEXT, reviewed_at TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS telegram_link_codes (
        code TEXT PRIMARY KEY, roll_number TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS absences (
        roll_number TEXT NOT NULL, day TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (roll_number, day));
      CREATE TABLE IF NOT EXISTS route_plans (
        route_id TEXT NOT NULL,
        day TEXT NOT NULL,
        skipped_clusters_json TEXT NOT NULL DEFAULT '[]',
        override_keep_clusters_json TEXT NOT NULL DEFAULT '[]',
        locked INTEGER NOT NULL DEFAULT 0,
        locked_at TEXT,
        estimated_minutes_saved INTEGER NOT NULL DEFAULT 0,
        estimated_km_saved REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (route_id, day));
      CREATE TABLE IF NOT EXISTS trip_states (
        route_id TEXT PRIMARY KEY,
        running INTEGER NOT NULL DEFAULT 0,
        delay_minutes INTEGER NOT NULL DEFAULT 0,
        headcount INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL,
        who TEXT NOT NULL, route_id TEXT, msg TEXT NOT NULL, open INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, route_id TEXT,
        msg TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lost_and_found (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, who TEXT NOT NULL,
        contact TEXT, msg TEXT NOT NULL, open INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS ride_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, roll_number TEXT NOT NULL,
        student_name TEXT NOT NULL, route_id TEXT NOT NULL, rating INTEGER NOT NULL, msg TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS otp_verifications (
        account_roll TEXT NOT NULL,
        user_type TEXT NOT NULL,
        purpose TEXT NOT NULL DEFAULT 'PHONE_VERIFY',
        phone_number TEXT NOT NULL,
        otp TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (account_roll, user_type, purpose));
      CREATE TABLE IF NOT EXISTS migration_flags (
        name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS mobile_notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, recipient_type TEXT NOT NULL,
        roll_number TEXT, phone_number TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL,
        message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DELIVERED', channel TEXT NOT NULL DEFAULT 'IN_APP_SMS');
      CREATE TABLE IF NOT EXISTS notification_preferences (
        roll_number TEXT NOT NULL, user_type TEXT NOT NULL, trip_started INTEGER NOT NULL DEFAULT 1,
        approaching_stop INTEGER NOT NULL DEFAULT 1, boarded INTEGER NOT NULL DEFAULT 1,
        traffic_delay INTEGER NOT NULL DEFAULT 1, campus_arrived INTEGER NOT NULL DEFAULT 1,
        emergency_broadcast INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (roll_number, user_type));
      CREATE TABLE IF NOT EXISTS active_stop_timers (
        route_id TEXT PRIMARY KEY,
        stop_name TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        duration_seconds INTEGER NOT NULL,
        expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        roll_number TEXT NOT NULL,
        user_type TEXT NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stop_segment_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route_id TEXT NOT NULL,
        from_stop_id TEXT NOT NULL,
        to_stop_id TEXT NOT NULL,
        day_of_week INTEGER NOT NULL,
        shift TEXT NOT NULL,
        duration_sec INTEGER NOT NULL,
        recorded_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS route_geometry_cache (
        cache_key TEXT PRIMARY KEY,
        route_id TEXT NOT NULL,
        geometry_json TEXT NOT NULL,
        distance_km REAL NOT NULL,
        duration_min INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stop_dwell_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route_id TEXT NOT NULL,
        stop_id TEXT NOT NULL,
        stop_name TEXT NOT NULL,
        arrived_at TEXT NOT NULL,
        departed_at TEXT NOT NULL,
        dwell_sec INTEGER NOT NULL,
        flag TEXT NOT NULL DEFAULT 'NORMAL',
        recorded_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS admin_users (
        admin_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        session_version INTEGER NOT NULL DEFAULT 0,
        created_by TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_admin_users_active ON admin_users(active);
      CREATE INDEX IF NOT EXISTS idx_dwell_route_ts ON stop_dwell_logs(route_id, recorded_at);
      CREATE INDEX IF NOT EXISTS idx_route_geom_route ON route_geometry_cache(route_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_push_sub_roll ON push_subscriptions(roll_number, user_type);
      CREATE INDEX IF NOT EXISTS idx_seg_hist_lookup ON stop_segment_history(route_id, from_stop_id, to_stop_id, day_of_week, shift, recorded_at);
      CREATE INDEX IF NOT EXISTS idx_att_roll_ts ON boarding_attendance(roll_number, timestamp);
      CREATE INDEX IF NOT EXISTS idx_att_route_ts ON boarding_attendance(route_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_apps_roll ON applications(roll_number);
      CREATE INDEX IF NOT EXISTS idx_mob_notif_roll ON mobile_notifications(roll_number, ts);
      CREATE INDEX IF NOT EXISTS idx_absences_day ON absences(day, roll_number);
      CREATE INDEX IF NOT EXISTS idx_incidents_route_ts ON incidents(route_id, open, ts);
      CREATE INDEX IF NOT EXISTS idx_trip_logs_route_ts ON driver_trip_logs(route_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_parent_alerts_ts ON parent_alerts_log(timestamp);
    `);
    addCol('otp_verifications', 'attempts', 'INTEGER NOT NULL DEFAULT 0');
    addCol('otp_verifications', 'account_roll', 'TEXT');
    addCol('otp_verifications', 'user_type', 'TEXT');
    addCol('otp_verifications', 'purpose', 'TEXT');
    addCol('trip_states', 'started_at', 'TEXT');
    // Rebuild legacy otp_verifications tables whose PRIMARY KEY was phone_number
    // so ON CONFLICT(account_roll, user_type, purpose) in saveOtp succeeds cleanly.
    const otpTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'otp_verifications'").get()?.sql || '';
    if (otpTableSql && !/primary\s+key\s*\(\s*account_roll\s*,\s*user_type\s*,\s*purpose\s*\)/i.test(otpTableSql)) {
      tx(() => {
        db.exec(`
          DROP TABLE IF EXISTS otp_verifications_v2;
          CREATE TABLE otp_verifications_v2 (
            account_roll TEXT NOT NULL,
            user_type TEXT NOT NULL,
            purpose TEXT NOT NULL DEFAULT 'PHONE_VERIFY',
            phone_number TEXT NOT NULL,
            otp TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (account_roll, user_type, purpose)
          );
          INSERT OR IGNORE INTO otp_verifications_v2
            (account_roll, user_type, purpose, phone_number, otp, expires_at, created_at, attempts)
          SELECT
            COALESCE(NULLIF(account_roll, ''), phone_number),
            COALESCE(NULLIF(user_type, ''), 'STUDENT'),
            COALESCE(NULLIF(purpose, ''), 'PHONE_VERIFY'),
            phone_number,
            otp,
            expires_at,
            created_at,
            COALESCE(attempts, 0)
          FROM otp_verifications;
          DROP TABLE otp_verifications;
          ALTER TABLE otp_verifications_v2 RENAME TO otp_verifications;
        `);
      });
    }
    addCol('telegram_link_codes', 'kind', "TEXT NOT NULL DEFAULT 'TELEGRAM'");
    // The seed file creates a duplicate 'SUH24AIM014' alias row for Aarav; fold it away.
    db.prepare("DELETE FROM students WHERE roll_number = 'SUH24AIM014' AND EXISTS (SELECT 1 FROM students WHERE roll_number='23SN1A0501')").run();

    // Earlier builds created this column with a permissive default. There is
    // no trustworthy verification audit for those old values, so require a
    // fresh OTP once rather than treating a legacy flag as proof of ownership.
    const phoneResetDone = db.prepare("SELECT 1 FROM migration_flags WHERE name = 'phone_verification_reset_v3'").get();
    if (!phoneResetDone) {
      db.prepare('UPDATE students SET student_phone_verified = 0, parent_phone_verified = 0').run();
      db.prepare("INSERT INTO migration_flags (name, applied_at) VALUES ('phone_verification_reset_v3', ?)").run(Date.now());
    }

    // 90-day retention pruning for notifications & parent alerts (never prunes students, attendance, applications, absences)
    try {
      const ninetyDaysAgoMs = Date.now() - 90 * 864e5;
      const ninetyDaysAgoIso = new Date(ninetyDaysAgoMs).toISOString();
      db.prepare('DELETE FROM mobile_notifications WHERE ts < ?').run(ninetyDaysAgoMs);
      db.prepare('DELETE FROM parent_alerts_log WHERE timestamp < ?').run(ninetyDaysAgoIso);
    } catch {
      // Non-fatal if tables not yet initialized
    }

    // Seed default sample notifications if table is empty
    const notifCount = db.prepare('SELECT COUNT(*) as c FROM mobile_notifications').get()?.c || 0;
    if (notifCount === 0) {
      const now = Date.now();
      db.prepare(`INSERT INTO mobile_notifications (ts, recipient_type, roll_number, phone_number, category, title, message, status, channel) VALUES
        (?, 'ALL', '23SN1A0501', '+91 98765 43210', 'TRIP_STARTED', '🚀 Trip Started: Bus #14 En Route', 'Route 14 bus has departed Tarnaka terminal at 07:15 AM. Live GPS tracking is active.', 'DELIVERED', 'IN_APP_SMS'),
        (?, 'ALL', '23SN1A0501', '+91 98765 43210', 'APPROACHING_STOP', '⏱️ 5-Minute Heads Up: Tarnaka Stop', 'Bus #14 is approaching Tarnaka X Road (ETA: 4 mins). Please be ready at your boarding spot.', 'DELIVERED', 'IN_APP_SMS'),
        (?, 'ALL', '23SN1A0501', '+91 98765 43210', 'BOARDED', '🎒 Boarding Confirmed: Aarav Sharma', 'Student Aarav Sharma (23SN1A0501) has safely boarded Bus #14 at Tarnaka.', 'DELIVERED', 'IN_APP_SMS')
      `).run(now - 25 * 60 * 1000, now - 15 * 60 * 1000, now - 10 * 60 * 1000);
    }

    // Backfill stop_id and area_cluster_id for existing students
    try {
      const unmapped = db.prepare('SELECT roll_number, route_id, pickup_stop FROM students WHERE stop_id IS NULL OR area_cluster_id IS NULL').all();
      for (const s of unmapped) {
        const resolved = resolveStopForStudent(s.route_id, s.pickup_stop);
        if (resolved) {
          db.prepare('UPDATE students SET stop_id = ?, area_cluster_id = ? WHERE roll_number = ?')
            .run(resolved.stopId, resolved.areaClusterId, s.roll_number);
        }
      }
    } catch (e) {
      console.warn('[dbExtras] Student topology backfill non-fatal:', e);
    }

    // Seed Route 51 manifest riders (18 students + 8 faculty/staff)
    try {
      const isProd = process.env.NODE_ENV === 'production';
      const studentHash = 'scrypt$16384$8$1$kIJS-k9SIMhCdQRXXY4quA$MOO7S-6r3W_s4MDdjgqeKXo_H5MEg7Oin-5JyTmFPfKE45cCCqa1G9pJ2KTXjBUxcggrIUAAq_d2LybzoYv92A';
      const facultyHash = 'scrypt$16384$8$1$xMK1uRnRMbrm-8jCV4yAhw$i8-SdYytyncjSAGzUuMtaZYh-hE91GM4jK3yk3wNp0i4-DEs2P5m7oiisGhaGtafJCA6nYE-KNL3MDevglflww';
      const insertRider = db.prepare(`
        INSERT OR IGNORE INTO students
        (roll_number, name, program, route_id, pickup_stop, parent_name, parent_phone, pass_status, registered_at, last_active, password_hash, stop_id, area_cluster_id, rider_type, gender)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updateRider = db.prepare(`
        UPDATE students
        SET password_hash = COALESCE(password_hash, ?),
            stop_id = COALESCE(stop_id, ?),
            area_cluster_id = COALESCE(area_cluster_id, ?),
            rider_type = COALESCE(rider_type, ?),
            gender = COALESCE(gender, ?)
        WHERE roll_number = ?
      `);
      for (const r of ROUTE_51_SEED_RIDERS) {
        const initialPasswordHash = isProd ? null : (r.rider_type === 'FACULTY' ? facultyHash : studentHash);
        insertRider.run(
          r.roll_number,
          r.name,
          r.program,
          r.route_id,
          r.pickup_stop,
          r.parent_name,
          r.parent_phone,
          r.pass_status,
          r.registered_at,
          r.last_active,
          initialPasswordHash,
          r.stop_id,
          r.area_cluster_id,
          r.rider_type,
          r.gender
        );
        updateRider.run(
          initialPasswordHash,
          r.stop_id,
          r.area_cluster_id,
          r.rider_type,
          r.gender,
          r.roll_number
        );
      }
      db.prepare("INSERT OR IGNORE INTO migration_flags (name, applied_at) VALUES ('route_51_manifest_seed_v1', ?)").run(Date.now());
      console.log('[dbExtras] Seeded 26 Route 51 manifest riders (18 students, 8 faculty)');

      // Fix 3 (P1): Backfill Dev password_hash for Legacy Seed Students on Fresh DB
      if (process.env.NODE_ENV !== 'production') {
        const legacyRolls = ['23SN1A0501', '23SN1A0542', '23SN1A0588', '23SN1A1208', '23SN1A0419'];
        const updateLegacy = db.prepare('UPDATE students SET password_hash = COALESCE(password_hash, ?) WHERE roll_number = ?');
        for (const roll of legacyRolls) {
          updateLegacy.run(studentHash, roll);
        }
      }

      // Fix 1 (P0): Seed 2 real Route 51 applications if applications table is empty
      const appCount = db.prepare('SELECT COUNT(*) as c FROM applications').get()?.c || 0;
      if (appCount === 0) {
        const nowIso = new Date().toISOString();
        const insertApp = db.prepare(`
          INSERT INTO applications (id, roll_number, student_name, request_type, title, description, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        insertApp.run(
          'APP-2026-881',
          '26011CSEAI0109',
          'Makineedi Sai Venkata Syam Suraj',
          'BUS_PASS_RENEWAL',
          'Semester Bus Pass Fee Clearance',
          'College transport fee paid via SBI portal; request Route 51 pass activation.',
          'PENDING_SCRUTINY',
          nowIso
        );
        insertApp.run(
          'APP-2026-882',
          '26011CSEAI0112',
          'Mallu Jaswanth Reddy',
          'ROUTE_CHANGE',
          'Alternate Evening Drop at Ameerpet Metro',
          'Attending evening project lab until 6:00 PM on Route 51.',
          'PENDING_SCRUTINY',
          nowIso
        );
      }

      // Seed persistent demo parent access codes (1-year validity for demo convenience)
      if (process.env.NODE_ENV === 'production') {
        db.prepare("DELETE FROM telegram_link_codes WHERE code IN ('PARENT51', 'PARENT14')").run();
      } else {
        db.prepare(`
          INSERT OR REPLACE INTO telegram_link_codes (code, roll_number, expires_at, kind)
          VALUES ('PARENT51', '26011CSEAI0109', ?, 'PARENT'),
                 ('PARENT14', '23SN1A0501', ?, 'PARENT')
        `).run(Date.now() + 365 * 864e5, Date.now() + 365 * 864e5);
      }
    } catch (e) {
      console.warn('[dbExtras] Route 51 seeding non-fatal:', e);
    }
  }

  /** Run fn atomically (DatabaseSync has no .transaction helper). */
  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  const getStudentRow = (roll) => db.prepare('SELECT * FROM students WHERE roll_number = ?').get(roll);
  const setPasswordHash = (roll, hash) => db.prepare('UPDATE students SET password_hash = ? WHERE roll_number = ?').run(hash, roll).changes > 0;
  const getSessionVersion = (roll) => Number(getStudentRow(roll)?.session_version || 0);
  const isSessionCurrent = (roll, version) => getSessionVersion(roll) === Number(version || 0);
  const revokeStudentSessions = (roll) =>
    db.prepare('UPDATE students SET session_version = COALESCE(session_version, 0) + 1 WHERE roll_number = ?').run(roll).changes > 0;
  const touchLastActive = (roll) => db.prepare("UPDATE students SET last_active = ? WHERE roll_number = ?").run(new Date().toISOString().replace('T', ' ').slice(0, 19), roll);

  /** Create-only. Returns false (never overwrites) if the roll number already exists. */
  function createStudent(s, passwordHash) {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const routeId = s.routeId || s.route_id || null;
    const pickupStop = s.pickupStop || s.pickup_stop || null;
    const resolved = resolveStopForStudent(routeId, pickupStop);
    const stopId = s.stopId || s.stop_id || resolved?.stopId || null;
    const clusterId = s.areaClusterId || s.area_cluster_id || resolved?.areaClusterId || null;
    const riderType = s.riderType || s.rider_type || 'STUDENT';
    const gender = s.gender || 'M';
    const r = db.prepare(`INSERT OR IGNORE INTO students
      (roll_number,name,program,route_id,pickup_stop,parent_name,parent_phone,pass_status,registered_at,last_active,password_hash,stop_id,area_cluster_id,rider_type,gender)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        s.roll || s.roll_number || null,
        s.name || null,
        s.program || 'Engineering',
        routeId,
        pickupStop,
        s.parentName || s.parent_name || 'Parent',
        s.parentPhone || s.parent_phone || '+91 00000 00000',
        s.pass_status || 'ACTIVE',
        now,
        now,
        passwordHash || null,
        stopId,
        clusterId,
        riderType,
        gender
      );
    return r.changes === 1;
  }

  /** Idempotency: true the first time an eventId is seen, false on replays. */
  const claimEvent = (id) => db.prepare('INSERT OR IGNORE INTO processed_events (event_id, received_at) VALUES (?,?)').run(id, new Date().toISOString()).changes === 1;
  const pruneEvents = () => {
    const thirtyDaysAgoIso = new Date(Date.now() - 30 * 864e5).toISOString();
    const sixtyDaysAgoMs = Date.now() - 60 * 864e5;
    const ninetyDaysAgoMs = Date.now() - 90 * 864e5;
    const ninetyDaysAgoIso = new Date(ninetyDaysAgoMs).toISOString();
    try {
      db.prepare("DELETE FROM processed_events WHERE received_at < ?").run(thirtyDaysAgoIso);
      db.prepare('DELETE FROM stop_segment_history WHERE recorded_at < ?').run(sixtyDaysAgoMs);
      db.prepare('DELETE FROM stop_dwell_logs WHERE recorded_at < ?').run(sixtyDaysAgoMs);
      db.prepare('DELETE FROM mobile_notifications WHERE ts < ?').run(ninetyDaysAgoMs);
      db.prepare('DELETE FROM parent_alerts_log WHERE timestamp < ?').run(ninetyDaysAgoIso);
    } catch {}
  };

  const recentCheckIn = (roll, routeId, sinceMs) =>
    !!db.prepare("SELECT 1 FROM boarding_attendance WHERE roll_number=? AND route_id=? AND event_type LIKE 'BOARDED%' AND timestamp >= ? LIMIT 1")
      .get(roll, routeId, new Date(Date.now() - sinceMs).toISOString().replace('T', ' ').slice(0, 19));

  /* applications (were an in-memory Map → lost on restart) */
  const saveApplication = (a) => db.prepare(`INSERT INTO applications (id,roll_number,student_name,request_type,title,description,proof_url,requested_value,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(a.id, a.roll, a.name, a.requestType, a.title, a.description, a.proofUrl, a.requestedValue, new Date().toISOString());
  const listApplications = (roll) => (roll
    ? db.prepare('SELECT * FROM applications WHERE roll_number = ? ORDER BY created_at DESC').all(roll)
    : db.prepare('SELECT * FROM applications ORDER BY created_at DESC LIMIT 500').all());
  const getApplication = (id) => db.prepare('SELECT * FROM applications WHERE id = ?').get(id);
  const reviewApplication = (id, status, note, by) => db.prepare('UPDATE applications SET status=?, admin_note=?, reviewed_by=?, reviewed_at=? WHERE id=?').run(status, note, by, new Date().toISOString(), id);

  /* Telegram parent linking: student asks for a code, parent sends "/start CODE" to the bot */
  function createLinkCode(roll) {
    const code = crypto.randomBytes(5).toString('hex').toUpperCase();
    db.prepare("INSERT INTO telegram_link_codes (code, roll_number, expires_at, kind) VALUES (?,?,?,'TELEGRAM')").run(code, roll, Date.now() + 24 * 3600e3);
    return code;
  }

  /** Parent-portal access code: 30 days, reusable on the parent's devices; generating a new one revokes the old ones. */
  function createParentCode(roll) {
    return tx(() => {
      db.prepare("DELETE FROM telegram_link_codes WHERE roll_number = ? AND kind = 'PARENT'").run(roll);
      const code = crypto.randomBytes(5).toString('hex').toUpperCase();
      db.prepare("INSERT INTO telegram_link_codes (code, roll_number, expires_at, kind) VALUES (?,?,?,'PARENT')").run(code, roll, Date.now() + 30 * 864e5);
      return code;
    });
  }
  const redeemParentCode = (code) =>
    db.prepare("SELECT roll_number FROM telegram_link_codes WHERE code = ? AND kind = 'PARENT' AND expires_at > ?").get(String(code).toUpperCase(), Date.now())?.roll_number ?? null;
  function consumeLinkCode(code, chatId) {
    return tx(() => {
      const row = db.prepare("SELECT * FROM telegram_link_codes WHERE code = ? AND kind = 'TELEGRAM' AND used = 0 AND expires_at > ?").get(String(code).toUpperCase(), Date.now());
      if (!row) return null;
      db.prepare('UPDATE telegram_link_codes SET used = 1 WHERE code = ?').run(row.code);
      db.prepare('UPDATE students SET telegram_chat_id = ? WHERE roll_number = ?').run(String(chatId), row.roll_number);
      return row.roll_number;
    });
  }

  /* Fee, Pass & 1-Day Grace Pass Rules */
  const getCurrentBillingCycle = () => process.env.CURRENT_BILLING_CYCLE || '2026-TERM-1';

  const activateGracePass = (roll) => {
    const s = getStudentRow(roll);
    if (!s) return { success: false, error: 'Student record not found' };
    const now = Date.now();
    if (s.grace_until && s.grace_until > now) {
      return { 
        success: false, 
        error: 'An emergency 1-day grace pass is already active for this account.',
        graceUntil: s.grace_until 
      };
    }
    const currentCycle = s.current_billing_cycle || getCurrentBillingCycle();
    const effectiveGraceCount = (s.last_grace_cycle === currentCycle) ? (s.grace_count || 0) : 0;
    // Strict limit: maximum 1 emergency grace pass per billing cycle for fee-due students
    if (effectiveGraceCount >= 1 && (s.fee_status || 'DUE').toUpperCase() !== 'PAID') {
      return { 
        success: false, 
        error: `Emergency 1-Day Grace Pass has already been used for billing cycle ${currentCycle}. Please clear outstanding transport fee or contact the Transport Scrutiny Desk.` 
      };
    }
    const graceUntil = now + 24 * 3600 * 1000;
    db.prepare('UPDATE students SET grace_until = ?, grace_count = ?, last_grace_cycle = ? WHERE roll_number = ?')
      .run(graceUntil, effectiveGraceCount + 1, currentCycle, roll);
    return { success: true, graceUntil };
  };

  const resetBillingCycle = (newCycle) => {
    return db.prepare('UPDATE students SET current_billing_cycle = ?, grace_count = 0').run(newCycle).changes;
  };

  const setFeeStatus = (roll, status) => {
    const isPaid = String(status).toUpperCase() === 'PAID';
    return db.prepare('UPDATE students SET fee_status = ?, pass_status = ? WHERE roll_number = ?')
      .run(isPaid ? 'PAID' : 'DUE', isPaid ? 'ACTIVE' : 'LOCKED', roll).changes > 0;
  };

  const canStudentTravel = (roll) => {
    const s = getStudentRow(roll);
    if (!s) return false;
    const feePaid = (s.fee_status || '').toUpperCase() === 'PAID';
    const passActive = (s.pass_status || '').toUpperCase() === 'ACTIVE';
    const graceActive = Boolean(s.grace_until && s.grace_until > Date.now());
    return (feePaid && passActive) || graceActive;
  };

  /* Password Forced Change */
  const setMustChangePassword = (roll, val) =>
    db.prepare('UPDATE students SET must_change_password = ? WHERE roll_number = ?').run(val ? 1 : 0, roll).changes > 0;
  const clearMustChangePassword = (roll) =>
    db.prepare('UPDATE students SET must_change_password = 0 WHERE roll_number = ?').run(roll).changes > 0;

  /* Route Helper & Exact Absence / Headcount Engine */
  function extractRouteNum(routeId) {
    const m = String(routeId || '').match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  }

  const getAssignedStudentCount = (routeId) => {
    const num = extractRouteNum(routeId);
    if (!num) return 0;
    const numPad = num < 10 ? '0' + num : String(num);
    const r = db.prepare(`SELECT COUNT(*) as c FROM students 
      WHERE (route_id = ? OR route_id = ? OR route_id = ? OR route_id LIKE ? OR route_id LIKE ? OR route_id LIKE ? OR route_id LIKE ?)
        AND (verification_status IS NULL OR verification_status = 'VERIFIED')`)
      .get(`route-${num}`, `Route ${num}`, `Route ${numPad}`, `Route ${num} %`, `Route ${numPad} %`, `Route ${num}-%`, `Route ${numPad}-%`);
    return r?.c || 0;
  };

  const listStudentsForRoute = (routeId) => {
    const num = extractRouteNum(routeId);
    if (!num) return [];
    const numPad = num < 10 ? '0' + num : String(num);
    return db.prepare(`SELECT * FROM students 
      WHERE (route_id = ? OR route_id = ? OR route_id = ? OR route_id LIKE ? OR route_id LIKE ? OR route_id LIKE ? OR route_id LIKE ?)
        AND (verification_status IS NULL OR verification_status = 'VERIFIED')`)
      .all(`route-${num}`, `Route ${num}`, `Route ${numPad}`, `Route ${num} %`, `Route ${numPad} %`, `Route ${num}-%`, `Route ${numPad}-%`);
  };

  /* Durable Active Stop Timers (one active stop per bus route, persists across restarts) */
  const setStopTimer = (routeId, stopName, durationSeconds = 120) => {
    const num = extractRouteNum(routeId) || 14;
    const norm = `route-${num}`;
    const nowMs = Date.now();
    const expiresAt = nowMs + durationSeconds * 1000;
    db.prepare(`
      INSERT INTO active_stop_timers (route_id, stop_name, started_at, duration_seconds, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(route_id) DO UPDATE SET
        stop_name = excluded.stop_name,
        started_at = excluded.started_at,
        duration_seconds = excluded.duration_seconds,
        expires_at = excluded.expires_at
    `).run(norm, stopName, nowMs, durationSeconds, expiresAt);
    return { routeId: norm, stopName, durationSeconds, startedAt: nowMs, expiresAt };
  };

  const getStopTimer = (routeId) => {
    const num = extractRouteNum(routeId) || 14;
    const norm = `route-${num}`;
    const row = db.prepare('SELECT * FROM active_stop_timers WHERE route_id = ?').get(norm);
    if (!row) return null;
    const remainingSeconds = Math.max(0, Math.floor((row.expires_at - Date.now()) / 1000));
    if (remainingSeconds <= 0) {
      db.prepare('DELETE FROM active_stop_timers WHERE route_id = ?').run(norm);
      return null;
    }
    return {
      routeId: row.route_id,
      stopName: row.stop_name,
      durationSeconds: row.duration_seconds,
      startedAt: row.started_at,
      remainingSeconds,
      expiresAt: row.expires_at,
    };
  };

  const clearStopTimer = (routeId) => {
    const num = extractRouteNum(routeId) || 14;
    const norm = `route-${num}`;
    db.prepare('DELETE FROM active_stop_timers WHERE route_id = ?').run(norm);
  };

  const stopKey = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

  /* Boarding idempotency checker */
  const isBoardedToday = (roll, routeId) => {
    try {
      const num = extractRouteNum(routeId) || 14;
      const r = db.prepare(`
        SELECT 1 FROM boarding_attendance 
        WHERE roll_number = ? AND (route_id = ? OR route_id = ? OR route_id LIKE ?)
          AND event_type LIKE 'BOARDED%' AND date(timestamp) = date('now')
        LIMIT 1
      `).get(roll, `route-${num}`, `Route ${num}`, `%Route ${num}%`);
      return Boolean(r);
    } catch {
      return false;
    }
  };

  const isOptedOutToday = (roll, routeId) => {
    const num = extractRouteNum(routeId) || 14;
    return !!db.prepare(`SELECT 1 FROM boarding_attendance
      WHERE roll_number = ? AND (route_id = ? OR route_id = ? OR route_id LIKE ?)
        AND event_type = 'NOT_COMING_OPT_OUT' AND date(timestamp) = date('now') LIMIT 1`)
      .get(roll, `route-${num}`, `Route ${num}`, `%Route ${num}%`);
  };

  const getPendingStopStudentCount = (routeId, stopName) => {
    const routeNum = extractRouteNum(routeId);
    if (!routeNum) return 0;
    const rows = db.prepare('SELECT roll_number, route_id, pickup_stop FROM students').all();
    return rows.filter((row) =>
      extractRouteNum(row.route_id) === routeNum &&
      stopKey(row.pickup_stop) === stopKey(stopName) &&
      !isBoardedToday(row.roll_number, routeId) &&
      !isOptedOutToday(row.roll_number, routeId)
    ).length;
  };

  const clearStopTimerIfNoPending = (routeId, stopName) => {
    const timer = getStopTimer(routeId);
    if (!timer || stopKey(timer.stopName) !== stopKey(stopName)) return false;
    if (getPendingStopStudentCount(routeId, stopName) > 0) return false;
    clearStopTimer(routeId);
    return true;
  };

  /* Absences ("Not Travelling Tomorrow") */
  const setAbsence = (roll, day, absent) => {
    if (absent) {
      db.prepare('INSERT OR IGNORE INTO absences (roll_number, day, created_at) VALUES (?,?,?)').run(roll, day, new Date().toISOString());
    } else {
      db.prepare('DELETE FROM absences WHERE roll_number = ? AND day = ?').run(roll, day);
    }
  };
  const isAbsent = (roll, day) => !!db.prepare('SELECT 1 FROM absences WHERE roll_number = ? AND day = ?').get(roll, day);
  const listAbsences = (day) => {
    return db.prepare(`SELECT a.roll_number, a.day, s.name, s.route_id, s.pickup_stop, a.created_at
      FROM absences a LEFT JOIN students s ON a.roll_number = s.roll_number
      WHERE (? IS NULL OR a.day = ?) ORDER BY a.created_at DESC`).all(day || null, day || null);
  };
  const countAbsencesForRoute = (routeId, day) => {
    const num = extractRouteNum(routeId);
    if (!num) return 0;
    const numPad = num < 10 ? '0' + num : String(num);
    const r = db.prepare(`SELECT COUNT(*) as c FROM absences a
      JOIN students s ON a.roll_number = s.roll_number
      WHERE (s.route_id = ? OR s.route_id = ? OR s.route_id = ? OR s.route_id LIKE ? OR s.route_id LIKE ? OR s.route_id LIKE ? OR s.route_id LIKE ?)
        AND (s.verification_status IS NULL OR s.verification_status = 'VERIFIED')
        AND a.day = ?`)
      .get(`route-${num}`, `Route ${num}`, `Route ${numPad}`, `Route ${num} %`, `Route ${numPad} %`, `Route ${num}-%`, `Route ${numPad}-%`, day);
    return r?.c || 0;
  };

  /* Persistent Trip State Machine */
  const getTripState = (routeId) => {
    const num = extractRouteNum(routeId) || 14;
    const norm = `route-${num}`;
    const row = db.prepare('SELECT * FROM trip_states WHERE route_id = ?').get(norm);
    if (row) {
      return {
        running: Boolean(row.running),
        delayMinutes: row.delay_minutes || 0,
        headcount: row.headcount || 0,
        startedAt: row.started_at || null,
        updatedAt: row.updated_at
      };
    }
    return { running: false, delayMinutes: 0, headcount: 0, startedAt: null, updatedAt: new Date().toISOString() };
  };

  const setTripState = (routeId, running, delayMinutes, headcount, startedAt = undefined) => {
    const num = extractRouteNum(routeId) || 14;
    const norm = `route-${num}`;
    const now = new Date().toISOString();
    const existing = db.prepare('SELECT started_at FROM trip_states WHERE route_id = ?').get(norm);
    const effectiveStartedAt = startedAt !== undefined ? startedAt : (existing?.started_at ?? null);
    db.prepare(`INSERT OR REPLACE INTO trip_states (route_id, running, delay_minutes, headcount, started_at, updated_at)
      VALUES (?,?,?,?,?,?)`)
      .run(norm, running ? 1 : 0, delayMinutes || 0, headcount || 0, effectiveStartedAt, now);
    return getTripState(norm);
  };

  /* Incidents (SOS & Breakdowns) */
  const createIncident = (kind, who, routeId, msg) => {
    const r = db.prepare('INSERT INTO incidents (ts, kind, who, route_id, msg, open) VALUES (?,?,?,?,?,1)')
      .run(Date.now(), kind, who, routeId || 'route-14', msg);
    return r.lastInsertRowid;
  };
  const listIncidents = (openOnly) => {
    return openOnly
      ? db.prepare('SELECT * FROM incidents WHERE open = 1 ORDER BY id DESC').all()
      : db.prepare('SELECT * FROM incidents ORDER BY id DESC LIMIT 500').all();
  };
  const resolveIncident = (id) =>
    db.prepare('UPDATE incidents SET open = 0 WHERE id = ?').run(id).changes > 0;

  /* Announcements */
  const createAnnouncement = (routeId, msg) => {
    const r = db.prepare('INSERT INTO announcements (ts, route_id, msg) VALUES (?,?,?)')
      .run(Date.now(), routeId || 'ALL', msg);
    return r.lastInsertRowid;
  };
  const listAnnouncements = (routeId) => {
    return db.prepare('SELECT * FROM announcements WHERE (? IS NULL OR route_id = ? OR route_id = \'ALL\') ORDER BY id DESC LIMIT 50')
      .all(routeId || null, routeId || null);
  };
  const deleteAnnouncement = (id) =>
    db.prepare('DELETE FROM announcements WHERE id = ?').run(id).changes > 0;

  /* Lost and Found */
  const reportLostItem = (who, contact, msg) => {
    const r = db.prepare('INSERT INTO lost_and_found (ts, who, contact, msg, open) VALUES (?,?,?,?,1)')
      .run(Date.now(), who, contact || '', msg);
    return r.lastInsertRowid;
  };
  const listLostItems = (openOnly) => {
    return openOnly
      ? db.prepare('SELECT * FROM lost_and_found WHERE open = 1 ORDER BY id DESC').all()
      : db.prepare('SELECT * FROM lost_and_found ORDER BY id DESC LIMIT 200').all();
  };
  const resolveLostItem = (id) =>
    db.prepare('UPDATE lost_and_found SET open = 0 WHERE id = ?').run(id).changes > 0;

  /* Ride Feedback */
  const saveFeedback = (roll, name, routeId, rating, msg) => {
    const r = db.prepare('INSERT INTO ride_feedback (ts, roll_number, student_name, route_id, rating, msg) VALUES (?,?,?,?,?,?)')
      .run(Date.now(), roll, name, routeId || 'route-14', rating, msg);
    return r.lastInsertRowid;
  };
  const listFeedback = () =>
    db.prepare('SELECT * FROM ride_feedback ORDER BY id DESC LIMIT 500').all();

  /* Mobile Phone & OTP Verification */
  const saveOtp = (arg1, arg2, arg3, arg4) => {
    let roll, userType, phone, otp;
    if (arg3 === undefined) {
      phone = String(arg1 || '');
      otp = String(arg2 || '');
      roll = phone;
      userType = 'STUDENT';
    } else {
      roll = String(arg1 || '');
      userType = String(arg2 || 'STUDENT');
      phone = String(arg3 || '');
      otp = String(arg4 || '');
    }
    const expiresAt = Date.now() + 5 * 60 * 1000;
    // Key by (account_roll, user_type, purpose). Resending a code preserves failed attempts.
    const existing = db.prepare("SELECT attempts FROM otp_verifications WHERE account_roll = ? AND user_type = ? AND purpose = 'PHONE_VERIFY'")
      .get(roll, userType);
    const attempts = existing ? Number(existing.attempts || 0) : 0;
    db.prepare(`INSERT INTO otp_verifications
      (account_roll, user_type, purpose, phone_number, otp, expires_at, created_at, attempts)
      VALUES (?, ?, 'PHONE_VERIFY', ?, ?, ?, ?, ?)
      ON CONFLICT(account_roll, user_type, purpose) DO UPDATE SET
        phone_number = excluded.phone_number,
        otp = excluded.otp,
        expires_at = excluded.expires_at,
        created_at = excluded.created_at`)
      .run(roll, userType, phone, String(otp), expiresAt, Date.now(), attempts);
  };

  const verifyOtp = (arg1, arg2, arg3, arg4) => {
    let roll, userType, phone, otp;
    if (arg3 === undefined) {
      phone = String(arg1 || '');
      otp = String(arg2 || '');
      roll = phone;
      userType = 'STUDENT';
    } else {
      roll = String(arg1 || '');
      userType = String(arg2 || 'STUDENT');
      phone = String(arg3 || '');
      otp = String(arg4 || '');
    }
    const row = db.prepare(`SELECT * FROM otp_verifications
      WHERE account_roll = ? AND user_type = ? AND purpose = 'PHONE_VERIFY' AND expires_at > ?`)
      .get(roll, userType, Date.now());
    if (!row) return false;
    const currentAttempts = (row.attempts || 0) + 1;
    if (currentAttempts > 5) {
      db.prepare("DELETE FROM otp_verifications WHERE account_roll = ? AND user_type = ? AND purpose = 'PHONE_VERIFY'")
        .run(roll, userType);
      return false;
    }
    if (row.phone_number === phone && row.otp === String(otp).trim()) {
      db.prepare("DELETE FROM otp_verifications WHERE account_roll = ? AND user_type = ? AND purpose = 'PHONE_VERIFY'")
        .run(roll, userType);
      return true;
    }
    db.prepare("UPDATE otp_verifications SET attempts = ? WHERE account_roll = ? AND user_type = ? AND purpose = 'PHONE_VERIFY'")
      .run(currentAttempts, roll, userType);
    return false;
  };

  /* Password Reset Codes (₹0 Self-Service + Admin Desk / Telegram) */
  const savePasswordResetCode = (rollNumber, contactLabel, code, ttlMs = 15 * 60 * 1000) => {
    const roll = String(rollNumber || '').trim().toUpperCase();
    if (!roll) return false;
    const nowMs = Date.now();
    const expiresAt = nowMs + Math.max(60_000, Number(ttlMs) || 15 * 60 * 1000);
    db.prepare(`
      INSERT INTO otp_verifications
        (account_roll, user_type, purpose, phone_number, otp, expires_at, created_at, attempts)
      VALUES (?, 'STUDENT', 'PASSWORD_RESET', ?, ?, ?, ?, 0)
      ON CONFLICT(account_roll, user_type, purpose) DO UPDATE SET
        phone_number = excluded.phone_number,
        otp = excluded.otp,
        expires_at = excluded.expires_at,
        created_at = excluded.created_at,
        attempts = 0
    `).run(roll, String(contactLabel || ''), String(code || '').trim(), expiresAt, nowMs);
    return true;
  };

  const verifyPasswordResetCode = (rollNumber, code) => {
    const roll = String(rollNumber || '').trim().toUpperCase();
    const row = db.prepare(`
      SELECT * FROM otp_verifications
      WHERE account_roll = ? AND user_type = 'STUDENT' AND purpose = 'PASSWORD_RESET'
    `).get(roll);
    if (!row) return { ok: false, reason: 'NOT_FOUND' };
    if (Number(row.expires_at) < Date.now()) {
      db.prepare("DELETE FROM otp_verifications WHERE account_roll = ? AND user_type = 'STUDENT' AND purpose = 'PASSWORD_RESET'")
        .run(roll);
      return { ok: false, reason: 'EXPIRED' };
    }
    const prevAttempts = Number(row.attempts || 0);
    if (prevAttempts >= 5) {
      db.prepare("DELETE FROM otp_verifications WHERE account_roll = ? AND user_type = 'STUDENT' AND purpose = 'PASSWORD_RESET'")
        .run(roll);
      return { ok: false, reason: 'MAX_ATTEMPTS' };
    }
    const expectedBuf = Buffer.from(String(row.otp || '').trim(), 'utf8');
    const providedBuf = Buffer.from(String(code || '').trim(), 'utf8');
    const match =
      expectedBuf.length > 0 &&
      expectedBuf.length === providedBuf.length &&
      crypto.timingSafeEqual(expectedBuf, providedBuf);

    if (!match) {
      const nextAttempts = prevAttempts + 1;
      if (nextAttempts >= 5) {
        db.prepare("DELETE FROM otp_verifications WHERE account_roll = ? AND user_type = 'STUDENT' AND purpose = 'PASSWORD_RESET'")
          .run(roll);
        return { ok: false, reason: 'MAX_ATTEMPTS' };
      }
      db.prepare("UPDATE otp_verifications SET attempts = ? WHERE account_roll = ? AND user_type = 'STUDENT' AND purpose = 'PASSWORD_RESET'")
        .run(nextAttempts, roll);
      return { ok: false, reason: 'INVALID_CODE' };
    }

    db.prepare("DELETE FROM otp_verifications WHERE account_roll = ? AND user_type = 'STUDENT' AND purpose = 'PASSWORD_RESET'")
      .run(roll);
    return { ok: true };
  };

  const listActivePasswordResetRequests = () => {
    return db.prepare(`
      SELECT o.account_roll, COALESCE(s.name, '') AS name, o.phone_number, o.otp, o.expires_at, o.created_at
      FROM otp_verifications o
      LEFT JOIN students s ON UPPER(s.roll_number) = UPPER(o.account_roll)
      WHERE o.user_type = 'STUDENT' AND o.purpose = 'PASSWORD_RESET' AND o.expires_at > ?
      ORDER BY o.created_at DESC
    `).all(Date.now());
  };

  const updateStudentPhone = (roll, phone) => {
    return db.prepare('UPDATE students SET student_phone = ?, student_phone_verified = 1 WHERE roll_number = ?')
      .run(phone, roll).changes > 0;
  };

  const updateParentPhone = (roll, phone) => {
    return db.prepare('UPDATE students SET parent_phone = ?, parent_phone_verified = 1 WHERE roll_number = ?')
      .run(phone, roll).changes > 0;
  };

  const updateStudentPhoneVerified = (roll) => {
    return db.prepare('UPDATE students SET student_phone_verified = 1 WHERE roll_number = ?')
      .run(roll).changes > 0;
  };

  const updateParentPhoneVerified = (roll) => {
    return db.prepare('UPDATE students SET parent_phone_verified = 1 WHERE roll_number = ?')
      .run(roll).changes > 0;
  };

  /* Mobile Push / SMS Notifications */
  const logNotification = (n) => {
    const r = db.prepare(`INSERT INTO mobile_notifications 
      (ts, recipient_type, roll_number, phone_number, category, title, message, status, channel) 
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(n.ts || Date.now(), n.recipient_type || 'ALL', n.roll_number || null, n.phone_number || '', n.category || 'INFO', n.title || 'Transit Alert', n.message, n.status || 'DELIVERED', n.channel || 'IN_APP_SMS');
    return r.lastInsertRowid;
  };

  const listNotifications = (roll, userType) => {
    return db.prepare(`SELECT * FROM mobile_notifications 
      WHERE (roll_number IS NULL OR roll_number = ? OR roll_number = 'ALL')
        AND (recipient_type = 'ALL' OR recipient_type = ?)
      ORDER BY ts DESC LIMIT 50`).all(roll || 'ALL', userType || 'STUDENT');
  };

  /* Preferences */
  const getNotificationPreferences = (roll, userType) => {
    const row = db.prepare('SELECT * FROM notification_preferences WHERE roll_number = ? AND user_type = ?')
      .get(roll, userType);
    if (row) return row;
    return {
      roll_number: roll,
      user_type: userType,
      trip_started: 1,
      approaching_stop: 1,
      boarded: 1,
      traffic_delay: 1,
      campus_arrived: 1,
      emergency_broadcast: 1
    };
  };

  const saveNotificationPreferences = (roll, userType, prefs) => {
    return db.prepare(`INSERT OR REPLACE INTO notification_preferences 
      (roll_number, user_type, trip_started, approaching_stop, boarded, traffic_delay, campus_arrived, emergency_broadcast)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(
        roll,
        userType,
        prefs.trip_started ? 1 : 0,
        prefs.approaching_stop ? 1 : 0,
        prefs.boarded ? 1 : 0,
        prefs.traffic_delay ? 1 : 0,
        prefs.campus_arrived ? 1 : 0,
        prefs.emergency_broadcast ? 1 : 0
      ).changes > 0;
  };

  /* Route Optimization Engine (Server-Authoritative, Fail-Safe Area Skip) */
  function computeRouteOptimization(routeId, day) {
    const normRoute = normalizeRouteTopologyId(routeId);
    const topology = ROUTE_TOPOLOGY[normRoute] || ROUTE_TOPOLOGY['route-14'];
    const planRow = db.prepare('SELECT * FROM route_plans WHERE route_id = ? AND day = ?').get(normRoute, day);
    
    const locked = Boolean(planRow?.locked);
    const lockedAt = planRow?.locked_at || null;
    let overrideKeepClusters = [];
    try {
      if (planRow?.override_keep_clusters_json) {
        overrideKeepClusters = JSON.parse(planRow.override_keep_clusters_json);
      }
    } catch {}

    let lockedSkippedClusters = [];
    try {
      if (planRow?.skipped_clusters_json) {
        lockedSkippedClusters = JSON.parse(planRow.skipped_clusters_json);
      }
    } catch {}

    // Get all registered students on this route
    const students = listStudentsForRoute(normRoute);
    const unmappedStudents = [];

    for (const s of students) {
      if (!s.stop_id || !s.area_cluster_id) {
        const resolved = resolveStopForStudent(s.route_id, s.pickup_stop);
        if (resolved) {
          s.stop_id = resolved.stopId;
          s.area_cluster_id = resolved.areaClusterId;
          try {
            db.prepare('UPDATE students SET stop_id = ?, area_cluster_id = ? WHERE roll_number = ?')
              .run(resolved.stopId, resolved.areaClusterId, s.roll_number);
          } catch {}
        } else {
          unmappedStudents.push({
            rollNumber: s.roll_number,
            name: s.name,
            pickupStop: s.pickup_stop,
          });
        }
      }
    }

    // Query active absences for day
    const absentRows = db.prepare('SELECT roll_number FROM absences WHERE day = ?').all(day);
    const absentRolls = new Set(absentRows.map((r) => String(r.roll_number).toUpperCase()));

    const clusters = [];
    for (const cl of topology.clusters || []) {
      const clusterStudents = students.filter((s) => s.area_cluster_id === cl.areaClusterId);
      const totalStudents = clusterStudents.length;
      const studentCount = clusterStudents.filter((s) => (s.rider_type || 'STUDENT').toUpperCase() === 'STUDENT').length;
      const facultyCount = clusterStudents.filter((s) => (s.rider_type || 'STUDENT').toUpperCase() === 'FACULTY').length;
      const absentStudents = clusterStudents.filter((s) => absentRolls.has(String(s.roll_number).toUpperCase())).length;
      const comingStudents = totalStudents - absentStudents;
      const isAdminKept = overrideKeepClusters.includes(cl.areaClusterId);
      const isCampus = cl.areaClusterId === 'cluster-campus';

      const stops = (cl.stopIds || []).map((stopId) => {
        const stopObj = topology.stops.find((s) => s.id === stopId);
        const stopStudents = clusterStudents.filter((s) => s.stop_id === stopId);
        const stopAbsent = stopStudents.filter((s) => absentRolls.has(String(s.roll_number).toUpperCase())).length;
        const stopStudentCount = stopStudents.filter((s) => (s.rider_type || 'STUDENT').toUpperCase() === 'STUDENT').length;
        const stopFacultyCount = stopStudents.filter((s) => (s.rider_type || 'STUDENT').toUpperCase() === 'FACULTY').length;
        return {
          stopId,
          stopName: stopObj ? stopObj.name : stopId,
          shortName: stopObj ? (stopObj.shortName || stopObj.name) : stopId,
          total: stopStudents.length,
          totalStudents: stopStudents.length,
          absent: stopAbsent,
          coming: stopStudents.length - stopAbsent,
          studentCount: stopStudentCount,
          facultyCount: stopFacultyCount,
        };
      });

      let canSkip = false;
      let reason = '';
      if (isCampus) {
        canSkip = false;
        reason = 'Campus hub is never skippable';
      } else if (isAdminKept) {
        canSkip = false;
        reason = 'Admin Override: Forced Active';
      } else if (unmappedStudents.length > 0) {
        canSkip = false;
        reason = `Route has ${unmappedStudents.length} unmapped student(s) — Skip disabled for safety`;
      } else if (totalStudents === 0) {
        canSkip = false;
        reason = 'No registered students in cluster — Skip disabled';
      } else if (comingStudents === 0) {
        canSkip = true;
        reason = `All ${totalStudents} student(s) across stops marked Not Coming — Reroute Active`;
      } else {
        canSkip = false;
        reason = `${comingStudents} of ${totalStudents} student(s) still coming — Must Stop`;
      }

      clusters.push({
        areaClusterId: cl.areaClusterId,
        clusterId: cl.areaClusterId,
        areaClusterName: cl.areaClusterName,
        clusterName: cl.areaClusterName,
        stopIds: cl.stopIds,
        totalStudents,
        totalRegisteredStudents: totalStudents,
        studentCount,
        facultyCount,
        absentStudents,
        comingStudents,
        canSkip,
        isSkipped: canSkip,
        isCampus,
        isAdminKept,
        reason,
        stops,
        estimatedMinutesSaved: cl.estimatedMinutesSaved || 0,
        estimatedKmSaved: cl.estimatedKmSaved || 0,
      });
    }

    let skippedClusterIds = [];
    if (locked) {
      skippedClusterIds = lockedSkippedClusters;
    } else {
      skippedClusterIds = clusters.filter((c) => c.canSkip).map((c) => c.areaClusterId);
    }

    for (const c of clusters) {
      c.isSkipped = skippedClusterIds.includes(c.areaClusterId);
    }

    const allStops = topology.stops || [];
    const skippedStopIds = allStops.filter((s) => skippedClusterIds.includes(s.areaClusterId)).map((s) => s.id);
    const activeStopIds = allStops.filter((s) => !skippedClusterIds.includes(s.areaClusterId)).map((s) => s.id);

    let estimatedMinutesSaved = 0;
    let estimatedKmSaved = 0;
    for (const clId of skippedClusterIds) {
      const cl = topology.clusters.find((c) => c.areaClusterId === clId);
      if (cl) {
        estimatedMinutesSaved += cl.estimatedMinutesSaved || 0;
        estimatedKmSaved += cl.estimatedKmSaved || 0;
      }
    }
    estimatedKmSaved = Number(estimatedKmSaved.toFixed(2));

    // Persist plan if not locked
    const nowIso = new Date().toISOString();
    if (!locked) {
      db.prepare(`
        INSERT INTO route_plans (route_id, day, skipped_clusters_json, override_keep_clusters_json, locked, estimated_minutes_saved, estimated_km_saved, updated_at)
        VALUES (?, ?, ?, ?, 0, ?, ?, ?)
        ON CONFLICT(route_id, day) DO UPDATE SET
          skipped_clusters_json = excluded.skipped_clusters_json,
          estimated_minutes_saved = excluded.estimated_minutes_saved,
          estimated_km_saved = excluded.estimated_km_saved,
          updated_at = excluded.updated_at
        WHERE route_plans.locked = 0
      `).run(
        normRoute,
        day,
        JSON.stringify(skippedClusterIds),
        JSON.stringify(overrideKeepClusters),
        estimatedMinutesSaved,
        estimatedKmSaved,
        nowIso
      );
    }

    const totalRouteStudents = students.length;
    const studentCount = students.filter((s) => (s.rider_type || 'STUDENT').toUpperCase() === 'STUDENT').length;
    const facultyCount = students.filter((s) => (s.rider_type || 'STUDENT').toUpperCase() === 'FACULTY').length;
    const absentRouteStudents = students.filter((s) => absentRolls.has(String(s.roll_number).toUpperCase())).length;

    return {
      routeId: normRoute,
      day,
      locked,
      lockedAt,
      cutoffTimeIst: '1h pre-departure',
      totalRouteStudents,
      studentCount,
      facultyCount,
      absentRouteStudents,
      expectedRouteStudents: totalRouteStudents - absentRouteStudents,
      skippedClusterIds,
      activeStopIds,
      skippedStopIds,
      clusters,
      unmappedStudents,
      estimatedMinutesSaved,
      estimatedKmSaved,
      overrideKeepClusters,
    };
  }

  function setRoutePlanLock(routeId, day, lock) {
    const normRoute = normalizeRouteTopologyId(routeId);
    const nowIso = new Date().toISOString();
    let skippedJson = '[]';
    if (lock) {
      // Snapshot the calculated live skipped clusters at lock time
      const live = computeRouteOptimization(normRoute, day);
      skippedJson = JSON.stringify(live.skippedClusterIds || []);
    }
    const existing = db.prepare('SELECT * FROM route_plans WHERE route_id = ? AND day = ?').get(normRoute, day);
    if (!existing) {
      db.prepare(`INSERT INTO route_plans (route_id, day, skipped_clusters_json, override_keep_clusters_json, locked, locked_at, updated_at)
        VALUES (?, ?, ?, '[]', ?, ?, ?)`).run(normRoute, day, skippedJson, lock ? 1 : 0, lock ? nowIso : null, nowIso);
    } else {
      if (lock) {
        db.prepare('UPDATE route_plans SET locked = 1, locked_at = ?, skipped_clusters_json = ?, updated_at = ? WHERE route_id = ? AND day = ?')
          .run(nowIso, skippedJson, nowIso, normRoute, day);
      } else {
        db.prepare('UPDATE route_plans SET locked = 0, locked_at = NULL, updated_at = ? WHERE route_id = ? AND day = ?')
          .run(nowIso, normRoute, day);
      }
    }
    return computeRouteOptimization(normRoute, day);
  }

  function setClusterOverride(routeId, day, clusterId, keep) {
    const normRoute = normalizeRouteTopologyId(routeId);
    const nowIso = new Date().toISOString();
    const existing = db.prepare('SELECT * FROM route_plans WHERE route_id = ? AND day = ?').get(normRoute, day);
    let overrides = [];
    try {
      if (existing?.override_keep_clusters_json) {
        overrides = JSON.parse(existing.override_keep_clusters_json);
      }
    } catch {}
    if (keep) {
      if (!overrides.includes(clusterId)) overrides.push(clusterId);
    } else {
      overrides = overrides.filter((c) => c !== clusterId);
    }
    if (!existing) {
      db.prepare(`INSERT INTO route_plans (route_id, day, skipped_clusters_json, override_keep_clusters_json, locked, updated_at)
        VALUES (?, ?, '[]', ?, 0, ?)`).run(normRoute, day, JSON.stringify(overrides), nowIso);
    } else {
      db.prepare('UPDATE route_plans SET override_keep_clusters_json = ?, updated_at = ? WHERE route_id = ? AND day = ?')
        .run(JSON.stringify(overrides), nowIso, normRoute, day);
    }
    return computeRouteOptimization(normRoute, day);
  }

  function getRoutePlan(routeId, day) {
    const normRoute = normalizeRouteTopologyId(routeId);
    return db.prepare('SELECT * FROM route_plans WHERE route_id = ? AND day = ?').get(normRoute, day);
  }

  function savePushSubscription(roll, userType, sub) {
    if (!sub || !sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return false;
    const now = Date.now();
    db.prepare(`
      INSERT INTO push_subscriptions (roll_number, user_type, endpoint, p256dh, auth, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET
        roll_number = excluded.roll_number,
        user_type = excluded.user_type,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        created_at = excluded.created_at
    `).run(String(roll).trim(), String(userType).trim(), String(sub.endpoint).trim(), String(sub.keys.p256dh).trim(), String(sub.keys.auth).trim(), now);
    return true;
  }

  function deletePushSubscription(endpoint) {
    if (!endpoint) return false;
    const res = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(String(endpoint).trim());
    return res.changes > 0;
  }

  function listPushSubscriptions({ roll, routeId, userType } = {}) {
    let sql = 'SELECT * FROM push_subscriptions WHERE 1=1';
    const params = [];
    if (roll) {
      sql += ' AND roll_number = ?';
      params.push(String(roll).trim());
    } else if (routeId) {
      sql += ` AND (roll_number IN (SELECT roll_number FROM students WHERE route_id = ?) OR user_type IN ('DRIVER', 'ADMIN'))`;
      params.push(String(routeId).trim());
    }
    if (userType) {
      sql += ' AND user_type = ?';
      params.push(String(userType).trim());
    }
    sql += ' ORDER BY id ASC';
    return db.prepare(sql).all(...params);
  }

  function recordStopSegmentDuration(routeId, fromStopId, toStopId, durationSec, recordedAt = Date.now()) {
    const d = Number(durationSec);
    if (!Number.isFinite(d) || d < 30 || d > 3600) return false;
    if (!fromStopId || !toStopId) return false;
    const normRoute = normalizeRouteTopologyId(routeId);

    // Compute IST day_of_week (0-6) and shift (MORNING if IST hour < 12 else EVENING)
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(recordedAt + istOffsetMs);
    const dayOfWeek = istDate.getUTCDay();
    const istHour = istDate.getUTCHours();
    const shift = istHour < 12 ? 'MORNING' : 'EVENING';

    db.prepare(`
      INSERT INTO stop_segment_history (route_id, from_stop_id, to_stop_id, day_of_week, shift, duration_sec, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(normRoute, String(fromStopId).trim(), String(toStopId).trim(), dayOfWeek, shift, Math.round(d), recordedAt);
    return true;
  }

  function getHistoricalSegmentMedians(routeId, dayOfWeek, shift, lookbackDays = 14) {
    const normRoute = normalizeRouteTopologyId(routeId);
    const cutoff = Date.now() - (lookbackDays * 864e5);
    let sql = 'SELECT from_stop_id, to_stop_id, duration_sec FROM stop_segment_history WHERE route_id = ? AND recorded_at >= ?';
    const params = [normRoute, cutoff];
    if (dayOfWeek !== undefined && dayOfWeek !== null) {
      sql += ' AND day_of_week = ?';
      params.push(Number(dayOfWeek));
    }
    if (shift) {
      sql += ' AND shift = ?';
      params.push(String(shift).trim());
    }
    sql += ' ORDER BY from_stop_id, to_stop_id, duration_sec ASC';
    const rows = db.prepare(sql).all(...params);

    const grouped = new Map();
    for (const r of rows) {
      const key = `${r.from_stop_id}->${r.to_stop_id}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(r.duration_sec);
    }

    const medians = {};
    for (const [key, durations] of grouped.entries()) {
      if (durations.length < 3) continue;
      const n = durations.length;
      let medianSec;
      if (n % 2 === 1) {
        medianSec = durations[Math.floor(n / 2)];
      } else {
        medianSec = Math.round((durations[n / 2 - 1] + durations[n / 2]) / 2);
      }
      medians[key] = { medianSec, sampleCount: n };
    }
    return medians;
  }

  function bulkImportRiders(riders) {
    if (!Array.isArray(riders)) return { success: false, error: 'riders must be an array' };
    const maxRows = 500;
    const slice = riders.slice(0, maxRows);

    return tx(() => {
      let createdCount = 0;
      let skippedExistingCount = 0;
      const errors = [];
      const credentials = [];
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

      for (let i = 0; i < slice.length; i++) {
        const row = slice[i];
        const rowIdx = i + 1;
        const rollNumber = typeof row?.rollNumber === 'string' ? row.rollNumber.trim() : (typeof row?.roll_number === 'string' ? row.roll_number.trim() : '');
        const name = typeof row?.name === 'string' ? row.name.trim() : (typeof row?.student_name === 'string' ? row.student_name.trim() : '');
        const routeId = typeof row?.routeId === 'string' ? row.routeId.trim() : (typeof row?.route_id === 'string' ? row.route_id.trim() : '');
        const pickupStop = typeof row?.pickupStop === 'string' ? row.pickupStop.trim() : (typeof row?.pickup_stop === 'string' ? row.pickup_stop.trim() : '');

        if (!rollNumber || !name || !routeId || !pickupStop) {
          errors.push({
            row: rowIdx,
            rollNumber: rollNumber || 'UNKNOWN',
            error: 'Missing required field (rollNumber, name, routeId, pickupStop)',
          });
          continue;
        }

        const existing = db.prepare('SELECT roll_number FROM students WHERE roll_number = ?').get(rollNumber);
        if (existing) {
          skippedExistingCount++;
          continue;
        }

        const temporaryPassword = crypto.randomBytes(6).toString('base64url');
        const passwordHash = hashPassword(temporaryPassword);

        const routeNorm = normalizeRouteTopologyId(routeId);
        const resolved = resolveStopForStudent(routeNorm, pickupStop);
        const stopId = row.stopId || row.stop_id || resolved?.stopId || pickupStop;
        const clusterId = row.areaClusterId || row.area_cluster_id || resolved?.areaClusterId || 'CENTRAL';
        const rawType = (row.riderType || row.rider_type || '').toUpperCase();
        const riderType = rawType === 'FACULTY' ? 'FACULTY' : 'STUDENT';
        const gender = row.gender || 'M';
        const program = row.program || (riderType === 'FACULTY' ? 'Faculty Member' : 'Engineering');
        const parentName = row.parentName || row.parent_name || (riderType === 'FACULTY' ? 'N/A' : 'Parent');
        const parentPhone = row.parentPhone || row.parent_phone || '+91 00000 00000';

        db.prepare(`
          INSERT INTO students (
            roll_number, name, program, route_id, pickup_stop, parent_name, parent_phone,
            pass_status, fee_status, registered_at, last_active, password_hash, stop_id,
            area_cluster_id, rider_type, gender, must_change_password
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'PAID', ?, ?, ?, ?, ?, ?, ?, 1)
        `).run(
          rollNumber,
          name,
          program,
          routeNorm,
          pickupStop,
          parentName,
          parentPhone,
          now,
          now,
          passwordHash,
          stopId,
          clusterId,
          riderType,
          gender
        );

        createdCount++;
        credentials.push({
          rollNumber,
          name,
          routeId: routeNorm,
          pickupStop,
          riderType,
          temporaryPassword,
        });
      }

      return {
        success: true,
        createdCount,
        skippedExistingCount,
        errors,
        credentials,
      };
    });
  }

  function getCachedRouteGeometry(cacheKey, maxAgeMs = 30 * 24 * 3600 * 1000) {
    if (typeof cacheKey !== 'string' || !cacheKey) return null;
    const row = db.prepare('SELECT route_id, geometry_json, distance_km, duration_min, updated_at FROM route_geometry_cache WHERE cache_key = ?').get(cacheKey);
    if (!row) return null;
    if (maxAgeMs <= 0 || (Date.now() - row.updated_at > maxAgeMs)) return null;
    try {
      return {
        routeId: row.route_id,
        coordinates: JSON.parse(row.geometry_json),
        distanceKm: row.distance_km,
        durationMinutes: row.duration_min,
        updatedAt: row.updated_at,
      };
    } catch {
      return null;
    }
  }

  function saveCachedRouteGeometry(cacheKey, routeId, coordinates, distanceKm, durationMinutes) {
    if (!cacheKey || !routeId || !Array.isArray(coordinates)) return false;
    db.prepare(`
      INSERT INTO route_geometry_cache (cache_key, route_id, geometry_json, distance_km, duration_min, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        route_id = excluded.route_id,
        geometry_json = excluded.geometry_json,
        distance_km = excluded.distance_km,
        duration_min = excluded.duration_min,
        updated_at = excluded.updated_at
    `).run(
      String(cacheKey),
      String(routeId),
      JSON.stringify(coordinates),
      Number(distanceKm) || 0,
      Math.round(Number(durationMinutes) || 0),
      Date.now()
    );
    return true;
  }

  /* ---------------- Driver Stop Dwell & Utility Audit Logs ---------------- */
  function recordStopDwell(routeId, stopId, stopName, arrivedAtIso, departedAtIso, dwellSec) {
    const normRoute = normalizeRouteTopologyId(routeId);
    const cleanSec = Math.max(0, Math.round(Number(dwellSec) || 0));
    const flag = cleanSec < 45 ? 'TOO_SHORT' : cleanSec > 300 ? 'TOO_LONG' : 'NORMAL';
    const recordedAt = Date.now();

    db.prepare(`
      INSERT INTO stop_dwell_logs (route_id, stop_id, stop_name, arrived_at, departed_at, dwell_sec, flag, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      normRoute,
      String(stopId || '').trim() || 'stop',
      String(stopName || '').trim() || 'Stop',
      String(arrivedAtIso || new Date(recordedAt - cleanSec * 1000).toISOString()),
      String(departedAtIso || new Date(recordedAt).toISOString()),
      cleanSec,
      flag,
      recordedAt
    );

    try {
      db.prepare('DELETE FROM stop_dwell_logs WHERE recorded_at < ?').run(recordedAt - 60 * 864e5);
    } catch {}

    return { routeId: normRoute, stopId, stopName, arrivedAt: arrivedAtIso, departedAt: departedAtIso, dwellSec: cleanSec, flag, recordedAt };
  }

  function getDriverUtilityLogs(routeId = null, limit = 100) {
    const safeLimit = Math.max(1, Math.min(500, Math.round(Number(limit) || 100)));
    if (routeId) {
      const normRoute = normalizeRouteTopologyId(routeId);
      return db.prepare('SELECT * FROM stop_dwell_logs WHERE route_id = ? ORDER BY recorded_at DESC, id DESC LIMIT ?')
        .all(normRoute, safeLimit);
    }
    return db.prepare('SELECT * FROM stop_dwell_logs ORDER BY recorded_at DESC, id DESC LIMIT ?').all(safeLimit);
  }

  /* ---------------- Self-Signup & Transport Office 1-Click Verification ---------------- */
  function createPendingStudent({ rollNumber, name, email, passwordHash, studentPhone, pickupStop }) {
    const roll = String(rollNumber || '').trim().toUpperCase();
    if (!roll) return false;
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const cleanPhone = String(studentPhone || '').replace(/\D/g, '').slice(-10);
    const r = db.prepare(`
      INSERT OR IGNORE INTO students (
        roll_number, name, email, program, route_id, pickup_stop,
        parent_name, parent_phone, pass_status, fee_status,
        registered_at, last_active, password_hash,
        student_phone, student_phone_verified, must_change_password,
        rider_type, verification_status
      ) VALUES (?, ?, ?, 'B.Tech', 'UNASSIGNED', ?, 'Parent', '', 'ACTIVE', 'PAID', ?, ?, ?, ?, 0, 0, 'STUDENT', 'PENDING_VERIFICATION')
    `).run(
      roll,
      String(name || '').trim(),
      String(email || '').trim().toLowerCase(),
      String(pickupStop || '').trim(),
      now,
      now,
      passwordHash || null,
      cleanPhone
    );
    return r.changes === 1;
  }

  function listPendingVerifications() {
    return db.prepare(`
      SELECT roll_number, name, email, student_phone, pickup_stop, registered_at, verification_status
      FROM students
      WHERE verification_status = 'PENDING_VERIFICATION'
      ORDER BY roll_number ASC
    `).all();
  }

  function verifyStudentRegistration(rollNumber, { approved, routeId, pickupStop } = {}) {
    const roll = String(rollNumber || '').trim().toUpperCase();
    const existing = getStudentRow(roll);
    if (!existing) return null;

    if (approved) {
      const targetRoute = routeId
        ? normalizeRouteTopologyId(routeId)
        : (existing.route_id && existing.route_id !== 'UNASSIGNED' ? normalizeRouteTopologyId(existing.route_id) : 'route-51');
      const targetStop = (pickupStop && String(pickupStop).trim()) || existing.pickup_stop || 'Erragadda';
      const resolved = resolveStopForStudent(targetRoute, targetStop);
      db.prepare(`
        UPDATE students
        SET verification_status = 'VERIFIED',
            route_id = ?,
            pickup_stop = ?,
            stop_id = ?,
            area_cluster_id = ?
        WHERE roll_number = ?
      `).run(
        targetRoute,
        targetStop,
        resolved?.stopId || null,
        resolved?.areaClusterId || null,
        roll
      );
      return {
        success: true,
        rollNumber: roll,
        verificationStatus: 'VERIFIED',
        routeId: targetRoute,
        pickupStop: targetStop,
        stopId: resolved?.stopId || null,
      };
    }

    db.prepare("UPDATE students SET verification_status = 'REJECTED' WHERE roll_number = ?").run(roll);
    return {
      success: true,
      rollNumber: roll,
      verificationStatus: 'REJECTED',
    };
  }

  /* ---------------- Multi-Admin Access Accounts ---------------- */
  function getAdminUser(adminId) {
    const cleanId = String(adminId || '').trim();
    if (!cleanId) return null;
    return db.prepare('SELECT * FROM admin_users WHERE LOWER(admin_id) = LOWER(?)').get(cleanId) || null;
  }

  function hasAnyActiveAdmin() {
    return Boolean(db.prepare('SELECT 1 FROM admin_users WHERE active = 1 LIMIT 1').get());
  }

  function listAdminUsers() {
    return db
      .prepare('SELECT admin_id, name, active, session_version, created_by, created_at FROM admin_users ORDER BY created_at ASC, admin_id ASC')
      .all();
  }

  function createAdminUser({ adminId, name, passwordHash, createdBy }) {
    const cleanId = String(adminId || '').trim();
    const cleanName = String(name || '').trim() || cleanId;
    if (!cleanId || !passwordHash) return null;
    if (getAdminUser(cleanId)) return null;
    const createdAt = new Date().toISOString();
    db.prepare(`
      INSERT INTO admin_users (admin_id, name, password_hash, active, session_version, created_by, created_at)
      VALUES (?, ?, ?, 1, 0, ?, ?)
    `).run(cleanId, cleanName, passwordHash, createdBy ? String(createdBy).trim() : null, createdAt);
    return {
      admin_id: cleanId,
      name: cleanName,
      active: 1,
      session_version: 0,
      created_by: createdBy ? String(createdBy).trim() : null,
      created_at: createdAt,
    };
  }

  function setAdminUserActive(adminId, active) {
    const existing = getAdminUser(adminId);
    if (!existing) return null;
    const nextActive = active ? 1 : 0;
    const bumpSession = nextActive === 0 ? 1 : 0;
    db.prepare(`
      UPDATE admin_users
      SET active = ?, session_version = session_version + ?
      WHERE LOWER(admin_id) = LOWER(?)
    `).run(nextActive, bumpSession, existing.admin_id);
    const updated = getAdminUser(existing.admin_id);
    if (!updated) return null;
    return {
      admin_id: updated.admin_id,
      name: updated.name,
      active: updated.active,
      session_version: updated.session_version,
      created_by: updated.created_by,
      created_at: updated.created_at,
    };
  }

  function setAdminPasswordHash(adminId, passwordHash) {
    const existing = getAdminUser(adminId);
    if (!existing) return false;
    db.prepare('UPDATE admin_users SET password_hash = ?, session_version = session_version + 1 WHERE LOWER(admin_id) = LOWER(?)')
      .run(passwordHash, existing.admin_id);
    return true;
  }

  return { migrate, tx, getStudentRow, setPasswordHash, touchLastActive, getSessionVersion, isSessionCurrent, revokeStudentSessions, createStudent, claimEvent, pruneEvents, recentCheckIn,
    saveApplication, listApplications, getApplication, reviewApplication, createLinkCode, consumeLinkCode, createParentCode, redeemParentCode,
    activateGracePass, setFeeStatus, canStudentTravel, setAbsence, isAbsent, listAbsences, countAbsencesForRoute, getAssignedStudentCount, listStudentsForRoute,
    getTripState, setTripState, setMustChangePassword, clearMustChangePassword,
    createIncident, listIncidents, resolveIncident, createAnnouncement, listAnnouncements, deleteAnnouncement,
    reportLostItem, listLostItems, resolveLostItem, saveFeedback, listFeedback,
    saveOtp, verifyOtp, savePasswordResetCode, verifyPasswordResetCode, listActivePasswordResetRequests,
    updateStudentPhone, updateParentPhone, updateStudentPhoneVerified, updateParentPhoneVerified, logNotification, listNotifications,
    getNotificationPreferences, saveNotificationPreferences, resetBillingCycle,
    setStopTimer, getStopTimer, clearStopTimer, clearStopTimerIfNoPending, getPendingStopStudentCount, isBoardedToday, isOptedOutToday,
    computeRouteOptimization, setRoutePlanLock, setClusterOverride, getRoutePlan,
    savePushSubscription, deletePushSubscription, listPushSubscriptions,
    recordStopSegmentDuration, getHistoricalSegmentMedians, bulkImportRiders,
    getCachedRouteGeometry, saveCachedRouteGeometry,
    recordStopDwell, getDriverUtilityLogs,
    createPendingStudent, listPendingVerifications, verifyStudentRegistration,
    getAdminUser, hasAnyActiveAdmin, listAdminUsers, createAdminUser, setAdminUserActive, setAdminPasswordHash };
}
