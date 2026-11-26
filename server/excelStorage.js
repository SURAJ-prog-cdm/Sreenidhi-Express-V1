import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';
import * as xlsxModule from 'xlsx';

const XLSX = xlsxModule.default || xlsxModule;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
export const DB_FILE_PATH = process.env.DB_FILE_PATH || path.join(DATA_DIR, 'transitpulse.db');
export const EXCEL_FILE_PATH = process.env.EXCEL_FILE_PATH || path.join(DATA_DIR, 'sreenidhi_transit_master.xlsx');

// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize SQLite with WAL mode for ultra-fast, concurrent, non-blocking ACID transactions
export const db = new DatabaseSync(DB_FILE_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA cache_size = -16000;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS students (
    roll_number TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    program TEXT NOT NULL,
    route_id TEXT NOT NULL,
    pickup_stop TEXT NOT NULL,
    parent_name TEXT NOT NULL,
    parent_phone TEXT NOT NULL,
    pass_status TEXT NOT NULL DEFAULT 'ACTIVE',
    registered_at TEXT NOT NULL,
    last_active TEXT NOT NULL,
    rider_type TEXT NOT NULL DEFAULT 'STUDENT',
    gender TEXT DEFAULT 'M'
  );

  CREATE TABLE IF NOT EXISTS boarding_attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    roll_number TEXT NOT NULL,
    name TEXT,
    route_id TEXT,
    stop_name TEXT,
    event_type TEXT,
    check_in_method TEXT,
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS return_trip_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    roll_number TEXT NOT NULL,
    name TEXT,
    route_id TEXT,
    original_drop TEXT,
    selected_drop TEXT,
    notification_status TEXT
  );

  CREATE TABLE IF NOT EXISTS lost_item_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    claim_id TEXT,
    roll_number TEXT,
    name TEXT,
    route_id TEXT,
    item_type TEXT,
    seat_zone TEXT,
    status TEXT
  );

  CREATE TABLE IF NOT EXISTS parent_alerts_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    alert_id TEXT,
    recipient_name TEXT,
    recipient_phone TEXT,
    category TEXT,
    title TEXT,
    message TEXT,
    delivery_status TEXT
  );

  CREATE TABLE IF NOT EXISTS driver_trip_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    route_id TEXT,
    driver_name TEXT,
    bus_reg TEXT,
    direction TEXT,
    skipped_clusters TEXT,
    fuel_saved TEXT,
    cost_saved TEXT
  );

  CREATE TABLE IF NOT EXISTS alerts_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    alert_id TEXT,
    recipient_name TEXT,
    recipient_phone TEXT,
    category TEXT,
    title TEXT,
    message TEXT,
    delivery_status TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_trip_logs_route_ts ON driver_trip_logs(route_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_parent_alerts_ts ON parent_alerts_log(timestamp);
`);

// 90-day retention pruning for parent alerts on database boot
try {
  const ninetyDaysAgoIso = new Date(Date.now() - 90 * 864e5).toISOString();
  db.prepare('DELETE FROM parent_alerts_log WHERE timestamp < ?').run(ninetyDaysAgoIso);
} catch {
  // Non-fatal if table not yet initialized
}

// Cache prepared statements (previously re-prepared on every call)
const _stmts = new Map();
const prep = (sql) => { let st = _stmts.get(sql); if (!st) { st = db.prepare(sql); _stmts.set(sql, st); } return st; };

// Unified seed students matching official SNIST format & StudentLoginPage demo buttons
const UNIFIED_SEED_STUDENTS = [
  // --- Route 51 Riders (18 Students + 8 Faculty/Staff) ---
  {
    roll_number: '26011CSEAI0109',
    name: 'Makineedi Sai Venkata Syam Suraj',
    program: 'I Year - AIML',
    route_id: 'route-51',
    pickup_stop: 'Erragadda',
    parent_name: 'M. Venkata Rao',
    parent_phone: '+91 98490 00109',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:30:00',
    last_active: '2026-11-22 08:00:00',
    rider_type: 'STUDENT',
    gender: 'M',
  },
  {
    roll_number: '26011CSEAI0052',
    name: 'Derrick Francis Alvares',
    program: 'I Year - AIML',
    route_id: 'route-51',
    pickup_stop: 'Erragadda',
    parent_name: 'F. Alvares',
    parent_phone: '+91 98490 00052',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:30:00',
    last_active: '2026-11-22 08:00:00',
    rider_type: 'STUDENT',
    gender: 'M',
  },
  {
    roll_number: '26011CSEAI0072',
    name: 'Harshit Sunkara',
    program: 'I Year - CSE',
    route_id: 'route-51',
    pickup_stop: 'ESI-Erragadda',
    parent_name: 'S. Ramana',
    parent_phone: '+91 98490 00072',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:30:00',
    last_active: '2026-11-22 08:00:00',
    rider_type: 'STUDENT',
    gender: 'M',
  },
  {
    roll_number: '26011CSEAI0152',
    name: 'Pamukaparthi Rutika',
    program: 'I Year - AIML',
    route_id: 'route-51',
    pickup_stop: 'ESI-Erragadda',
    parent_name: 'P. Sudhakar',
    parent_phone: '+91 98490 00152',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:30:00',
    last_active: '2026-11-22 08:00:00',
    rider_type: 'STUDENT',
    gender: 'F',
  },
  {
    roll_number: '26011CSEAI0112',
    name: 'Mallu Jaswanth Reddy',
    program: 'I Year - AIML',
    route_id: 'route-51',
    pickup_stop: 'Ameerpet',
    parent_name: 'M. Pratap Reddy',
    parent_phone: '+91 98490 00112',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:30:00',
    last_active: '2026-11-22 08:00:00',
    rider_type: 'STUDENT',
    gender: 'M',
  },
  {
    roll_number: '26011CSEAI0172',
    name: 'Velivarthipati Sri Seetha Bhavani Akshita',
    program: 'I Year - AIML',
    route_id: 'route-51',
    pickup_stop: 'Ameerpet',
    parent_name: 'V. Satyanarayana',
    parent_phone: '+91 98490 00172',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:30:00',
    last_active: '2026-11-22 08:00:00',
    rider_type: 'STUDENT',
    gender: 'F',
  },
  {
    roll_number: '26011CSECS0037',
    name: 'Mudda Jay Kritin Krishna',
    program: 'I Year - CS',
    route_id: 'route-51',
    pickup_stop: 'Begumpet Life Style',
    parent_name: 'M. Krishna Murthy',
    parent_phone: '+91 98490 00037',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:30:00',
    last_active: '2026-11-22 08:00:00',
    rider_type: 'STUDENT',
    gender: 'M',
  },
  {
    roll_number: '2601100CSE0003',
    name: 'Allen Davis Devraj',
    program: 'I Year - CSE',
    route_id: 'route-51',
    pickup_stop: 'Sangeeth',
    parent_name: 'D. Devraj',
    parent_phone: '+91 98490 00003',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:30:00',
    last_active: '2026-11-22 08:00:00',
    rider_type: 'STUDENT',
    gender: 'M',
  },
  {
    roll_number: '26011CSEAI0150',
    name: 'Palle Hasini Goud',
    program: 'I Year - AIML',
    route_id: 'route-51',
    pickup_stop: 'Sangeeth',
    parent_name: 'P. Goud',
    parent_phone: '+91 98490 00150',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:30:00',
    last_active: '2026-11-22 08:00:00',
    rider_type: 'STUDENT',
    gender: 'F',
  },
  {
    roll_number: '26011CSEAI0128',
    name: 'N Rushika',
    program: 'I Year - AIML',
    route_id: 'route-51',
    pickup_stop: 'Mettuguda',
    parent_name: 'N. Ravinder',
    parent_phone: '+91 98490 00128',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:30:00',
    last_active: '2026-11-22 08:00:00',
    rider_type: 'STUDENT',
    gender: 'F',
  },
  {
    roll_number: '26011CSEAI0239',
    name: 'A Rajesh',
    program: 'I Year - AIML',
    route_id: 'route-51',
    pickup_stop: 'Mettuguda',
    parent_name: 'A. Anjaiah',
    parent_phone: '+91 98490 00239',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:30:00',
    last_active: '2026-11-22 08:00:00',
    rider_type: 'STUDENT',
    gender: 'M',
  },
  {
    roll_number: '26011CSEAI0165',
    name: 'Riddhish Maroju',
    program: 'I Year - AIML',
    route_id: 'route-51',
    pickup_stop: 'Tarnaka Water Tank',
    parent_name: 'M. Krishna',
    parent_phone: '+91 98490 00165',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:30:00',
    last_active: '2026-11-22 08:00:00',
    rider_type: 'STUDENT',
    gender: 'M',
  },
  {
    roll_number: '26011CSEAI0224',
    name: 'Raju Gupta',
    program: 'I Year - AIML',
    route_id: 'route-51',
    pickup_stop: 'NTR Statue HB Colony',
    parent_name: 'S. Gupta',
    parent_phone: '+91 98490 00224',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:30:00',
    last_active: '2026-11-22 08:00:00',
    rider_type: 'STUDENT',
    gender: 'M',
  },
  {
    roll_number: '26011CSEAI0157',
    name: 'Patibandla Monita',
    program: 'I Year - AIML',
    route_id: 'route-51',
    pickup_stop: 'NTR Statue HB Colony',
    parent_name: 'P. Prasad',
    parent_phone: '+91 98490 00157',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:30:00',
    last_active: '2026-11-22 08:00:00',
    rider_type: 'STUDENT',
    gender: 'F',
  },
  {
    roll_number: '26011CSEAI0135',
    name: 'Nakkala Chandra Hasini',
    program: 'I Year - AIML',
    route_id: 'route-51',
    pickup_stop: 'Moula Ali HB Colony',
    parent_name: 'N. Venkat',
    parent_phone: '+91 98490 00135',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:30:00',
    last_active: '2026-11-22 08:00:00',
    rider_type: 'STUDENT',
    gender: 'F',
  },
  {
    roll_number: '26011CSEAI0075',
    name: 'Jamma Srimanish',
    program: 'I Year - AIML',
    route_id: 'route-51',
    pickup_stop: 'Moula Ali HB Colony',
    parent_name: 'J. Mallesh',
    parent_phone: '+91 98490 00075',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:30:00',
    last_active: '2026-11-22 08:00:00',
    rider_type: 'STUDENT',
    gender: 'M',
  },
  {
    roll_number: '26011CSEAI0044',
    name: 'Chiluveri Ruthvika',
    program: 'I Year - AIML',
    route_id: 'route-51',
    pickup_stop: 'Moula Ali SP Nagar',
    parent_name: 'C. Srinivas',
    parent_phone: '+91 98490 00044',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:30:00',
    last_active: '2026-11-22 08:00:00',
    rider_type: 'STUDENT',
    gender: 'F',
  },
  {
    roll_number: '26011CSEAI0126',
    name: 'Muppidi Aaradhya',
    program: 'I Year - AIML',
    route_id: 'route-51',
    pickup_stop: 'Moula Ali SP Nagar',
    parent_name: 'M. Ramesh',
    parent_phone: '+91 98490 00126',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:30:00',
    last_active: '2026-11-22 08:00:00',
    rider_type: 'STUDENT',
    gender: 'M',
  },

  // 8 Faculty / Staff
  {
    roll_number: '60000092',
    name: 'Radhika Niligonda',
    program: 'Executive Assistant - Exam Branch',
    route_id: 'route-51',
    pickup_stop: 'Moula Ali HB Colony',
    parent_name: 'N. Radhika',
    parent_phone: '+91 98490 00092',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:30:00',
    last_active: '2026-11-22 08:00:00',
    rider_type: 'FACULTY',
    gender: 'F',
  },
  {
    roll_number: '60000130',
    name: 'Kalpana Manohar Nallawar',
    program: 'Counsellor - Admissions',
    route_id: 'route-51',
    pickup_stop: 'Lalapet',
    parent_name: 'M. Nallawar',
    parent_phone: '+91 98490 00130',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:30:00',
    last_active: '2026-11-22 08:00:00',
    rider_type: 'FACULTY',
    gender: 'F',
  },
  {
    roll_number: 'FAC-R51-03',
    name: 'B Naveen Naik',
    program: 'Electrical Engineer',
    route_id: 'route-51',
    pickup_stop: 'Lalapet',
    parent_name: 'B. Naik',
    parent_phone: '+91 98490 00903',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:30:00',
    last_active: '2026-11-22 08:00:00',
    rider_type: 'FACULTY',
    gender: 'M',
  },
  {
    roll_number: '40000116',
    name: 'B Saritha',
    program: 'Professor - Dept - CSE',
    route_id: 'route-51',
    pickup_stop: 'Tarnaka White House',
    parent_name: 'B. Saritha',
    parent_phone: '+91 98490 00116',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:30:00',
    last_active: '2026-11-22 08:00:00',
    rider_type: 'FACULTY',
    gender: 'F',
  },
  {
    roll_number: '60000103',
    name: 'S Kavitha',
    program: 'Executive Assistant - Dept - R&D',
    route_id: 'route-51',
    pickup_stop: 'Tarnaka White House',
    parent_name: 'S. Kavitha',
    parent_phone: '+91 98490 00103',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:30:00',
    last_active: '2026-11-22 08:00:00',
    rider_type: 'FACULTY',
    gender: 'F',
  },
  {
    roll_number: 'FAC-R51-06',
    name: 'Dr Dondapati Sudeepthi',
    program: 'Assistant Professor - Dept - English',
    route_id: 'route-51',
    pickup_stop: 'Tarnaka Water Tank',
    parent_name: 'D. Sudeepthi',
    parent_phone: '+91 98490 00906',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:30:00',
    last_active: '2026-11-22 08:00:00',
    rider_type: 'FACULTY',
    gender: 'F',
  },
  {
    roll_number: '60000067',
    name: 'Akula Vishwanath',
    program: 'Executive - Procurement',
    route_id: 'route-51',
    pickup_stop: 'Begumpet Rasoolpura',
    parent_name: 'A. Vishwanath',
    parent_phone: '+91 98490 00067',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:30:00',
    last_active: '2026-11-22 08:00:00',
    rider_type: 'FACULTY',
    gender: 'M',
  },
  {
    roll_number: '60000159',
    name: 'Adil',
    program: 'Teaching Assistant - Dept - CSE',
    route_id: 'route-51',
    pickup_stop: 'Begumpet Life Style',
    parent_name: 'Adil',
    parent_phone: '+91 98490 00159',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:30:00',
    last_active: '2026-11-22 08:00:00',
    rider_type: 'FACULTY',
    gender: 'M',
  },

  // --- Existing Route Fixtures (Preserved for backward test compatibility) ---
  {
    roll_number: '23SN1A0501',
    name: 'Aarav Reddy',
    program: 'B.Tech CSE (AI & ML)',
    route_id: 'Route 14 (Secunderabad)',
    pickup_stop: 'Tarnaka Junction',
    parent_name: 'K. Venkat Reddy',
    parent_phone: '+91 98490 12345',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:30:00',
    last_active: '2026-11-18 07:22:15',
    rider_type: 'STUDENT',
    gender: 'M',
  },
  {
    roll_number: '23SN1A0542',
    name: 'Sneha Patel',
    program: 'B.Tech AI & ML',
    route_id: 'Route 14 (Secunderabad)',
    pickup_stop: 'Habsiguda Street 8',
    parent_name: 'M. Rajeshwar Patel',
    parent_phone: '+91 94401 56789',
    pass_status: 'FEE_PENDING',
    registered_at: '2026-08-01 08:35:00',
    last_active: '2026-11-18 07:15:30',
    rider_type: 'STUDENT',
    gender: 'F',
  },
  {
    roll_number: '23SN1A0588',
    name: 'Vikram Singh',
    program: 'B.Tech Data Science',
    route_id: 'Route 15 (Kukatpally)',
    pickup_stop: 'Uppal Metro Station',
    parent_name: 'V. S. N. Singh',
    parent_phone: '+91 98480 98765',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:40:00',
    last_active: '2026-11-18 07:40:00',
    rider_type: 'STUDENT',
    gender: 'M',
  },
  {
    roll_number: '23SN1A1208',
    name: 'Rahul Varma',
    program: 'B.Tech Information Technology',
    route_id: 'Route 08 (Dilsukhnagar)',
    pickup_stop: 'Boduppal X Roads',
    parent_name: 'S. R. Varma',
    parent_phone: '+91 99890 43210',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:45:00',
    last_active: '2026-11-18 07:45:00',
    rider_type: 'STUDENT',
    gender: 'M',
  },
  {
    roll_number: '23SN1A0419',
    name: 'Divya K',
    program: 'B.Tech ECE',
    route_id: 'Route 22 (ECIL / AS Rao Nagar)',
    pickup_stop: 'Peerzadiguda Kaman',
    parent_name: 'Alok K',
    parent_phone: '+91 91210 87654',
    pass_status: 'ACTIVE',
    registered_at: '2026-08-01 08:50:00',
    last_active: '2026-11-18 07:50:00',
    rider_type: 'STUDENT',
    gender: 'F',
  },
];

// Seed initial student records if empty
const countStmt = prep('SELECT COUNT(*) as cnt FROM students');
const { cnt } = countStmt.get();
if (cnt === 0) {
  const insertStudent = prep(`
    INSERT INTO students (roll_number, name, program, route_id, pickup_stop, parent_name, parent_phone, pass_status, registered_at, last_active, rider_type, gender)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  UNIFIED_SEED_STUDENTS.forEach((s) => {
    insertStudent.run(
      s.roll_number,
      s.name,
      s.program,
      s.route_id,
      s.pickup_stop,
      s.parent_name,
      s.parent_phone,
      s.pass_status,
      s.registered_at,
      s.last_active,
      s.rider_type || 'STUDENT',
      s.gender || 'M'
    );
  });
  console.log('[SQLiteStorage] Seeded initial unified student directory into SQLite');
}

