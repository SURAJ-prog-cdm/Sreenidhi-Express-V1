# Prismatic Daylight Glass UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the entire Sreenidhi Express frontend into an electric, minimal, futuristic **Prismatic Daylight Glass** light-first UI (`#F7F9FF` architectural grid + atmospheric cyan/indigo bloom, translucent porcelain cards, electric `#4F46E5` → `#06B6D4` hero surfaces, tactile spring motion, and light-first maps/modals/drawers) with zero backend or test regressions.

**Architecture:** Establish a shared daylight Prismatic CSS token and micro-interaction system in `src/index.css` (plus light-mode boot in `index.html` and `CommuteSimulationContext.tsx`), then roll those primitives systematically through the shell/login (`App.tsx`, `MobileBottomNav.tsx`, `StudentLoginPage.tsx`), all portals (`StudentPortal.tsx`, `DriverConsole.tsx`, `AdminDashboard.tsx`, `ParentPortal.tsx`), map HUDs (`HybridTransitMap.tsx`, `MetroSchematicMap.tsx`), and notification/install drawers (`LiveTransitTracker.tsx`, `MobileAlertCard.tsx`, `PhoneOnboardingModal.tsx`, `SmsMessageDrawer.tsx`, `InstallAppModal.tsx`).

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4 (`@custom-variant dark`), Lucide React, Leaflet (`react-leaflet`), Vite 8, `oxlint`, `node --test`, E2E Pilot suite.

**Spec:** [docs/superpowers/specs/2026-11-26-prismatic-daylight-ui-design.md](../../superpowers/specs/2026-11-26-prismatic-daylight-ui-design.md)

## Global Constraints
- **Light-First Boot:** `index.html` must NOT start with `class="dark"`, and `isDark` in `src/context/CommuteSimulationContext.tsx` initializes to `false`.
- **Palette & Tokens:** Canvas `#F7F9FF`; translucent porcelain surfaces (`bg-white/85 backdrop-blur-xl`, crisp borders `border-indigo-100/80`); electric indigo → cyan hero gradient (`from-[#4F46E5] via-[#4F46E5] to-[#06B6D4]`); preserve working `dark:` fallback variants for the optional theme toggle.
- **Strict Non-Regression:** Zero backend API, SQLite, auth, SSE, `VITE_ENABLE_PARENT_PORTAL`, or ₹0 budget changes.
- **Zero Static/Build Regressions:** `npm run lint` (0 errors), `npm test` (36/36), `npm run build` (`tsc -b && vite build`), and `npm run test:e2e` (9/9) must all pass after final edits.

## Review Focus
1. **Default boot theme:** Opening the app on a fresh browser without stored theme preference renders daylight `#F7F9FF` rather than flashing dark `#181C24`.
2. **Dark-slab elimination in light mode:** Opening `SmsMessageDrawer`, `PhoneOnboardingModal`, `InstallAppModal`, `MobileAlertCard`, or `LiveTransitTracker` in light mode renders frosted light cards with high-contrast dark slate text, not white text on white or `#181C24` dark boxes.
3. **Interactive map readability:** `HybridTransitMap` light-mode zoom controls, popups, OSRM label pill, and `Google Maps Traffic` pill remain crisp and readable over Voyager daylight tiles without blocking CARTO attribution.
4. **Mobile viewport clearance:** Floating 4-tab bottom dock in `StudentPortal`, toast banners, and Sun/Moon floating utility dock do not cover bottom form CTAs (`pb-24` / safe offsets).
5. **TypeScript & lint cleanliness:** Every CSS animation class and imported icon in touched `.tsx` files is used (`tsc -b` + `oxlint` report 0 errors).

---

### Task 1: Boot Light Default & Prismatic Daylight CSS System

**Files:**
- Modify: `index.html:1-68`
- Modify: `src/context/CommuteSimulationContext.tsx:137`
- Modify: `src/index.css:1-250`

