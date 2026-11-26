# Prismatic Daylight Glass — UI Redesign Spec

## Intent
Transform Sreenidhi Express into a minimal, futuristic, interactive **light-first** experience powered by translucent porcelain surfaces and **electric indigo → cyan** (`#4F46E5` → `#06B6D4`) motion accents—eliminating dark-mode defaults, `#181C24` hardcoded slabs, and stale `#0D4B42` styling.

## Goals & Non-Goals
- **Goals:** Default boot in Light Mode; unified Prismatic Glass design system (`#F7F9FF` canvas + subtle architectural grid + aurora bloom, frosted glass cards, electric indigo-to-cyan hero/action highlights, tactile spring micro-interactions); light-first notifications/modals/map HUD/Metro schematic.
- **Non-Goals / Constraints:** Zero backend API, SQLite, auth, SSE, or ₹0 budget changes; keep `VITE_ENABLE_PARENT_PORTAL` gating; keep existing lint/unit/build/E2E/load checks passing.

## Approaches Considered
1. **Prismatic Daylight Glass (Selected):** Pearl-white `#F7F9FF` canvas with faint architectural grid & soft cyan/indigo atmospheric aura, frosted porcelain glass panels (`bg-white/88 backdrop-blur-xl`), high-voltage `#4F46E5` → `#06B6D4` gradient heroes & live telemetry beams, spring hover/tap micro-interactions, and light-first map/tracker widgets. Trades subtle translucency setup for futuristic depth while staying minimal.
2. **Hyper-Crisp Swiss Neon (Rejected):** Flat white matte cards with zero blur or ambient depth; too static for a futuristic interactive aesthetic.

## Key Design Decisions (Including Defaults Applied)
- **Light-First Default + Optional Dark Switch:** Remove hardcoded `class="dark"` from `index.html`, set initial `isDark` state to `false` in `CommuteSimulationContext.tsx`, and keep the optional Sun/Moon toggle discreetly available while designing every screen light-first.
- **Design Tokens & Motion (`src/index.css`):** Define atmospheric mesh canvas (`.bg-prismatic-canvas`), frosted card borders (`.prismatic-card`), electric gradient hero/CTA styles (`.electric-hero`, `.electric-pill`), missing `.futuristic-tile` / `.futuristic-tile-active` spring states for role cards, shimmer sweep on primary CTAs, live radar pulse beams, and smooth tab-panel enter motion.
- **Component Scope:**
  - `index.html` & `src/context/CommuteSimulationContext.tsx`: Light default (`false`), daylight pre-hydration splash, light meta `theme-color` (`#F7F9FF`).
  - `src/App.tsx` & `src/components/common/MobileBottomNav.tsx`: Prismatic daylight shell backdrop + frosted bottom dock + crisp light toast palette.
  - `src/components/auth/StudentLoginPage.tsx`: Porcelain hero container, kinetic `.futuristic-tile` role cards, electric indigo-cyan primary actions, unified Parent/Student/Driver/Admin accent palette.
  - `src/components/portals/StudentPortal.tsx`, `DriverConsole.tsx`, `AdminDashboard.tsx`: Electric indigo-cyan hero cards, animated live route beam, frosted white metric & stop cards, springy interactive pills & docked 4-tab pill bar.
  - `src/components/notifications/LiveTransitTracker.tsx`, `MobileAlertCard.tsx`, `PhoneOnboardingModal.tsx`, `SmsMessageDrawer.tsx` & `src/components/modals/InstallAppModal.tsx`: Replace all hardcoded `#181C24` / `slate-950` dark containers with frosted daylight white glass surfaces and electric indigo/cyan step badges.
  - `src/components/map/HybridTransitMap.tsx` & `MetroSchematicMap.tsx`: Crisp white frosted HUD badges on the map (no `slate-950` blocks in light mode) and electric indigo/cyan Metro schematic track (`#4F46E5` / `#06B6D4`) replacing `#0D4B42`.