/**
 * Formula Injection Protection:
 * Any cell string starting with '=', '+', '-', or '@' can execute arbitrary commands when opened in MS Excel.
 * We prepend a single quote (') to escape formula execution.
 */
function sanitizeCell(val) {
  // SheetJS writes JS strings as string cells (never formulas), so this only matters if a sheet is later
  // converted to CSV. Escape real formula starters, but leave phone numbers like "+91 98490 12345" alone.
  if (typeof val !== 'string') return val;
  const t = val.trim();
  if (/^[=@]/.test(t) || (/^[+\-]/.test(t) && !/^[+\-]?[\d\s().-]+$/.test(t))) return `'${val}`;
  return val;
}

function sanitizeRow(row) {
  const clean = {};
  for (const [k, v] of Object.entries(row)) {
    clean[k] = sanitizeCell(v);
  }
  return clean;
}

export function ensureExcelFileExists() {
  // No-op: the workbook is an export, built on demand (rate-limited) by the download route.
}

/**
 * High-performance on-demand Excel generator:
 * Queries the ACID SQLite database and generates the 7-sheet workbook cleanly without race conditions.
 */
export function generateExcelFileFromDb() {
  const wb = XLSX.utils.book_new();

  // 1. Students_Directory
  const students = prep('SELECT * FROM students ORDER BY roll_number').all();
  const studentsFormatted = students.map((s) => sanitizeRow({
    'Roll Number': s.roll_number,
    'Student Name': s.name,
    'Department / Program': s.program,
    'Assigned Route': s.route_id,
    'Pickup Stop': s.pickup_stop,
    'Parent Name': s.parent_name,
    'Parent Phone': s.parent_phone,
    'Pass Status': s.pass_status,
    'Registered At': s.registered_at,
    'Last Active': s.last_active,
    'Rider Type': s.rider_type || 'STUDENT',
    'Gender': s.gender || 'M',
  }));
  const wsStudents = XLSX.utils.json_to_sheet(studentsFormatted);
  wsStudents['!cols'] = Array(12).fill({ wch: 22 });
  XLSX.utils.book_append_sheet(wb, wsStudents, 'Students_Directory');

  // 2. Boarding_Attendance
  const attendance = prep('SELECT * FROM boarding_attendance ORDER BY id DESC').all();
  const attendanceFormatted = attendance.map((a) => sanitizeRow({
    Timestamp: a.timestamp,
    'Roll Number': a.roll_number,
    'Student Name': a.name,
    'Route ID': a.route_id,
    'Stop Name': a.stop_name,
    'Event Type': a.event_type,
    'Check-In Method': a.check_in_method,
    Notes: a.notes,
  }));
  const wsAtt = XLSX.utils.json_to_sheet(attendanceFormatted.length ? attendanceFormatted : [{ Timestamp: new Date().toISOString() }]);
  wsAtt['!cols'] = Array(8).fill({ wch: 22 });
  XLSX.utils.book_append_sheet(wb, wsAtt, 'Boarding_Attendance');

  // 3. Return_Trip_Changes
  const returnTrips = prep('SELECT * FROM return_trip_changes ORDER BY id DESC').all();
  const returnFormatted = returnTrips.map((r) => sanitizeRow({
    Timestamp: r.timestamp,
    'Roll Number': r.roll_number,
    'Student Name': r.name,
    'Route ID': r.route_id,
    'Original Drop Stop': r.original_drop,
    'Selected Alternate Stop': r.selected_drop,
    'Parent Notification Status': r.notification_status,
  }));
  const wsReturn = XLSX.utils.json_to_sheet(returnFormatted.length ? returnFormatted : [{ Timestamp: new Date().toISOString() }]);
  wsReturn['!cols'] = Array(7).fill({ wch: 22 });
  XLSX.utils.book_append_sheet(wb, wsReturn, 'Return_Trip_Changes');

  // 4. Lost_Item_Claims
  const lostItems = prep('SELECT * FROM lost_item_claims ORDER BY id DESC').all();
  const lostFormatted = lostItems.map((l) => sanitizeRow({
    Timestamp: l.timestamp,
    'Claim ID': l.claim_id,
    'Roll Number': l.roll_number,
    'Student Name': l.name,
    'Route ID': l.route_id,
    'Item Type': l.item_type,
    'Seat Zone': l.seat_zone,
    Status: l.status,
  }));
  const wsLost = XLSX.utils.json_to_sheet(lostFormatted.length ? lostFormatted : [{ Timestamp: new Date().toISOString() }]);
  wsLost['!cols'] = Array(8).fill({ wch: 22 });
  XLSX.utils.book_append_sheet(wb, wsLost, 'Lost_Item_Claims');

  // 5. Parent_Alerts_Log
  const parentAlerts = prep('SELECT * FROM parent_alerts_log ORDER BY id DESC').all();
  const parentFormatted = parentAlerts.map((p) => sanitizeRow({
    Timestamp: p.timestamp,
    'Alert ID': p.alert_id,
    'Recipient Name': p.recipient_name,
    'Recipient Phone': p.recipient_phone,
    Category: p.category,
    Title: p.title,
    Message: p.message,
    'Delivery Status': p.delivery_status,
  }));
  const wsParent = XLSX.utils.json_to_sheet(parentFormatted.length ? parentFormatted : [{ Timestamp: new Date().toISOString() }]);
  wsParent['!cols'] = Array(8).fill({ wch: 22 });
  XLSX.utils.book_append_sheet(wb, wsParent, 'Parent_Alerts_Log');

  // 6. Driver_Trip_Logs
  const driverLogs = prep('SELECT * FROM driver_trip_logs ORDER BY id DESC').all();
  const driverFormatted = driverLogs.map((d) => sanitizeRow({
    Timestamp: d.timestamp,
    'Route ID': d.route_id,
    'Driver Name': d.driver_name,
    'Bus Registration': d.bus_reg,
    Direction: d.direction,
    'Skipped Clusters': d.skipped_clusters,
    'Fuel Saved (L)': d.fuel_saved,
    'Cost Saved (INR)': d.cost_saved,
  }));
  const wsDriver = XLSX.utils.json_to_sheet(driverFormatted.length ? driverFormatted : [{ Timestamp: new Date().toISOString() }]);
  wsDriver['!cols'] = Array(8).fill({ wch: 22 });
  XLSX.utils.book_append_sheet(wb, wsDriver, 'Driver_Trip_Logs');

  // 7. Alerts_Notifications (Unified 7th sheet)
  const notifications = prep('SELECT * FROM alerts_notifications ORDER BY id DESC').all();
  const notifFormatted = notifications.map((n) => sanitizeRow({
    Timestamp: n.timestamp,
    'Alert ID': n.alert_id,
    'Recipient Name': n.recipient_name,
    'Recipient Phone': n.recipient_phone,
    Category: n.category,
    Title: n.title,
    Message: n.message,
    'Delivery Status': n.delivery_status,
  }));
  const wsNotif = XLSX.utils.json_to_sheet(notifFormatted.length ? notifFormatted : [{ Timestamp: new Date().toISOString() }]);
  wsNotif['!cols'] = Array(8).fill({ wch: 22 });
  XLSX.utils.book_append_sheet(wb, wsNotif, 'Alerts_Notifications');

  const tmp = `${EXCEL_FILE_PATH}.${process.pid}.tmp`;
  XLSX.writeFile(wb, tmp);
  fs.renameSync(tmp, EXCEL_FILE_PATH); // atomic: a download never sees a half-written file
  return wb;
}

