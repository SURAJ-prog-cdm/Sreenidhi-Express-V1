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
    <div className="bg-[#181C24] border border-[#262C36] rounded-2xl p-5 shadow-lg text-[#E5E8EC] transition-all">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#262C36]">
        <div className="flex items-center space-x-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-xl bg-[#0D4B42]/50 border border-[#10B981]/40 flex items-center justify-center text-[#10B981]">
              <Bus className="w-5 h-5" />
            </div>
            {isTripStarted && (
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
            )}
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h4 className="text-sm font-bold text-white tracking-wide uppercase">
                Live Ride Tracker · {routeId.replace('route-', 'Route ')}
              </h4>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                isTripStarted 
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                  : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
              }`}>
                {isTripStarted ? '● EN ROUTE' : '○ NOT STARTED'}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {routeName} · Pickup: <strong className="text-emerald-400">{pickupStop}</strong>
            </p>
          </div>
        </div>

        {/* Live countdown & delay tag */}
        <div className="flex items-center space-x-2">
          {delayMinutes > 0 && (
            <div className="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-semibold flex items-center space-x-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>+{delayMinutes}m Traffic Delay</span>
            </div>
          )}
          <div className="px-3 py-1 rounded-xl bg-[#11141A] border border-[#2A313D] text-xs font-mono">
            <span className="text-slate-400">Arrival in: </span>
            <span className="text-emerald-400 font-bold">{formattedCountdown}</span>
          </div>
        </div>
      </div>

      {/* E-Commerce Milestone Stepper */}
      <div className="pt-5 pb-2">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {steps.map((st) => {
            const Icon = st.icon;
            const isCompleted = st.status === 'completed';
            const isActive = st.status === 'active';

            return (
              <div
                key={st.id}
                className={`p-3.5 rounded-xl border transition-all ${
                  isActive
                    ? 'bg-[#0D4B42]/30 border-emerald-500/50 shadow-md shadow-emerald-950/40 ring-1 ring-emerald-500/40'
                    : isCompleted
                    ? 'bg-[#151921] border-[#2E3746]'
                    : 'bg-[#11141A]/50 border-[#222834] opacity-70'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${
                      isActive
                        ? 'bg-emerald-500 text-slate-950 animate-pulse'
                        : isCompleted
                        ? 'bg-emerald-900/60 text-emerald-400 border border-emerald-500/40'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">{st.time}</span>
                </div>
                <h5 className="text-xs font-bold text-white mb-0.5">{st.title}</h5>
                <p className="text-[11px] text-slate-400 truncate">{st.subtitle}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer Info Strip */}
      <div className="mt-4 pt-3 border-t border-[#222834] flex flex-wrap items-center justify-between text-xs text-slate-400 gap-2">
        <div className="flex items-center space-x-2">
          <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
          <span>
            {activeBus?.telemetrySource === 'DRIVER_PRIMARY'
              ? 'Live GPS + OSRM road-snapped tracking active'
              : 'Crowd-sourced telemetry active'}
          </span>
        </div>
        <div className="flex items-center space-x-3 text-[11px]">
          <span className="text-slate-300">Driver: {driver}</span>
          <span className="text-slate-500">·</span>
          <span className="text-emerald-400">Bus {plate}</span>
        </div>
      </div>
    </div>
  );
};

export const LiveTransitTracker = React.memo(LiveTransitTrackerComponent);
