// node scripts/set-initial-passwords.js   → gives every student WITHOUT a password a random temporary one.
// Writes initial-passwords.csv (owner-only). Hand these out via the department, delete the CSV, students change it on first login.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { db } from '../server/excelStorage.js';
import { createExtras } from '../server/dbExtras.js';
import { hashPassword } from '../server/security.js';

const x = createExtras(db);
x.migrate();
const rows = db.prepare("SELECT roll_number, name FROM students WHERE password_hash IS NULL OR password_hash = ''").all();
const out = ['roll_number,name,temporary_password'];
for (const r of rows) {
  const temp = crypto.randomBytes(9).toString('base64url');
  x.setPasswordHash(r.roll_number, await hashPassword(temp));
  out.push(`${r.roll_number},"${r.name.replace(/"/g, '""')}",${temp}`);
}
fs.writeFileSync('initial-passwords.csv', out.join('\n') + '\n', { mode: 0o600 });
console.log(`Set ${rows.length} temporary passwords → initial-passwords.csv (delete it after distributing)`);
