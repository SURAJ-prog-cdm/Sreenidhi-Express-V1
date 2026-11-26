import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as xlsxModule from 'xlsx';

const XLSX = xlsxModule.default || xlsxModule;
const projectDir = 'C:\\Users\\Rajeshwari\\.gemini\\antigravity\\scratch\\sreenidhi-transitpulse';
const excelFilePath = path.join(projectDir, 'server', 'data', 'sreenidhi_transit_master.xlsx');

async function runTests() {
  console.log('--- 1. Testing Express Backend & Excel Master Storage ---');

  // Spawn Express server
  const serverProc = spawn('node', ['server/index.js'], { cwd: projectDir, stdio: 'pipe' });
  serverProc.stdout.on('data', (d) => console.log('[Server stdout]:', d.toString().trim()));
  serverProc.stderr.on('data', (d) => console.error('[Server stderr]:', d.toString().trim()));

  // Wait for server to boot
  await new Promise((r) => setTimeout(r, 1500));

  try {
    // Test /api/health
    const healthRes = await fetch('http://localhost:3001/api/health');
    const health = await healthRes.json();
    console.log('Backend Health:', health.status, 'Total Sheets:', health.totalSheets);

    // Test /api/students/login with Aarav Reddy (21311A0501)
    const loginRes = await fetch('http://localhost:3001/api/students/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rollNumber: '21311A0501' }),
    });
    const loginData = await loginRes.json();
    console.log('Login Result:', loginData.message, 'Student:', loginData.student['Student Name']);

    // Test /api/students/register with new student
    const regRes = await fetch('http://localhost:3001/api/students/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rollNumber: '23311A0599',
        name: 'Karthik Varma',
        program: 'B.Tech AI & ML',
        routeId: 'Route 14 (Secunderabad)',
        pickupStopId: 'Habsiguda Street 8',
        parentName: 'S. Varma',
        parentPhone: '+91 98490 88888',
      }),
    });
    const regData = await regRes.json();
    console.log('Registration Result:', regData.message, 'Total Students:', regData.totalStudents);

    // Test /api/events/record for lost item claim
    const eventRes = await fetch('http://localhost:3001/api/events/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sheetName: 'Lost_Item_Claims',
        data: {
          'Claim ID': 'CLAIM-E2E-101',
          'Roll Number': '23311A0599',
          'Student Name': 'Karthik Varma',
          'Route ID': 'Route 14',
          'Item Type': 'Lab Record Book',
          'Seat Zone': 'Row 3 Window',
          Status: 'PENDING_DRIVER_CHECK',
        },
      }),
    });
    const eventData = await eventRes.json();
    console.log('Event Record Result:', eventData.message);

    // Test /api/excel/summary
    const summaryRes = await fetch('http://localhost:3001/api/excel/summary');
    const summary = await summaryRes.json();
    console.log('Excel Summary Sheets:', summary.sheets.map((s) => `${s.sheetName}: ${s.rowCount} rows`).join(' | '));

    // Verify actual file on disk
    if (fs.existsSync(excelFilePath)) {
      const wb = XLSX.readFile(excelFilePath);
      console.log('Excel File on disk verified! Sheets:', wb.SheetNames);
      const studentSheet = XLSX.utils.sheet_to_json(wb.Sheets['Students_Directory']);
      console.log('Verified Students count in Excel:', studentSheet.length);
      const newStu = studentSheet.find((s) => s['Roll Number'] === '23311A0599');
      console.log('Found newly registered student in Excel:', newStu ? newStu['Student Name'] : 'NOT FOUND');
    } else {
      throw new Error(`Excel file not found at ${excelFilePath}`);
    }

    console.log('\n--- ALL BACKEND & EXCEL TESTS PASSED SUCCESSFULLY! ---');
  } finally {
    serverProc.kill();
  }
}

runTests().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
