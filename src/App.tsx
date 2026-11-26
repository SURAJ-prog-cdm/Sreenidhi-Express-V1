import React, { useEffect, Suspense } from 'react';
import { BatteryCharging, Monitor, Signal, Wifi, X, Moon, Sun, Smartphone } from 'lucide-react';
import { MobileBottomNav } from './components/common/MobileBottomNav';
import { ApiKeyModal } from './components/modals/ApiKeyModal';
import { InstallAppModal } from './components/modals/InstallAppModal';
import { StudentLoginPage } from './components/auth/StudentLoginPage';
import { CommuteSimulationProvider } from './context/CommuteSimulationContext';
import { useCommuteSimulation } from './context/useCommuteSimulation';

const AdminDashboard = React.lazy(() =>
  import('./components/portals/AdminDashboard').then((m) => ({ default: m.AdminDashboard }))
);
const DriverConsole = React.lazy(() =>
  import('./components/portals/DriverConsole').then((m) => ({ default: m.DriverConsole }))
);
const StudentPortal = React.lazy(() =>
  import('./components/portals/StudentPortal').then((m) => ({ default: m.StudentPortal }))
);
const ParentPortal = React.lazy(() =>
  import('./components/portals/ParentPortal').then((m) => ({ default: m.ParentPortal }))
);
const ENABLE_PARENT_PORTAL = import.meta.env.VITE_ENABLE_PARENT_PORTAL === 'true';

const PortalLoadingSkeleton: React.FC = () => (
  <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3.5 text-slate-600 dark:text-slate-300">
    <div className="relative flex h-12 w-12 items-center justify-center">
      <span className="absolute inset-0 animate-ping rounded-full bg-cyan-400/30" />
      <div className="h-10 w-10 animate-spin rounded-full border-3 border-[#4F46E5] border-t-cyan-400 dark:border-indigo-400 dark:border-t-cyan-400" />
    </div>
    <span className="text-xs font-extrabold uppercase tracking-widest text-[#4F46E5] dark:text-indigo-300">
      Syncing Telemetry...
    </span>
  </div>
);

const ActiveViewBody: React.FC = () => {
  const { activeView, currentUser } = useCommuteSimulation();

  // If user is not authenticated, show ONLY the Role Selection Portal!
  if (!currentUser) {
    const roleForLogin =
      activeView === 'ADMIN'
        ? 'ADMIN'
        : activeView === 'DRIVER'
        ? 'DRIVER'
        : (ENABLE_PARENT_PORTAL && activeView === 'PARENT')
        ? 'PARENT'
        : 'STUDENT';
    return <StudentLoginPage initialRole={roleForLogin} />;
  }

  // Phase 1 Guard: Parent Portal is deferred to Phase 2 unless VITE_ENABLE_PARENT_PORTAL=true
  if (!ENABLE_PARENT_PORTAL && (activeView === 'PARENT' || currentUser.role === 'PARENT')) {
    return <StudentLoginPage initialRole="STUDENT" />;
  }

  // Parent View (Screen 4)
  if (ENABLE_PARENT_PORTAL && (activeView === 'PARENT' || currentUser.role === 'PARENT')) {
    return <ParentPortal />;
  }

  // Admin View (Screen 2)
  if (activeView === 'ADMIN' || currentUser.role === 'ADMIN') {
    return <AdminDashboard />;
  }

  // Driver Console View (Screen 1 & 2)
  if (activeView === 'DRIVER' || currentUser.role === 'DRIVER') {
    return <DriverConsole />;
  }

  if (activeView === 'STUDENT_LOGIN') {
    return <StudentLoginPage />;
  }

  // Student Commute HUD (Screen 3)
  return <StudentPortal />;
};

