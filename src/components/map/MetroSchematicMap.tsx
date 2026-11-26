import React from 'react';
import type { BusVehicle } from '../../types/transit';

interface MetroSchematicMapProps {
  activeBus: BusVehicle;
  highlightStopId?: string;
  className?: string;
}

const MetroSchematicMapComponent: React.FC<MetroSchematicMapProps> = ({
  activeBus,
  highlightStopId,
  className = '',
}) => {
  const stops = activeBus.stops && activeBus.stops.length > 0 ? activeBus.stops : [];
  const targetHighlightStopId = highlightStopId || stops[0]?.id || '';

  // Dynamic schematic layout computed directly from activeBus.stops (width: 725, height: 185)
  const metroStations = stops.map((stop, i, arr) => {
    const total = Math.max(arr.length - 1, 1);
    const x = Math.round(45 + (i / total) * (680 - 45));
    // Gentle alternating elevation so labels and markers remain crisp without collision
    const y = i === total ? 95 : (i % 3 === 0 ? 115 : (i % 3 === 1 ? 80 : 60));
    const isInterchange = Boolean(stop.metroInterchange);
    const interchangeLine = typeof stop.metroInterchange === 'object' ? stop.metroInterchange.line : undefined;
    const isTerminus = stop.areaClusterId === 'cluster-campus' || i === total;
    const isBypassed = Boolean(stop.isBypassed);

    return {
      id: stop.id,
      name: stop.shortName || stop.name,
      subtitle: typeof stop.metroInterchange === 'object' ? stop.metroInterchange.stationName : (isTerminus ? 'Campus Terminus' : stop.name),
      x,
      y,
      isInterchange,
      interchangeLine,
      isTerminus,
      isBypassed,
      sequence: i + 1,
    };
  });

  const currentStopIndex = Math.min(
    Math.max(activeBus.currentStopIndex ?? 0, 0),
    Math.max(metroStations.length - 1, 0)
  );

  // Calculate bus pin position on the track between current stop and next stop
  const currentSt = metroStations[currentStopIndex] || metroStations[0] || { x: 45, y: 95 };
  const nextSt = metroStations[currentStopIndex + 1] || currentSt;
  const progress = activeBus.segmentProgress ?? 0.35;
  const busX = currentSt.x + (nextSt.x - currentSt.x) * progress;
  const busY = currentSt.y + (nextSt.y - currentSt.y) * progress;

  // Compute full polyline path
  const fullTrackPathD = metroStations.map((st, i) => `${i === 0 ? 'M' : 'L'} ${st.x} ${st.y}`).join(' ');
  // Compute passed segment path
  const passedTrackPathD = metroStations.slice(0, currentStopIndex + 1).map((st, i) => `${i === 0 ? 'M' : 'L'} ${st.x} ${st.y}`).join(' ');

  return (
    <div className={`relative w-full overflow-hidden rounded-2xl bg-[#F7F9FF] p-3.5 dark:bg-[#1E2430] ${className}`}>
      {/* Metro Line Header Pill */}
      <div className="mb-2 flex items-center justify-between px-1 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-[#4F46E5] to-[#06B6D4] text-[10px] font-black text-white shadow-xs">
            M
          </span>
          <span className="font-extrabold uppercase tracking-wider text-[#4F46E5] dark:text-[#38BDF8]">
            {activeBus.routeName || 'Hyderabad Metro Corridor • Campus Express'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-cyan-50 border border-cyan-200 px-2.5 py-0.5 text-[10px] font-bold text-cyan-800 dark:bg-cyan-950/60 dark:border-cyan-800/50 dark:text-cyan-300">
            {Math.round(activeBus.speedKmh)} km/h
          </span>
          <span className="rounded-full bg-gradient-to-r from-[#4F46E5] to-[#06B6D4] px-2.5 py-0.5 text-[10px] font-bold text-white">
            {activeBus.routeNumber}
          </span>
        </div>
      </div>

      {/* SVG Canvas for Isometric Metro Schematic */}
      <div className="w-full overflow-x-auto">
        <svg
          viewBox="0 0 725 185"
          className="min-w-[650px] w-full select-none"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Outer glow background track */}
          {fullTrackPathD && (
            <path
              d={fullTrackPathD}
              stroke="#E2E8F0"
              strokeWidth="10"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="dark:stroke-[#374151]"
            />
          )}

          {/* Core Electric Metro Line Track */}
          {fullTrackPathD && (
            <path
              d={fullTrackPathD}
              stroke="#06B6D4"
              strokeWidth="6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Passed segment overlay (Electric Indigo #4F46E5) */}
          {passedTrackPathD && (
            <path
              d={passedTrackPathD}
              stroke="#4F46E5"
              strokeWidth="6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="dark:stroke-[#818CF8]"
            />
          )}

          {/* Flyover Bypass Dash indicator */}
          {activeBus.flyoverBypassActive && metroStations.length >= 4 && (
            <path
              d={`M ${metroStations[1]?.x || 120} ${(metroStations[1]?.y || 80) - 15} Q ${(metroStations[2]?.x || 250)} 20 ${metroStations[Math.min(4, metroStations.length - 1)]?.x || 450} ${(metroStations[Math.min(4, metroStations.length - 1)]?.y || 80) + 15}`}
              stroke="#4F46E5"
              strokeWidth="3.5"
              strokeDasharray="4 4"
              fill="none"
            />
          )}

          {/* Render Metro Stations */}
          {metroStations.map((st, idx) => {
            const isPassed = idx < currentStopIndex;
            const isCurrent = idx === currentStopIndex;
            const isHighlighted = st.id === targetHighlightStopId;
            const isBypassed = st.isBypassed;

            return (
              <g key={st.id} opacity={isBypassed ? 0.45 : 1}>
                {/* Station Node Marker */}
                {st.isTerminus ? (
                  <g transform={`translate(${st.x}, ${st.y})`}>
                    <line x1="0" y1="-12" x2="0" y2="12" stroke="#4F46E5" strokeWidth="4" className="dark:stroke-[#818CF8]" />
                    <rect x="-6" y="-6" width="12" height="12" rx="3" fill="#4F46E5" stroke="#FFFFFF" strokeWidth="2.5" className="dark:fill-[#818CF8]" />
                  </g>
                ) : st.isInterchange ? (
                  <g transform={`translate(${st.x}, ${st.y})`}>
                    <circle
                      cx="0"
                      cy="0"
                      r="9"
                      fill="#FFFFFF"
                      stroke={isBypassed ? '#9CA3AF' : isCurrent ? '#F97316' : isPassed ? '#4F46E5' : '#06B6D4'}
                      strokeWidth="3.5"
                      strokeDasharray={isBypassed ? '3 2' : undefined}
                      className="dark:fill-[#1E2430]"
                    />
                    <circle
                      cx="0"
                      cy="0"
                      r="4"
                      fill={isBypassed ? '#9CA3AF' : isCurrent ? '#F97316' : isPassed ? '#4F46E5' : '#06B6D4'}
                      className="dark:fill-[#38BDF8]"
                    />
                  </g>
                ) : (
                  <circle
                    cx={st.x}
                    cy={st.y}
                    r="5.5"
                    fill="#FFFFFF"
                    stroke={isBypassed ? '#9CA3AF' : isCurrent ? '#F97316' : isPassed ? '#4F46E5' : '#64748B'}
                    strokeWidth="2.5"
                    strokeDasharray={isBypassed ? '2 2' : undefined}
                    className="dark:fill-[#1E2430]"
                  />
                )}

                {/* Highlight Halo for Student Stop */}
                {isHighlighted && !isBypassed && (
                  <g transform={`translate(${st.x}, ${st.y})`}>
                    <circle cx="0" cy="0" r="16" fill="none" stroke="#E65100" strokeWidth="2" strokeDasharray="3 3" className="animate-spin" />
                    <rect x="-24" y="-32" width="48" height="14" rx="4" fill="#E65100" />
                    <text x="0" y="-22" fill="#FFFFFF" fontSize="8" fontWeight="800" textAnchor="middle" fontFamily="system-ui">
                      YOUR STOP
                    </text>
                  </g>
                )}

                {/* Bypassed Badge */}
                {isBypassed && (
                  <g transform={`translate(${st.x - 20}, ${st.y - 28})`}>
                    <rect x="0" y="0" width="40" height="11" rx="3" fill="#6B7280" opacity="0.9" />
                    <text x="20" y="8" fill="#FFFFFF" fontSize="6.5" fontWeight="800" textAnchor="middle" fontFamily="system-ui">
                      BYPASSED
                    </text>
                  </g>
                )}

                {/* Station Labels */}
                <text
                  x={st.x}
                  y={st.y > 80 ? st.y + 18 : st.y - 14}
                  textAnchor="middle"
                  fill="#111827"
                  fontSize="9.5"
                  fontWeight="800"
                  fontFamily="system-ui"
                  className={isBypassed ? 'line-through text-slate-400 dark:fill-slate-500' : 'dark:fill-white'}
                >
                  {st.name}
                </text>

                <text
                  x={st.x}
                  y={st.y > 80 ? st.y + 28 : st.y - 25}
                  textAnchor="middle"
                  fill="#6B7280"
                  fontSize="7.5"
                  fontWeight="600"
                  fontFamily="system-ui"
                  className="dark:fill-[#9CA3AF]"
                >
                  {st.subtitle}
                </text>

                {/* Interchange Pill */}
                {st.isInterchange && !isBypassed && (
                  <g transform={`translate(${st.x - 14}, ${st.y > 80 ? st.y + 32 : st.y - 36})`}>
                    <rect x="0" y="0" width="28" height="9" rx="2.5" fill="#E0F2FE" className="dark:fill-sky-950" />
                    <text x="14" y="7" textAnchor="middle" fill="#0369A1" fontSize="6.5" fontWeight="800" fontFamily="system-ui" className="dark:fill-sky-300">
                      METRO
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Active Live Bus Marker on the Metro Line */}
          <g transform={`translate(${busX}, ${busY})`}>
            <circle cx="0" cy="0" r="14" fill="#4F46E5" opacity="0.28" className="animate-ping" />
            <circle cx="0" cy="0" r="11" fill="#4F46E5" stroke="#FFFFFF" strokeWidth="2" />
            <rect x="-5" y="-3.5" width="10" height="7" rx="1.5" fill="white" />
            <circle cx="-2" cy="1.5" r="0.8" fill="#4F46E5" />
            <circle cx="2" cy="1.5" r="0.8" fill="#4F46E5" />
            <rect x="-3.5" y="-2.5" width="7" height="2" rx="0.5" fill="#4F46E5" />
          </g>
        </svg>
      </div>

      {/* Corridor Legend Footer */}
      <div className="mt-2 flex flex-wrap items-center justify-between border-t border-slate-200/80 pt-2 text-[10px] text-slate-600 dark:border-[#374151] dark:text-[#9CA3AF]">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#4F46E5]" />
            Passed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-r from-[#4F46E5] to-[#06B6D4]" />
            Live Bus Location
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full border border-[#06B6D4] bg-white" />
            Metro Interchange
          </span>
          <span className="flex items-center gap-1.5 opacity-60">
            <span className="h-2 w-2 rounded-full border border-dashed border-gray-500 bg-gray-200 dark:bg-gray-700" />
            Bypassed Area Stop
          </span>
        </div>
        <span className="font-medium truncate max-w-xs">{activeBus.corridorSummary || 'Direct connectivity via Sreenidhi Corridor'}</span>
      </div>
    </div>
  );
};

export const MetroSchematicMap = React.memo(MetroSchematicMapComponent);
