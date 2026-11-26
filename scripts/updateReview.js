import fs from 'fs';

let content = fs.readFileSync('CODEBASE_REVIEW.md', 'utf8');

const targetStr = '12. **Grayish Modern Theme System**: Balanced `#E5E8EC` (light mode) and `#181C24` (dark mode) eliminating pitch black while highlighting clean card surfaces.';
const addition = targetStr + '\r\n13. **Mobile Phone Capture & E-Commerce Live Push Notification Engine**:\r\n    - Interactive mobile phone onboarding and 4-digit simulated OTP verification for students and parents.\r\n    - Uber/Swiggy-style 4-stage Live Transit Milestone Tracker (*Bus Dispatched → Approaching Stop 5m → Student Boarded → SNIST Campus Arrival*).\r\n    - Multi-channel delivery: Device/Lockscreen Web Push (Notification API), In-App simulated SMS inbox feed (`SREENIDHI-EXP`), and custom milestone toggles.\r\n    - Automated event-driven dispatching on driver trip start, campus arrival, highway traffic delay (+10m/+20m/+30m), and emergency broadcasts.';

if (content.includes(targetStr)) {
  content = content.replace(targetStr, addition);
}

const newComponents = [
  'src/components/notifications/PhoneOnboardingModal.tsx',
  'src/components/notifications/LiveTransitTracker.tsx',
  'src/components/notifications/MobileAlertCard.tsx',
  'src/components/notifications/SmsMessageDrawer.tsx'
];

let appendix = '\r\n\r\n---\r\n\r\n## 42. Mobile Notifications & E-Commerce Alerts Architecture\r\n';
for (const p of newComponents) {
  if (fs.existsSync(p)) {
    const code = fs.readFileSync(p, 'utf8');
    appendix += '\r\n### `' + p + '`\r\n```tsx\r\n' + code + '\r\n```\r\n';
  }
}

content += appendix;

fs.writeFileSync('CODEBASE_REVIEW.md', content, 'utf8');
fs.writeFileSync('CODEBASE_REVIEW.mf', content, 'utf8');
console.log('Updated CODEBASE_REVIEW.md and CODEBASE_REVIEW.mf successfully. Total length:', content.length);