const MainShell: React.FC = () => {
  const {
    currentUser,
    latestToast,
    dismissToast,
    isMobileShell,
    mobilePreviewFrame,
    toggleMobilePreviewFrame,
    isInstallModalOpen,
    setIsInstallModalOpen,
    isDark,
    toggleDark,
  } = useCommuteSimulation();

  useEffect(() => {
    if (!latestToast) return;
    const t = window.setTimeout(dismissToast, 5500);
    return () => window.clearTimeout(t);
  }, [latestToast, dismissToast]);

  const toastColors = {
    info: 'border-indigo-200/90 bg-white/95 text-slate-900 shadow-[0_14px_34px_-12px_rgba(79,70,229,0.22)] dark:bg-[#1E2430]/95 dark:border-[#2E3646] dark:text-white',
    success: 'border-emerald-200 bg-emerald-50/95 text-emerald-900 shadow-lg dark:bg-[#163828] dark:border-[#22543D] dark:text-[#A7F3D0]',
    warning: 'border-amber-200 bg-amber-50/95 text-amber-900 shadow-lg dark:bg-[#3D2C15] dark:border-[#523A1B] dark:text-[#FDE68A]',
    danger: 'border-rose-200 bg-rose-50/95 text-rose-900 shadow-lg dark:bg-[#3C1818] dark:border-[#5B2222] dark:text-[#FECACA]',
  };

  const toastEl = latestToast && (
    <div
      className={`animate-panel-in z-50 rounded-2xl border p-3.5 shadow-xl backdrop-blur-xl ${
        mobilePreviewFrame
          ? 'absolute bottom-20 inset-x-3'
          : isMobileShell
          ? 'fixed bottom-20 inset-x-4 mx-auto max-w-sm'
          : 'fixed top-4 right-4 w-full max-w-sm'
      } ${toastColors[latestToast.tone]}`}
      role="status"
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <p className="text-xs font-extrabold tracking-tight">{latestToast.title}</p>
          <p className="mt-0.5 text-[11px] opacity-90">{latestToast.body}</p>
        </div>
        <button
          type="button"
          onClick={dismissToast}
          className="rounded-lg p-1 text-slate-400 hover:bg-indigo-50 hover:text-slate-900 dark:hover:bg-white/10 dark:hover:text-white cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );

  // Desktop interactive Phone Frame preview (Optional simulation viewport)
  if (mobilePreviewFrame) {
    return (
      <div className="bg-prismatic-canvas relative flex min-h-screen flex-col items-center justify-center p-4 text-slate-900 dark:text-slate-100">
        <div className="relative z-10 mb-3 flex items-center gap-3">
          <span className="prismatic-card rounded-full px-3.5 py-1 text-xs font-extrabold text-[#4F46E5] dark:text-indigo-400">
            Mobile Viewport (Live Preview)
          </span>
          <button
            type="button"
            onClick={toggleMobilePreviewFrame}
            className="prismatic-card tactile-btn inline-flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-bold text-slate-900 dark:text-white cursor-pointer"
          >
            <Monitor className="h-3.5 w-3.5 text-[#06B6D4]" />
            Full Screen
          </button>
        </div>

        {/* Phone Bezel */}
        <div className="bg-prismatic-canvas relative z-10 flex h-[min(840px,calc(100vh-5.5rem))] w-[420px] max-w-full flex-col overflow-hidden rounded-[44px] border-[8px] border-white/95 shadow-[0_28px_75px_-18px_rgba(79,70,229,0.28)] ring-1 ring-indigo-100 dark:border-[#2E3646] dark:ring-white/10">
          {/* Phone Status Bar */}
          <div className="flex shrink-0 items-center justify-between bg-transparent px-6 pt-2.5 pb-1 text-[11px] font-bold text-slate-500 dark:text-slate-400">
            <span className="font-mono-timer">09:41</span>
            <div className="h-4 w-20 rounded-full bg-slate-900/90 dark:bg-black" />
            <div className="flex items-center gap-1.5">
              <Signal className="h-3 w-3 text-[#4F46E5] dark:text-indigo-400" />
              <Wifi className="h-3 w-3 text-[#06B6D4]" />
              <BatteryCharging className="h-3.5 w-3.5 text-emerald-600" />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            <Suspense fallback={<PortalLoadingSkeleton />}>
              <ActiveViewBody />
            </Suspense>
          </div>

          {toastEl}

          {isMobileShell && (
            <div className="shrink-0">
              <MobileBottomNav />
            </div>
          )}
        </div>

        <ApiKeyModal />
        <InstallAppModal
          isOpen={isInstallModalOpen}
          onClose={() => setIsInstallModalOpen(false)}
        />
      </div>
    );
  }

  // Full Screen View with Prismatic Daylight Glass Canvas
  return (
    <div className="bg-prismatic-canvas relative min-h-screen overflow-x-hidden text-slate-900 transition-colors dark:text-slate-100">
      <div className="relative z-10">
        {toastEl}

        <main className="mx-auto w-full max-w-5xl lg:max-w-6xl px-1.5 sm:px-4 md:px-6 pt-2 sm:pt-5 pb-32 sm:pb-16">
          <Suspense fallback={<PortalLoadingSkeleton />}>
            <ActiveViewBody />
          </Suspense>
        </main>

        {isMobileShell && (
          <div className="fixed inset-x-0 bottom-0 z-40">
            <MobileBottomNav />
          </div>
        )}

        {/* Discreet frosted bottom floating utility dock */}
        <div className={`prismatic-card fixed right-3 z-40 flex items-center gap-1.5 rounded-full p-1.5 ${
          isMobileShell && currentUser
            ? 'bottom-[calc(4.75rem+env(safe-area-inset-bottom))]'
            : 'bottom-3'
        }`}>
          <button
            type="button"
            onClick={toggleDark}
            className="tactile-btn rounded-full p-2 text-slate-500 hover:bg-indigo-50 hover:text-[#4F46E5] dark:text-slate-300 dark:hover:bg-[#2B313F] dark:hover:text-white cursor-pointer"
            title="Toggle Light / Dark Mode"
          >
            {isDark ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={toggleMobilePreviewFrame}
            className="tactile-btn hidden md:inline-flex rounded-full p-2 text-slate-500 hover:bg-cyan-50 hover:text-cyan-600 dark:text-slate-300 dark:hover:bg-[#2B313F] dark:hover:text-cyan-300 cursor-pointer"
            title="Toggle Phone Simulator Viewport"
          >
            <Smartphone className="h-4 w-4" />
          </button>
        </div>

        <ApiKeyModal />
        <InstallAppModal
          isOpen={isInstallModalOpen}
          onClose={() => setIsInstallModalOpen(false)}
        />
      </div>
    </div>
  );
};

export function App() {
  return (
    <CommuteSimulationProvider>
      <MainShell />
    </CommuteSimulationProvider>
  );
}

export default App;