**Interfaces:**
- Produces CSS utility classes consumed by Tasks 2–5: `.bg-prismatic-canvas`, `.prismatic-card`, `.prismatic-subcard`, `.electric-hero`, `.electric-cta`, `.electric-badge`, `.futuristic-tile`, `.futuristic-tile-active`, `.animate-electric-sheen`, `.animate-panel-in`.
- Produces Light-first `isDark = false` default context value consumed by `App.tsx`, `HybridTransitMap.tsx`.

- [ ] **Step 1: Set light-first HTML shell & splash in `index.html`**
Remove `class="dark"` on `<html>`, set `<meta name="theme-color" content="#F7F9FF" />`, update unstyled default canvas to `#F7F9FF`, and style the pre-hydration loader icon badge with an electric indigo-to-cyan gradient (`linear-gradient(135deg, #4F46E5, #06B6D4)`) on porcelain surface.

- [ ] **Step 2: Flip default `isDark` state to `false` in `src/context/CommuteSimulationContext.tsx:137`**
Change `useState<boolean>(true)` to `useState<boolean>(false)` so React boots in light mode while keeping `toggleDark` working.

- [ ] **Step 3: Add Prismatic Daylight Design System tokens & motion utilities in `src/index.css`**
Define `@keyframes electric-sheen`, `@keyframes panel-enter`, `@keyframes aurora-float`, `.bg-prismatic-canvas` (pearl `#F7F9FF` + hairline indigo grid + subtle top-right cyan & top-left indigo ambient radial glow), `.prismatic-card` (frosted porcelain `rgba(255,255,255,0.86)`, `backdrop-filter: blur(18px)`, subtle electric hover ring), `.prismatic-subcard`, `.electric-hero` (`linear-gradient(135deg, #4F46E5 0%, #5850EC 55%, #06B6D4 100%)` with subtle specular inner highlight), `.electric-cta`, `.futuristic-tile` / `.futuristic-tile-active` (spring `cubic-bezier(0.22, 1, 0.36, 1)` lift + press scale + electric border), `.animate-electric-sheen`, and light-mode cyan-accented Leaflet hover states.

- [ ] **Step 4: Run build check to verify CSS & TS validity**
Run: `npm run build`
Expected: PASS (`tsc -b && vite build` exits 0).

---

### Task 2: Restyle Shell, Navigation & Role Auth to Prismatic Daylight

**Files:**
- Modify: `src/App.tsx:24-234`
- Modify: `src/components/common/MobileBottomNav.tsx:38-80`
- Modify: `src/components/auth/StudentLoginPage.tsx:214-804`

**Interfaces:**
- Consumes Task 1 classes: `.bg-prismatic-canvas`, `.prismatic-card`, `.prismatic-subcard`, `.futuristic-tile`, `.futuristic-tile-active`, `.electric-cta`, `.animate-panel-in`.

- [ ] **Step 1: Upgrade `App.tsx` shell & mobile preview bezel to `.bg-prismatic-canvas`**
Apply `.bg-prismatic-canvas` to full-screen and preview containers, frosted `.prismatic-card` styling to the theme/viewport dock and loader spinner, crisp frosted light toasts, and daylight porcelain phone frame bezel (`border-white/90 shadow-[0_24px_70px_-20px_rgba(79,70,229,0.22)]`).

- [ ] **Step 2: Restyle `MobileBottomNav.tsx` with frosted glass pill bar & active electric indicator**
Use frosted light glass (`bg-white/90 backdrop-blur-xl border-indigo-100/80`) and electric indigo-cyan active pill highlights (`from-[#4F46E5]/12 to-[#06B6D4]/12 text-[#4F46E5] ring-[#4F46E5]/30`).

