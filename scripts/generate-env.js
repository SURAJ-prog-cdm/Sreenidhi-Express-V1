import { hashPassword } from '../server/security.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import * as webpushModule from 'web-push';

const args = process.argv.slice(2);
let isProd = args.includes('--prod') || args.includes('--production');
let apiUrl = 'http://localhost:3001';
const useDefaultCreds = args.includes('--default-creds');

let cartoKey = process.env.CARTO_API_KEY || '';
if (!cartoKey && fs.existsSync('.env')) {
  try {
    const existingEnv = fs.readFileSync('.env', 'utf8');
    const match = existingEnv.match(/^CARTO_API_KEY=(.*)$/m);
    if (match) cartoKey = match[1].trim();
  } catch {}
}

for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--api-url=')) {
    apiUrl = args[i].split('=')[1];
  } else if (args[i] === '--api-url' && args[i + 1]) {
    apiUrl = args[i + 1];
    i++;
  } else if (args[i].startsWith('--carto-key=')) {
    cartoKey = args[i].split('=')[1].trim();
  } else if (args[i] === '--carto-key' && args[i + 1]) {
    cartoKey = args[i + 1].trim();
    i++;
  }
}

// In production, reject default credentials
if (isProd && useDefaultCreds) {
  console.error('❌ Error: --default-creds is strictly prohibited in production mode. Credentials must be randomly generated.');
  process.exit(1);
}

// In production or when deploying mobile, require HTTPS
if (isProd || (apiUrl && !apiUrl.includes('localhost') && !apiUrl.includes('127.0.0.1'))) {
  if (!apiUrl.startsWith('https://')) {
    console.error('❌ Error: Production and remote deployments strictly require an HTTPS api-url (e.g. https://bus.sreenidhi.edu.in).');
    process.exit(1);
  }
}

const rawAdminPassword = useDefaultCreds ? 'admin123' : crypto.randomBytes(12).toString('base64url');
const rawPin51 = useDefaultCreds ? '515151' : String(crypto.randomInt(100000, 1000000));
const rawPin14 = useDefaultCreds ? '141414' : String(crypto.randomInt(100000, 1000000));
const rawPin15 = useDefaultCreds ? '151515' : String(crypto.randomInt(100000, 1000000));

const adminHash = await hashPassword(rawAdminPassword);
const pin51 = await hashPassword(rawPin51);
const pin14 = await hashPassword(rawPin14);
const pin15 = await hashPassword(rawPin15);
const jwtSecret = crypto.randomBytes(48).toString('hex');
const gateSecret = crypto.randomBytes(48).toString('hex');
const wp = webpushModule.default || webpushModule;
const vapidKeys = wp.generateVAPIDKeys();

const shouldTrustProxy = isProd || apiUrl.startsWith('https://');

const envContent = [
  `NODE_ENV=${isProd ? 'production' : 'development'}`,
  'PORT=3001',
  ...(shouldTrustProxy
    ? [
        '# Ensures ipLoginLimiter and otpRequestLimiter read real client IPs behind Cloudflare Tunnel / Nginx instead of collapsing all riders onto 127.0.0.1',
        'TRUST_PROXY=1',
      ]
    : [
        '# Reverse-proxy trust: set to 1 when deployed behind Cloudflare Tunnel or Nginx',
        'TRUST_PROXY=1',
      ]),
  `JWT_SECRET=${jwtSecret}`,
  `GATE_SECRET=${gateSecret}`,
  'ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3001,http://127.0.0.1:5173,http://127.0.0.1:3001,https://localhost,capacitor://localhost',
  'ADMIN_ID=admin@sreenidhi.edu.in',
  'ADMIN_NAME=Transport Incharge',
  `ADMIN_PASSWORD_HASH=${adminHash}`,
  `DRIVER_PIN_HASHES=${JSON.stringify({ 'route-51': pin51, 'route-14': pin14, 'route-15': pin15 })}`,
  `VITE_API_BASE_URL=${apiUrl}`,
  `VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`,
  `VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`,
  'VAPID_SUBJECT=mailto:transport@sreenidhi.edu.in',
  '# Free Non-Commercial key (5M req/mo, INR 0) from https://carto.com/basemaps/apikey/',
  `CARTO_API_KEY=${cartoKey}`,
].join('\n') + '\n';

fs.writeFileSync('.env', envContent);

console.log('✅ .env generated successfully!');
console.log('--------------------------------------------------');
console.log('Environment Mode:', isProd ? 'PRODUCTION' : 'DEVELOPMENT');
console.log('API Base URL:   ', apiUrl);
console.log('Generated Setup Credentials:');
console.log('  * Admin ID:      admin@sreenidhi.edu.in');
console.log('  * Admin Password:', rawAdminPassword);
console.log('  * Route 51 PIN:  ', rawPin51);
console.log('  * Route 14 PIN:  ', rawPin14);
console.log('  * Route 15 PIN:  ', rawPin15);
console.log('--------------------------------------------------');
