const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const tempDir = path.join(process.env.TEMP || '.', 'suh_pkg_' + Date.now());
fs.mkdirSync(tempDir, { recursive: true });

const items = ['src', 'server', 'public', '.github', 'package.json', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'vite.config.ts', 'capacitor.config.ts', 'index.html', 'scripts', 'tests', 'test_e2e_pilot.mjs', 'CODEBASE_REVIEW.md'];
for (const item of items) {
  const src = path.resolve(__dirname, '..', item);
  const dst = path.join(tempDir, item);
  fs.cpSync(src, dst, {
    recursive: true,
    filter: (p) => !p.endsWith('.db') && !p.endsWith('.db-wal') && !p.endsWith('.db-shm') && !p.includes('node_modules')
  });
}

const zipOut = 'C:\\Users\\Rajeshwari\\.gemini\\antigravity\\brain\\a1f984c7-5c40-4cc6-9e3e-9a2bbb180640\\sreenidhi-express-codebase.zip';
execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${tempDir}\\*' -DestinationPath '${zipOut}' -Force"`, { stdio: 'inherit' });
fs.rmSync(tempDir, { recursive: true, force: true });
console.log('ZIP_EXPORT_COMPLETE');
