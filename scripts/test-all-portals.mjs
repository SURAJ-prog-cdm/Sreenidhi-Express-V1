async function testAll() {
  console.log('Testing all 5 portal authentication flows against http://localhost:3001...');
  
  // 1. Admin
  const adminRes = await fetch('http://localhost:3001/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminId: 'admin@sreenidhi.edu.in', password: 'admin123' })
  });
  console.log('1. Admin Portal (admin@sreenidhi.edu.in / admin123):', adminRes.status, await adminRes.json());

  // 2. Driver Route 51
  const driverRes = await fetch('http://localhost:3001/api/driver/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ routeId: 'route-51', pin: '515151' })
  });
  console.log('2. Driver Cabin (Route 51 / PIN 515151):', driverRes.status, await driverRes.json());

  // 3. Student Route 51
  const studentRes = await fetch('http://localhost:3001/api/students/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rollNumber: '26011CSEAI0109', password: 'student123' })
  });
  console.log('3. Student Portal (26011CSEAI0109 / student123):', studentRes.status, await studentRes.json());

  // 4. Faculty Route 51
  const facultyRes = await fetch('http://localhost:3001/api/students/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rollNumber: '40000116', password: 'faculty123' })
  });
  console.log('4. Faculty Portal (40000116 / faculty123):', facultyRes.status, await facultyRes.json());

  // 5. Parent Route 51
  const parentRes = await fetch('http://localhost:3001/api/parents/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'PARENT51' })
  });
  console.log('5. Parent Portal (Code: PARENT51):', parentRes.status, await parentRes.json());
}
testAll().catch(console.error);