- [ ] **Step 3: Upgrade `StudentLoginPage.tsx` (all 4 role panels including Parent `#0D4B42` cleanup)**
Replace legacy `#0D4B42` classes in the Parent sign-in tray (lines 413–437) with electric indigo/cyan; upgrade the main role card to `.prismatic-card`, logo header to an energized electric badge, `.futuristic-tile` cards with subtle cyan/indigo glow when selected, `.animate-panel-in` form entrance, and `.electric-cta` gradient submit buttons across Student Sign-In, Self-Register, Driver, Admin, and Parent (when enabled).

- [ ] **Step 4: Run build & lint on Tasks 1–2**
Run: `npm run lint && npm run build`
Expected: PASS (0 errors).

---

### Task 3: Light-First Notifications, Modals & Interactive Map Surfaces

**Files:**
- Modify: `src/components/notifications/LiveTransitTracker.tsx:69-178`
- Modify: `src/components/notifications/MobileAlertCard.tsx:149-302`
- Modify: `src/components/notifications/PhoneOnboardingModal.tsx:102-278`
- Modify: `src/components/notifications/SmsMessageDrawer.tsx:58-193`
- Modify: `src/components/modals/InstallAppModal.tsx:25-226`
- Modify: `src/components/map/HybridTransitMap.tsx:580-633`
- Modify: `src/components/map/MetroSchematicMap.tsx:60-285`

**Interfaces:**
- Consumes Task 1 classes: `.prismatic-card`, `.prismatic-subcard`, `.electric-cta`, `.animate-panel-in`.
- Keeps `MobileAlertCard`, `PhoneOnboardingModal`, `SmsMessageDrawer`, `InstallAppModal`, `LiveTransitTracker`, `HybridTransitMap`, `MetroSchematicMap` props signatures identical.

- [ ] **Step 1: Convert `LiveTransitTracker.tsx` & `MobileAlertCard.tsx` from hardcoded `#181C24` to frosted daylight glass**
Replace `bg-[#181C24]` with `.prismatic-card` (`bg-white/90 dark:bg-[#1E2430]`), `bg-[#11141A]` subcards with `.prismatic-subcard` (`bg-[#F7F9FF] dark:bg-[#141821]`), dark text to slate-900 (with `dark:text-white`), and active milestone/switch states from pine green `#0D4B42` to electric indigo-cyan (`#4F46E5` / `#06B6D4`), with smooth spring transitions on milestone toggles.

- [ ] **Step 2: Convert `PhoneOnboardingModal.tsx`, `SmsMessageDrawer.tsx` & `InstallAppModal.tsx` to daylight frosted modals/drawers**
Replace `#181C24` / `#141820` / `slate-900` dark modal surfaces with frosted daylight porcelain (`bg-white/95 dark:bg-[#1E2430] backdrop-blur-2xl`), high-contrast slate typography, `#F7F9FF` inputs/feeds, electric indigo-cyan primary action buttons, and clean daylight category badges in `SmsMessageDrawer` (`getCategoryBadge`).

- [ ] **Step 3: Upgrade `HybridTransitMap.tsx` HUD pills & `MetroSchematicMap.tsx` corridor palette**
Switch `HybridTransitMap.tsx` bottom HUD pills (`OSRM Road-Snapped Corridor` and `Google Maps Traffic`) from `bg-slate-950/80` dark badges to frosted porcelain daylight pills (`bg-white/92 text-slate-800 border-indigo-200/70 shadow-lg dark:bg-slate-900/90 dark:text-slate-100`) with electric cyan live indicator dot (`#06B6D4`). Switch `MetroSchematicMap.tsx` passed segment, badges, and legend from `#0D4B42` pine green to electric `#4F46E5` / `#06B6D4` gradient tones with cyan glow accents.

- [ ] **Step 4: Run build & lint on Task 3**
Run: `npm run lint && npm run build`
Expected: PASS (0 errors).

---

### Task 4: Electric Prismatic Polish Across All Phase 1 & Phase 2 Portals