export function readWorkbook() {
  generateExcelFileFromDb();
  return XLSX.readFile(EXCEL_FILE_PATH);
}

export function writeWorkbook(_wb) {
  // Maintained for backward compatibility; live state is in SQLite
  generateExcelFileFromDb();
}

export function getExcelFilePath() {
  return EXCEL_FILE_PATH;
}

export function appendSheetRow(sheetName, rowObject) {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const time = rowObject.Timestamp || now;

  switch (sheetName) {
    case 'Boarding_Attendance': {
      const stmt = prep(`
        INSERT INTO boarding_attendance (timestamp, roll_number, name, route_id, stop_name, event_type, check_in_method, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        time,
        rowObject['Roll Number'] || rowObject.rollNumber || '',
        rowObject['Student Name'] || rowObject.studentName || rowObject.name || '',
        rowObject['Route ID'] || rowObject.routeId || '',
        rowObject['Stop Name'] || rowObject.stopName || '',
        rowObject['Event Type'] || rowObject.eventType || '',
        rowObject['Check-In Method'] || rowObject.checkInMethod || '',
        rowObject.Notes || rowObject.notes || ''
      );
      break;
    }
    case 'Parent_Alerts_Log': {
      const stmt = prep(`
        INSERT INTO parent_alerts_log (timestamp, alert_id, recipient_name, recipient_phone, category, title, message, delivery_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        time,
        rowObject['Alert ID'] || rowObject.alertId || '',
        rowObject['Recipient Name'] || rowObject.recipientName || '',
        rowObject['Recipient Phone'] || rowObject.recipientPhone || '',
        rowObject.Category || rowObject.category || '',
        rowObject.Title || rowObject.title || '',
        rowObject.Message || rowObject.message || '',
        rowObject['Delivery Status'] || rowObject.deliveryStatus || ''
      );
      break;
    }
    case 'Alerts_Notifications': {
      const stmt = prep(`
        INSERT INTO alerts_notifications (timestamp, alert_id, recipient_name, recipient_phone, category, title, message, delivery_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        time,
        rowObject['Alert ID'] || rowObject.alertId || '',
        rowObject['Recipient Name'] || rowObject.recipientName || '',
        rowObject['Recipient Phone'] || rowObject.recipientPhone || '',
        rowObject.Category || rowObject.category || '',
        rowObject.Title || rowObject.title || '',
        rowObject.Message || rowObject.message || '',
        rowObject['Delivery Status'] || rowObject.deliveryStatus || ''
      );
      break;
    }
    case 'Return_Trip_Changes': {
      const stmt = prep(`
        INSERT INTO return_trip_changes (timestamp, roll_number, name, route_id, original_drop, selected_drop, notification_status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        time,
        rowObject['Roll Number'] || rowObject.rollNumber || '',
        rowObject['Student Name'] || rowObject.studentName || '',
        rowObject['Route ID'] || rowObject.routeId || '',
        rowObject['Original Drop Stop'] || rowObject.originalDrop || '',
        rowObject['Selected Alternate Stop'] || rowObject.selectedDrop || '',
        rowObject['Parent Notification Status'] || rowObject.notificationStatus || ''
      );
      break;
    }
    case 'Lost_Item_Claims': {
      const stmt = prep(`
        INSERT INTO lost_item_claims (timestamp, claim_id, roll_number, name, route_id, item_type, seat_zone, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        time,
        rowObject['Claim ID'] || rowObject.claimId || `LOST-${Date.now()}`,
        rowObject['Roll Number'] || rowObject.rollNumber || '',
        rowObject['Student Name'] || rowObject.studentName || rowObject.name || '',
        rowObject['Route ID'] || rowObject.routeId || '',
        rowObject['Item Type'] || rowObject.itemType || '',
        rowObject['Seat Zone'] || rowObject.seatZone || '',
        rowObject.Status || rowObject.status || 'REPORTED'
      );
      break;
    }
    case 'Driver_Trip_Logs': {
      const stmt = prep(`
        INSERT INTO driver_trip_logs (timestamp, route_id, driver_name, bus_reg, direction, skipped_clusters, fuel_saved, cost_saved)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        time,
        rowObject['Route ID'] || rowObject.routeId || '',
        rowObject['Driver Name'] || rowObject.driverName || '',
        rowObject['Bus Registration'] || rowObject.busReg || '',
        rowObject.Direction || rowObject.direction || '',
        rowObject['Skipped Clusters'] || rowObject.skippedClusters || '',
        rowObject['Fuel Saved (L)'] || rowObject.fuelSaved || '',
        rowObject['Cost Saved (INR)'] || rowObject.costSaved || ''
      );
      break;
    }
    default: {
      // Store in alerts_notifications fallback
      const stmt = prep(`
        INSERT INTO alerts_notifications (timestamp, alert_id, recipient_name, recipient_phone, category, title, message, delivery_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(time, `GEN-${Date.now()}`, 'System', '', sheetName, 'Event Logged', JSON.stringify(rowObject), 'SAVED');
    }
  }

  return { success: true, sheetName };
}

export function upsertStudentRecord(studentData) {
  const roll = (studentData['Roll Number'] || studentData.rollNumber || '').trim().toUpperCase();
  if (!roll) throw new Error('Roll number is required');

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const name = studentData['Student Name'] || studentData.name || `Student ${roll}`;
  const program = studentData['Department / Program'] || studentData.program || 'B.Tech CSE';
  const routeId = studentData['Assigned Route'] || studentData.routeId || 'Route 14 (Secunderabad)';
  const pickupStop = studentData['Pickup Stop'] || studentData.pickupStopId || 'Tarnaka Junction';
  const parentName = studentData['Parent Name'] || studentData.parentName || 'Guardian';
  const parentPhone = studentData['Parent Phone'] || studentData.parentPhone || '+91 98490 00000';
  const passStatus = studentData['Pass Status'] || studentData.passStatus || 'ACTIVE';
  const registeredAt = studentData['Registered At'] || studentData.registeredAt || now;

  const stmt = prep(`
    INSERT INTO students (roll_number, name, program, route_id, pickup_stop, parent_name, parent_phone, pass_status, registered_at, last_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(roll_number) DO UPDATE SET
      name = excluded.name,
      program = excluded.program,
      route_id = excluded.route_id,
      pickup_stop = excluded.pickup_stop,
      parent_name = excluded.parent_name,
      parent_phone = excluded.parent_phone,
      pass_status = excluded.pass_status,
      last_active = excluded.last_active
  `);

  stmt.run(roll, name, program, routeId, pickupStop, parentName, parentPhone, passStatus, registeredAt, now);

  const total = prep('SELECT COUNT(*) as count FROM students').get().count;

  return {
    student: {
      'Roll Number': roll,
      'Student Name': name,
      'Department / Program': program,
      'Assigned Route': routeId,
      'Pickup Stop': pickupStop,
      'Parent Name': parentName,
      'Parent Phone': parentPhone,
      'Pass Status': passStatus,
      'Registered At': registeredAt,
      'Last Active': now,
    },
    totalStudents: total,
  };
}

export function getAllStudents(maskPhone = true) {
  const rows = prep('SELECT * FROM students ORDER BY roll_number').all();
  return rows.map((s) => ({
    'Roll Number': s.roll_number,
    'Student Name': s.name,
    'Department / Program': s.program,
    'Assigned Route': s.route_id,
    'Pickup Stop': s.pickup_stop,
    'Parent Name': s.parent_name,
    'Parent Phone': maskPhone ? maskPhoneNumber(s.parent_phone) : s.parent_phone,
    'Pass Status': s.pass_status,
    'Registered At': s.registered_at,
    'Last Active': s.last_active,
  }));
}

export function maskPhoneNumber(phone) {
  if (!phone) return '+91 ••••• •••••';
  const digits = phone.replace(/\D/g, '');
  if (digits.length >= 10) {
    return `+91 ${digits.slice(-10, -8)}••• ••${digits.slice(-2)}`;
  }
  return '+91 ••••• •••••';
}

export function getExcelSummary() {
  const studentsCount = prep('SELECT COUNT(*) as c FROM students').get().c;
  const attCount = prep('SELECT COUNT(*) as c FROM boarding_attendance').get().c;
  const returnCount = prep('SELECT COUNT(*) as c FROM return_trip_changes').get().c;
  const lostCount = prep('SELECT COUNT(*) as c FROM lost_item_claims').get().c;
  const alertsCount = prep('SELECT COUNT(*) as c FROM parent_alerts_log').get().c;
  const driverCount = prep('SELECT COUNT(*) as c FROM driver_trip_logs').get().c;
  const notifCount = prep('SELECT COUNT(*) as c FROM alerts_notifications').get().c;

  return {
    fileName: 'sreenidhi_transit_master.xlsx',
    filePath: EXCEL_FILE_PATH,
    databaseEngine: 'SQLite WAL Mode (ACID Compliant)',
    totalSheets: 7,
    lastModified: fs.existsSync(EXCEL_FILE_PATH) ? fs.statSync(EXCEL_FILE_PATH).mtime.toISOString() : null,
    sheets: [
      { sheetName: 'Students_Directory', rowCount: studentsCount },
      { sheetName: 'Boarding_Attendance', rowCount: attCount },
      { sheetName: 'Return_Trip_Changes', rowCount: returnCount },
      { sheetName: 'Lost_Item_Claims', rowCount: lostCount },
      { sheetName: 'Parent_Alerts_Log', rowCount: alertsCount },
      { sheetName: 'Driver_Trip_Logs', rowCount: driverCount },
      { sheetName: 'Alerts_Notifications', rowCount: notifCount },
    ],
  };
}

export function createSqliteBackup() {
  const backupsDir = path.join(DATA_DIR, 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const timestampStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const fileName = `transitpulse-${timestampStr}.db`;
  const backupPath = path.join(backupsDir, fileName);

  // In SQLite, VACUUM INTO creates an atomic snapshot safe under active WAL mode.
  const normalizedPath = backupPath.replace(/\\/g, '/').replace(/'/g, "''");
  db.exec(`VACUUM INTO '${normalizedPath}'`);

  // Retention: Keep newest 7 files, prune older
  const files = fs.readdirSync(backupsDir)
    .filter((f) => f.startsWith('transitpulse-') && f.endsWith('.db'))
    .sort()
    .reverse();

  if (files.length > 7) {
    const toDelete = files.slice(7);
    for (const f of toDelete) {
      try {
        fs.unlinkSync(path.join(backupsDir, f));
      } catch { }
    }
  }

  const remainingFiles = fs.readdirSync(backupsDir).filter((f) => f.startsWith('transitpulse-') && f.endsWith('.db'));

  return {
    success: true,
    fileName,
    backupCount: remainingFiles.length,
    backupPath,
  };
}
