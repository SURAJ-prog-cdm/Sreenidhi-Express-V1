import React, { useMemo } from 'react';
import { Bus, GraduationCap, LogOut, ShieldCheck, UserCheck } from 'lucide-react';
import { useCommuteSimulation } from '../../context/useCommuteSimulation';
import { nativeDeviceService } from '../../services/nativeDeviceService';
import { audioSpeechService } from '../../services/audioSpeechService';
import type { PortalView } from '../../types/transit';

const MobileBottomNavComponent: React.FC = () => {
  const { activeView, setActiveView, currentUser, logoutUser } = useCommuteSimulation();

  const tabs = useMemo(() => {
    if (!currentUser) {
      return [{ id: 'STUDENT_LOGIN' as PortalView, label: 'Sign In', icon: UserCheck }];
    }
    if (currentUser.role === 'ADMIN') {
      return [
        { id: 'ADMIN' as PortalView, label: 'Admin', icon: ShieldCheck },
        { id: 'STUDENT' as PortalView, label: 'Student View', icon: GraduationCap },
        { id: 'DRIVER' as PortalView, label: 'Driver View', icon: Bus },
      ];
    }
    if (currentUser.role === 'DRIVER') {
      return [{ id: 'DRIVER' as PortalView, label: 'Driver Cabin', icon: Bus }];
    }
    return [{ id: 'STUDENT' as PortalView, label: 'Commute', icon: GraduationCap }];
  }, [currentUser]);

  const handleSelectTab = (id: PortalView) => {
    void nativeDeviceService.triggerHaptic('light');
    audioSpeechService.playClickTone();
    setActiveView(id);
  };

  if (!currentUser) {
    return null; // Don't show bottom navigation on login screen
  }

  return (
    <nav
      aria-label="Mobile App Bottom Navigation"
      className="border-t border-[#D1D5DB] bg-white/95 px-3 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-2xl dark:border-[#374151] dark:bg-[#181C24]/95"
    >
      <div className={`grid gap-2 ${tabs.length === 1 ? 'grid-cols-2' : tabs.length === 2 ? 'grid-cols-3' : 'grid-cols-4'}`}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeView === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleSelectTab(tab.id)}
              className={`flex flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[10px] font-bold transition cursor-pointer ${
                active
                  ? 'bg-[#4F46E5]/10 text-[#4F46E5] ring-1 ring-[#4F46E5]/30 dark:bg-indigo-950/60 dark:text-indigo-400 dark:ring-indigo-400/30'
                  : 'text-[#6B7280] hover:text-[#111827] dark:text-[#9CA3AF] dark:hover:text-white'
              }`}
            >
              <Icon className={`h-4 w-4 ${active ? 'scale-110' : ''}`} />
              <span>{tab.label}</span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => {
            void nativeDeviceService.triggerHaptic('medium');
            audioSpeechService.playClickTone();
            logoutUser();
          }}
          className="flex flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[10px] font-bold text-[#6B7280] hover:text-rose-500 dark:text-[#9CA3AF] dark:hover:text-rose-400 transition cursor-pointer"
          title="Sign out of current role"
        >
          <LogOut className="h-4 w-4" />
          <span>Logout</span>
        </button>
      </div>
    </nav>
  );
};

export const MobileBottomNav = React.memo(MobileBottomNavComponent);
