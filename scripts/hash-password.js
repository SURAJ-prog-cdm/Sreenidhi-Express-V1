// node scripts/hash-password.js "<password-or-pin>"   → prints a scrypt hash for ADMIN_PASSWORD_HASH / DRIVER_PIN_HASHES
import { hashPassword } from '../server/security.js';
const pw = process.argv[2];
if (!pw || pw.length < 6) { console.error('Usage: node scripts/hash-password.js "<at least 6 chars>"'); process.exit(1); }
console.log(await hashPassword(pw));
