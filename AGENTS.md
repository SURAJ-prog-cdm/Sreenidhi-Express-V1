# Sreenidhi TransitPulse — Workspace Guidelines & Rules

## Project Overview
Sreenidhi TransitPulse is a smart college bus tracking and commute coordination system tailored for Sreenidhi University students, faculty, and bus coordinators. It provides live geolocation tracking, stop ETAs, passenger QR boarding, route management, and driver notifications.

## Tech Stack & Architecture
- **Frontend**: React 18+ (TypeScript), Vite, Tailwind CSS v4, Lucide React icons.
- **Mapping**: Leaflet and React-Leaflet with custom map markers and responsive containers.
- **Backend & Storage**: Express Node server (`server/index.js`), SQLite database (`server/transitpulse.db`), and Excel batch sync (`server/excelStorage.js`).
- **Mobile Bridge**: Capacitor (`@capacitor/core`, `@capacitor/android`, `@capacitor/geolocation`).

## Commands & Workflow
- **Development Server**:
  - Frontend: `npm run dev` (Vite dev server)
  - Backend: `node server/index.js` (Express API server)
- **Linting & Code Quality**:
  - Run oxlint: `npx oxlint`
  - Ensure strict TypeScript compliance (`tsconfig.json`).
- **Mobile Build & Synchronization**:
  - Whenever frontend source code in `src/` is updated, synchronize the Capacitor Android native project before testing native features:
    ```bash
    npm run build
    npx cap sync android
    ```
- **Map & Geolocation Rules**:
  - Map components must specify explicit heights (e.g., `h-[calc(100vh-120px)]` or fixed pixel/rem heights) to prevent Leaflet container collapse.
  - Test GPS coordinate bounds around Hyderabad / Ghatkesar / SNIST campus (`17.45° N, 78.68° E`).
- **Security & Environment**:
  - Server routes must use `server/security.js` middleware for JWT validation, bcrypt password hashing, and rate limiting.
  - Never commit active API keys, session tokens, or sensitive production secrets to version control.
