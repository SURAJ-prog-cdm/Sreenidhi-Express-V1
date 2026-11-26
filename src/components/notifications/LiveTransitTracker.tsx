import React from 'react';
import { Bus, MapPin, CheckCircle2, Clock, AlertTriangle, Radio } from 'lucide-react';
import { useCommuteSimulation, useLiveTelemetry } from '../../context/useCommuteSimulation';

interface LiveTransitTrackerProps {
  routeId?: string;
  routeName?: string;
  pickupStop?: string;
  isTripStarted?: boolean;
  delayMinutes?: number;
  formattedCountdown?: string;
  studentName?: string;
  rollNumber?: string;
}

const LiveTransitTrackerComponent: React.FC<LiveTransitTrackerProps> = ({
  routeId = 'route-14',
  routeName = 'Secunderabad – Tarnaka – SNIST',
  pickupStop = 'Tarnaka X Road',
  isTripStarted = true,
  delayMinutes = 0,
  formattedCountdown = '00:23:45',
  studentName = 'Aarav Sharma',
}) => {
  const { activeBus } = useLiveTelemetry();
  const { activeStudent } = useCommuteSimulation();
  const driver = activeBus?.driverName || 'P. Srinivas Rao';
  const plate = (activeBus as any)?.registrationNo || (activeBus as any)?.busNumber || 'AP 29 TA 4414';
  // 4 E-Commerce Milestone Steps
  const steps = [
    {
      id: 1,
      title: 'Bus Dispatched',
      subtitle: `Departed ${activeBus?.stops?.[0]?.shortName || 'Terminal'}`,
      time: activeBus?.stops?.[0]?.scheduledMorningTime || '07:10 AM',
      status: isTripStarted ? 'completed' : 'pending',
      icon: Bus
    },
    {
      id: 2,
      title: 'Approaching Stop',
      subtitle: `${pickupStop} (5m Heads-up)`,
      time: delayMinutes > 0 ? `+${delayMinutes}m delay` : formattedCountdown,
      status: isTripStarted ? 'active' : 'pending',
      icon: Clock
    },
    {
      id: 3,
      title: 'Student Boarded',
      subtitle: `${studentName} onboard`,
      time: 'Ready',
      status: (activeStudent?.boardingStatus as string) === 'ON_BOARD'
        ? 'completed'
        : isTripStarted
        ? 'active'
        : 'pending',
      icon: CheckCircle2
    },
    {
      id: 4,
      title: 'SNIST Campus Arrival',
      subtitle: 'Sreenidhi Main Gate',
      time: '08:35 AM',
      status: 'pending',
      icon: MapPin
    }
  ];

  return (
    <div className="prismatic-card animate-panel-in rounded-3xl p-5 text-slate-900 dark:text-slate-100 transition-all">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200/70 dark:border-[#2E3646]">
        <div className="flex items-center space-x-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#4F46E5] to-[#06B6D4] flex items-center justify-center text-white shadow-sm shadow-indigo-500/25">
              <Bus className="w-5 h-5" />
            </div>
            {isTripStarted && (
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-[#06B6D4]"></span>
              </span>
            )}
          </div>
          <div>
            <div className="flex items-center space-x-2 flex-wrap">
              <h4 className="text-sm font-extrabold text-slate-900 dark:text-white tracking-wide uppercase">
                Live Ride Tracker · {routeId.replace('route-', 'Route ')}
              </h4>
              <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full ${
                isTripStarted 
                  ? 'bg-cyan-50 text-cyan-800 border border-cyan-200 dark:bg-cyan-950/60 dark:text-cyan-300 dark:border-cyan-800/50' 
                  : 'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/40'
              }`}>
                {isTripStarted ? '● EN ROUTE' : '○ NOT STARTED'}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {routeName} · Pickup: <strong className="text-[#4F46E5] dark:text-cyan-300">{pickupStop}</strong>
            </p>
          </div>
        </div>

        {/* Live countdown & delay tag */}
        <div className="flex items-center space-x-2">
          {delayMinutes > 0 && (
            <div className="px-2.5 py-1 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 dark:bg-amber-950/50 dark:border-amber-800/50 dark:text-amber-300 text-xs font-semibold flex items-center space-x-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>+{delayMinutes}m Traffic Delay</span>
            </div>
          )}
          <div className="prismatic-subcard px-3 py-1 rounded-xl text-xs font-mono">
            <span className="text-slate-500 dark:text-slate-400">Arrival in: </span>
            <span className="text-[#4F46E5] dark:text-cyan-300 font-bold">{formattedCountdown}</span>
          </div>
        </div>
      </div>

      {/* Interactive Milestone Stepper */}
      <div className="pt-5 pb-2">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {steps.map((st) => {
            const Icon = st.icon;
            const isCompleted = st.status === 'completed';
            const isActive = st.status === 'active';

            return (
              <div
                key={st.id}
                className={`p-3.5 rounded-2xl border transition-all ${
                  isActive
                    ? 'bg-gradient-to-br from-indigo-50/90 via-white to-cyan-50/80 border-[#4F46E5]/45 shadow-md shadow-indigo-500/10 ring-1 ring-[#4F46E5]/20 dark:from-indigo-950/50 dark:via-[#1E2430] dark:to-cyan-950/40 dark:border-cyan-500/40'
                    : isCompleted
                    ? 'bg-emerald-50/60 border-emerald-200/80 dark:bg-emerald-950/25 dark:border-emerald-800/40'
                    : 'bg-[#F7F9FF]/80 border-slate-200/75 opacity-75 dark:bg-[#141821]/70 dark:border-[#2E3646]'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div
                    className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs font-bold ${
                      isActive
                        ? 'bg-gradient-to-br from-[#4F46E5] to-[#06B6D4] text-white shadow-xs animate-pulse'
                        : isCompleted
                        ? 'bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/60 dark:text-emerald-300 dark:border-emerald-600/40'
                        : 'bg-slate-200/80 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400">{st.time}</span>
                </div>
                <h5 className="text-xs font-extrabold text-slate-900 dark:text-white mb-0.5">{st.title}</h5>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{st.subtitle}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer Info Strip */}
      <div className="mt-4 pt-3 border-t border-slate-200/70 dark:border-[#2E3646] flex flex-wrap items-center justify-between text-xs text-slate-500 dark:text-slate-400 gap-2">
        <div className="flex items-center space-x-2">
          <Radio className="w-3.5 h-3.5 text-[#06B6D4] animate-pulse" />
          <span>
            {activeBus?.telemetrySource === 'DRIVER_PRIMARY'
              ? 'Live GPS + OSRM road-snapped tracking active'
              : 'Crowd-sourced telemetry active'}
          </span>
        </div>
        <div className="flex items-center space-x-3 text-[11px]">
          <span className="text-slate-700 dark:text-slate-300 font-medium">Driver: {driver}</span>
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <span className="text-[#4F46E5] dark:text-cyan-300 font-bold">Bus {plate}</span>
        </div>
      </div>
    </div>
  );
};

export const LiveTransitTracker = React.memo(LiveTransitTrackerComponent);