**Files:**
- Modify: `src/components/portals/StudentPortal.tsx:520-1356`
- Modify: `src/components/portals/DriverConsole.tsx:425-1267`
- Modify: `src/components/portals/AdminDashboard.tsx:399-1416`
- Modify: `src/components/portals/ParentPortal.tsx` (lines containing `#0D4B42` / emerald legacy accents & card tokens)

**Interfaces:**
- Consumes Task 1 classes: `.prismatic-card`, `.prismatic-subcard`, `.electric-hero`, `.electric-cta`, `.animate-electric-sheen`, `.animate-panel-in`, `.tactile-btn`.

- [ ] **Step 1: Upgrade `StudentPortal.tsx` to Prismatic Daylight Glass**
Apply `.prismatic-card` header/strips, `.electric-hero` indigo-to-cyan gradient (`from-[#4F46E5] via-[#4F46E5] to-[#06B6D4]`) on the Hero ETA card with subtle animated grid overlay + tabular `.font-mono-timer` ETA readout + shimmer `.electric-cta` `"I'm On Board"` / `"View Full Map / Metro View →"`, smooth `.animate-panel-in` tab transitions (`HOME` / `MAP` / `PASS` / `MORE`), and glowing active tab indicator in the docked 4-tab pill bar. Also upgrade the two modals at bottom (`showApplyModal`, `isPasswordModalOpen`) to match frosted daylight styling.

- [ ] **Step 2: Upgrade `DriverConsole.tsx` to Prismatic Daylight Glass**
Apply `.prismatic-card` header/cockpit cards, `.electric-hero` gradient on the Live Headcount & Trip card, tactile pill micro-interactions on delay buttons (`+5 min`, `+10 min`, `Traffic (+20m)`, `On-Time`), `.animate-panel-in` across `TRIP` / `STOPS` / `ALERTS`, and luminous active cluster/stop indicators in `STOPS`.

- [ ] **Step 3: Upgrade `AdminDashboard.tsx` & legacy `#0D4B42` in `ParentPortal.tsx`**
Apply `.prismatic-card`, `.electric-hero` on the Pending Approvals hero card, `.animate-panel-in` across `VERIFY` / `FLEET` / `LOGS`, electric indigo-cyan active matrix badges, and update legacy `#0D4B42` accents in `ParentPortal.tsx` to `#4F46E5` for full visual consistency.

- [ ] **Step 4: Verify no stray `#0D4B42` or dark-only modal slabs remain**
Run a grep check across `src/` ensuring `0D4B42` count is 0 and `bg-[#181C24]` hardcoded slabs are 0 in light mode, then run `npm run lint && npm run build`.
Expected: `0` legacy green matches, 0 lint errors, clean Vite build.

---

### Task 5: Full Regression Suite, Live Server Restart & Review/Bundle Sync

**Files:**
- Modify: `scripts/compile-review.js` (update summary description if UI milestone noted)
- Output: Android assets (`npx cap copy android`), `CODEBASE_REVIEW.md`, zip archive, live server daemon on port 3001.

- [ ] **Step 1: Run complete static & automated verification**
Run in sequence:
1. `npm run lint`
2. `npm test`
3. `npm run build`
4. `npm run test:e2e`
Expected: `oxlint` 0 errors, `36/36` unit tests pass, clean Vite production build, `9/9` E2E stages pass.

- [ ] **Step 2: Restart live server & run load benchmark**
Ensure `node server/index.js` is serving the fresh `dist/` on port `3001` cleanly, verify `GET http://127.0.0.1:3001/api/health`, and run `npm run test:load`.
Expected: `{"status":"ONLINE"}`, 50/50 SSE streams, 100/100 HTTP requests, `0.00%` error rate.

- [ ] **Step 3: Sync Capacitor Android assets & review bundles**
Run `npx cap copy android`, `node scripts/compile-review.js`, and `node scripts/build-zip.cjs` (plus mirror to brain artifacts dir if needed).
Expected: All commands exit 0.
