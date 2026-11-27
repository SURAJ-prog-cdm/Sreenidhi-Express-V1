import React, { useId } from 'react';
import { Bus, ExternalLink, MapPin, Navigation } from 'lucide-react';
import type { BusVehicle } from '../../types/transit';
import { SREENIDHI_CAMPUS } from '../../data/sreenidhiData';
import { haversineMeters, projectGpsOntoStops } from '../../services/corridorProjection.ts';

export { projectGpsOntoStops, haversineMeters, type GpsProjectionResult } from '../../services/corridorProjection.ts';

interface MetroSchematicMapProps {
  activeBus: BusVehicle;
  highlightStopId?: string;
  compact?: boolean;
  className?: string;
}

function isMorningShiftIst(): boolean {
  const istHour = new Date(Date.now() + 5.5 * 3600 * 1000).getUTCHours();
  return istHour < 12;
}

const MetroSchematicMapComponent: React.FC<MetroSchematicMapProps> = ({
  activeBus,
  highlightStopId,
  compact = false,
  className = '',
}) => {
  const stops = activeBus.stops && activeBus.stops.length > 0 ? activeBus.stops : [];
  const gradientId = useId().replace(/:/g, '');
  const resolvedHighlightStop =
    stops.find(
      (s) =>
        s.id === highlightStopId ||
        s.name === highlightStopId ||
        s.shortName === highlightStopId
    ) || stops[0];
  const targetHighlightStopId = resolvedHighlightStop?.id || '';

  const fallbackIdx = Math.min(
    Math.max(activeBus.currentStopIndex ?? 0, 0),
    Math.max(stops.length - 1, 0)
  );
  const projection = projectGpsOntoStops(
    activeBus.currentLat,
    activeBus.currentLng,
    stops,
    fallbackIdx,
    activeBus.segmentProgress ?? 0
  );

  const isTripIdle = activeBus.status === 'DEPARTED';
  const hasLiveGps = projection.isGpsProjected && !isTripIdle;
  const isOffRoute = hasLiveGps && projection.offRouteMeters > 400;

  const nextStopIndex = Math.min(
    projection.segmentIndex + (projection.segmentProgress > 0.05 ? 1 : 0),
    Math.max(stops.length - 1, 0)
  );
  const nextStop =
    stops[Math.min(projection.segmentIndex + 1, Math.max(stops.length - 1, 0))] ||
    stops[nextStopIndex] ||
    stops[0];

  const speedRounded = Math.round(activeBus.speedKmh || 0);
  const shortBusNum = activeBus.routeNumber.replace(/^Route\s*/i, '').trim() || activeBus.routeNumber;
  const progressPct = Math.round(projection.segmentProgress * 100);
  const morningShift = isMorningShiftIst();

  // Compute remaining distance to highlighted stop via Haversine
  let distanceToHighlightText = '';
  if (
    resolvedHighlightStop &&
    Number.isFinite(activeBus.currentLat) &&
    Number.isFinite(activeBus.currentLng) &&
    (Math.abs(activeBus.currentLat) > 0.0001 || Math.abs(activeBus.currentLng) > 0.0001)
  ) {
    const meters = haversineMeters(
      activeBus.currentLat,
      activeBus.currentLng,
      resolvedHighlightStop.lat,
      resolvedHighlightStop.lng
    );
    distanceToHighlightText =
      meters < 1000
        ? `${Math.round(meters)} m to ${resolvedHighlightStop.shortName || resolvedHighlightStop.name}`
        : `${(meters / 1000).toFixed(1)} km to ${resolvedHighlightStop.shortName || resolvedHighlightStop.name}`;
  }

  // Free Google Maps live pin link (zero tile embedding cost)
  const pinLat =
    Number.isFinite(activeBus.currentLat) && Math.abs(activeBus.currentLat) > 0.0001
      ? activeBus.currentLat
      : SREENIDHI_CAMPUS.lat;
  const pinLng =
    Number.isFinite(activeBus.currentLng) && Math.abs(activeBus.currentLng) > 0.0001
      ? activeBus.currentLng
      : SREENIDHI_CAMPUS.lng;
  const googleMapsPinUrl = `https://www.google.com/maps/search/?api=1&query=${pinLat},${pinLng}`;

  // Mobile vertical list indices (compact mode shows focused 4-stop window around bus + highlighted stop)
  const visibleMobileEntries = (() => {
    if (!compact || stops.length <= 5) {
      return stops.map((stop, idx) => ({ stop, idx, gapBefore: false }));
    }
    const minWindow = Math.max(0, Math.min(projection.segmentIndex - 1, stops.length - 4));
    const maxWindow = Math.min(stops.length - 1, minWindow + 3);
    const keepIndices = new Set<number>();
    for (let i = minWindow; i <= maxWindow; i++) {
      keepIndices.add(i);
    }
    const highlightIdx = stops.findIndex((s) => s.id === targetHighlightStopId);
    if (highlightIdx >= 0) {
      keepIndices.add(highlightIdx);
    }
    const sorted = Array.from(keepIndices).sort((a, b) => a - b);
    return sorted.map((idx, pos) => ({
      stop: stops[idx],
      idx,
      gapBefore: pos > 0 && sorted[pos - 1] < idx - 1,
    }));
  })();

  // Desktop/Tablet horizontal SVG stations (viewBox 760 x 195)
  const metroStations = stops.map((stop, i, arr) => {
    const total = Math.max(arr.length - 1, 1);
    const x = Math.round(45 + (i / total) * (715 - 45));
    const y = i === total ? 98 : i % 3 === 0 ? 118 : i % 3 === 1 ? 82 : 62;
    const isInterchange = Boolean(stop.metroInterchange);
    const isTerminus = stop.areaClusterId === 'cluster-campus' || i === total;
    const isBypassed = Boolean(stop.isBypassed);

    return {
      id: stop.id,
      name: stop.shortName || stop.name,
      subtitle:
        typeof stop.metroInterchange === 'object'
          ? stop.metroInterchange.stationName
          : isTerminus
            ? 'Campus Terminus'
            : morningShift
              ? stop.scheduledMorningTime
              : stop.scheduledEveningTime,
      x,
      y,
      isInterchange,
      isTerminus,
      isBypassed,
    };
  });

  const segIdx = Math.min(projection.segmentIndex, Math.max(metroStations.length - 1, 0));
  const segStartSt = metroStations[segIdx] || metroStations[0] || { x: 45, y: 98 };
  const segEndSt = metroStations[Math.min(segIdx + 1, Math.max(metroStations.length - 1, 0))] || segStartSt;
  const busX = segStartSt.x + (segEndSt.x - segStartSt.x) * projection.segmentProgress;
  const busY = segStartSt.y + (segEndSt.y - segStartSt.y) * projection.segmentProgress;

  const fullTrackPathD = metroStations
    .map((st, i) => `${i === 0 ? 'M' : 'L'} ${st.x} ${st.y}`)
    .join(' ');
  const passedStopsPath = metroStations
    .slice(0, segIdx + 1)
    .map((st, i) => `${i === 0 ? 'M' : 'L'} ${st.x} ${st.y}`);
  const passedTrackPathD =
    passedStopsPath.length > 0 ? `${passedStopsPath.join(' ')} L ${busX.toFixed(1)} ${busY.toFixed(1)}` : '';

  const showLiveBusAfterStop = (idx: number) =>
    stops.length > 0 &&
    ((stops.length === 1 && idx === 0) ||
      idx === projection.segmentIndex ||
      (projection.segmentIndex >= stops.length - 1 && idx === stops.length - 1));

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 dark:border-[#2E3646] dark:bg-[#1E2430]/95 ${className}`}
    >
      {/* Top External HUD Bar (Never overlaps schematic track) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 bg-[#F7F9FF] px-3.5 py-2.5 text-[11px] dark:border-[#2E3646] dark:bg-[#141821]">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${
              !hasLiveGps
                ? 'bg-slate-400'
                : isOffRoute
                  ? 'bg-amber-500 animate-pulse'
                  : 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.75)] animate-pulse'
            }`}
          />
          <span className="font-extrabold text-slate-900 dark:text-white whitespace-nowrap">
            {activeBus.routeNumber}
          </span>
          <span className="text-slate-300 dark:text-slate-600">•</span>
          <span className="font-mono font-bold text-[#4F46E5] dark:text-cyan-300 whitespace-nowrap">
            {speedRounded} km/h
          </span>
          {nextStop && (
            <>
              <span className="text-slate-300 dark:text-slate-600">•</span>
              <span className="truncate font-semibold text-slate-700 dark:text-slate-200">
                Next: <b className="text-slate-900 dark:text-white">{nextStop.shortName || nextStop.name}</b>
              </span>
            </>
          )}
        </div>

        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold shrink-0 ${
            !hasLiveGps
              ? 'bg-slate-200/90 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
              : isOffRoute
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
          }`}
        >
          {!hasLiveGps
            ? 'Scheduled'
            : isOffRoute
              ? `Detour / Off-Route (+${projection.offRouteMeters}m)`
              : 'Live GPS'}
        </span>
      </div>

      {/* Middle Area — Responsive Dual Schematic Layout */}
      <div className="bg-[#F7F9FF]/60 dark:bg-[#161B26]">
        {/* Mobile (sm:hidden): Where is My Train-style Vertical Live Corridor */}
        <div className="sm:hidden px-3.5 py-3">
          {stops.length === 0 ? (
            <p className="py-4 text-center text-xs italic text-slate-500 dark:text-slate-400">
              No corridor stops configured for this route.
            </p>
          ) : (
            <div className="space-y-0">
              {visibleMobileEntries.map(({ stop, idx, gapBefore }, listPos) => {
                const isLastRendered = listPos === visibleMobileEntries.length - 1;
                const isPassed = idx < projection.segmentIndex || (idx === projection.segmentIndex && projection.segmentProgress > 0.15);
                const isCurrentOrNext = idx === projection.segmentIndex || idx === projection.segmentIndex + 1;
                const isYourStop = stop.id === targetHighlightStopId;
                const isBypassed = Boolean(stop.isBypassed);
                const schedTime = morningShift ? stop.scheduledMorningTime : stop.scheduledEveningTime;

                return (
                  <React.Fragment key={stop.id}>
                    {gapBefore && (
                      <div className="flex items-center gap-3 py-1.5 pl-2.5">
                        <span className="h-4 w-0.5 border-l-2 border-dashed border-slate-300 dark:border-slate-600" />
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                          ••• Intermediate stops •••
                        </span>
                      </div>
                    )}

                    <div className="relative flex items-start gap-3">
                      {/* Left Rail Node + Vertical Track Line */}
                      <div className="flex flex-col items-center self-stretch">
                        <span
                          className={`z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-black shadow-xs transition-colors ${
                            isBypassed
                              ? 'border border-dashed border-slate-400 bg-slate-100 text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-500'
                              : isYourStop
                                ? 'bg-gradient-to-br from-amber-500 to-orange-600 text-white ring-2 ring-amber-300/70'
                                : isPassed
                                  ? 'bg-gradient-to-br from-[#4F46E5] to-[#06B6D4] text-white'
                                  : isCurrentOrNext
                                    ? 'border-2 border-[#06B6D4] bg-white text-[#4F46E5] dark:bg-[#1E2430] dark:text-cyan-300'
                                    : 'border border-slate-300 bg-white text-slate-500 dark:border-slate-600 dark:bg-[#1E2430] dark:text-slate-400'
                          }`}
                        >
                          {stop.sequence || idx + 1}
                        </span>
                        {!isLastRendered && (
                          <span
                            className={`w-0.5 flex-1 min-h-4 ${
                              idx < projection.segmentIndex
                                ? 'bg-gradient-to-b from-[#4F46E5] to-[#06B6D4]'
                                : 'bg-slate-200 dark:bg-slate-700'
                            }`}
                          />
                        )}
                      </div>

                      {/* Stop Label & Meta */}
                      <div className={`min-w-0 flex-1 pb-3 ${isBypassed ? 'opacity-55' : ''}`}>
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <span
                            className={`text-xs font-bold leading-snug ${
                              isBypassed
                                ? 'line-through text-slate-400 dark:text-slate-500'
                                : isYourStop
                                  ? 'text-[#4F46E5] dark:text-cyan-300 font-extrabold'
                                  : 'text-slate-900 dark:text-white'
                            }`}
                          >
                            {stop.name}
                          </span>
                          <span className="font-mono text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                            {schedTime}
                          </span>
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {isYourStop && !isBypassed && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-orange-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-white shadow-xs">
                              <MapPin className="h-2.5 w-2.5" />
                              YOUR STOP
                            </span>
                          )}
                          {isBypassed && (
                            <span className="inline-flex items-center rounded-full bg-slate-500 px-2 py-0.5 text-[9px] font-extrabold uppercase text-white">
                              Bypassed
                            </span>
                          )}
                          {stop.metroInterchange && !isBypassed && (
                            <span className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-[9px] font-bold text-sky-800 dark:bg-sky-950/60 dark:text-sky-300">
                              Metro: {stop.metroInterchange.stationName}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Smoothly Positioned Live Bus Pill Between Current & Next Stop */}
                    {showLiveBusAfterStop(idx) && (
                      <div className="relative flex items-center gap-3 py-1">
                        <div className="flex flex-col items-center self-stretch">
                          <span
                            className={`w-0.5 flex-1 ${
                              idx < stops.length - 1
                                ? 'bg-gradient-to-b from-[#4F46E5] to-[#06B6D4]'
                                : 'bg-transparent'
                            }`}
                          />
                        </div>
                        <div className="my-0.5 flex flex-1 items-center gap-2 rounded-xl bg-gradient-to-r from-[#4F46E5] to-[#06B6D4] px-3 py-2 text-[11px] font-extrabold text-white shadow-sm transition-all duration-700 ease-out">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/20">
                            <Bus className="h-3 w-3 text-white animate-pulse" />
                          </span>
                          <span className="truncate">
                            Bus #{shortBusNum} • {speedRounded} km/h •{' '}
                            {idx >= stops.length - 1
                              ? `At ${stop.shortName || stop.name}`
                              : `${progressPct}% to ${nextStop?.shortName || nextStop?.name || 'Campus'}`}
                          </span>
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>

        {/* Tablet/Desktop (hidden sm:block): Horizontal SVG Metro Corridor */}
        <div className="hidden sm:block p-3.5">
          <div className="w-full overflow-x-auto">
            <svg
              viewBox="0 0 760 195"
              className="min-w-[660px] w-full select-none"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#4F46E5" />
                  <stop offset="100%" stopColor="#06B6D4" />
                </linearGradient>
              </defs>

              {/* Outer Track Backing */}
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

              {/* Remaining Corridor Track (Muted Slate) */}
              {fullTrackPathD && (
                <path
                  d={fullTrackPathD}
                  stroke="#94A3B8"
                  strokeOpacity="0.45"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="dark:stroke-[#64748B]"
                />
              )}

              {/* Passed Segment Track Up To GPS Position (Indigo -> Cyan Gradient) */}
              {passedTrackPathD && (
                <path
                  d={passedTrackPathD}
                  stroke={`url(#${gradientId})`}
                  strokeWidth="6.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="transition-all duration-700 ease-out"
                />
              )}

              {/* Flyover Bypass Indicator */}
              {activeBus.flyoverBypassActive && metroStations.length >= 4 && (
                <path
                  d={`M ${metroStations[1]?.x || 120} ${(metroStations[1]?.y || 82) - 15} Q ${metroStations[2]?.x || 250} 20 ${metroStations[Math.min(4, metroStations.length - 1)]?.x || 450} ${(metroStations[Math.min(4, metroStations.length - 1)]?.y || 82) + 15}`}
                  stroke="#4F46E5"
                  strokeWidth="3.5"
                  strokeDasharray="4 4"
                  fill="none"
                />
              )}

              {/* Station Nodes */}
              {metroStations.map((st, idx) => {
                const isPassed = idx <= segIdx && (idx < segIdx || projection.segmentProgress > 0.08);
                const isCurrent = idx === segIdx;
                const isHighlighted = st.id === targetHighlightStopId;
                const isBypassed = st.isBypassed;

                return (
                  <g key={st.id} opacity={isBypassed ? 0.45 : 1}>
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
                          stroke={isBypassed ? '#9CA3AF' : isCurrent ? '#06B6D4' : isPassed ? '#4F46E5' : '#94A3B8'}
                          strokeWidth="3.5"
                          strokeDasharray={isBypassed ? '3 2' : undefined}
                          className="dark:fill-[#1E2430]"
                        />
                        <circle
                          cx="0"
                          cy="0"
                          r="4"
                          fill={isBypassed ? '#9CA3AF' : isCurrent ? '#06B6D4' : isPassed ? '#4F46E5' : '#94A3B8'}
                          className="dark:fill-[#38BDF8]"
                        />
                      </g>
                    ) : (
                      <circle
                        cx={st.x}
                        cy={st.y}
                        r="5.5"
                        fill="#FFFFFF"
                        stroke={isBypassed ? '#9CA3AF' : isCurrent ? '#06B6D4' : isPassed ? '#4F46E5' : '#64748B'}
                        strokeWidth="2.5"
                        strokeDasharray={isBypassed ? '2 2' : undefined}
                        className="dark:fill-[#1E2430]"
                      />
                    )}

                    {isHighlighted && !isBypassed && (
                      <g transform={`translate(${st.x}, ${st.y})`}>
                        <circle cx="0" cy="0" r="15" fill="none" stroke="#E65100" strokeWidth="2" strokeDasharray="3 3" />
                        <rect x="-25" y="-32" width="50" height="14" rx="4" fill="#E65100" />
                        <text x="0" y="-22" fill="#FFFFFF" fontSize="8" fontWeight="800" textAnchor="middle" fontFamily="system-ui">
                          YOUR STOP
                        </text>
                      </g>
                    )}

                    {isBypassed && (
                      <g transform={`translate(${st.x - 20}, ${st.y - 28})`}>
                        <rect x="0" y="0" width="40" height="11" rx="3" fill="#6B7280" opacity="0.9" />
                        <text x="20" y="8" fill="#FFFFFF" fontSize="6.5" fontWeight="800" textAnchor="middle" fontFamily="system-ui">
                          BYPASSED
                        </text>
                      </g>
                    )}

                    <text
                      x={st.x}
                      y={st.y > 82 ? st.y + 18 : st.y - 14}
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
                      y={st.y > 82 ? st.y + 28 : st.y - 25}
                      textAnchor="middle"
                      fill="#6B7280"
                      fontSize="7.5"
                      fontWeight="600"
                      fontFamily="system-ui"
                      className="dark:fill-[#9CA3AF]"
                    >
                      {st.subtitle}
                    </text>

                    {st.isInterchange && !isBypassed && (
                      <g transform={`translate(${st.x - 14}, ${st.y > 82 ? st.y + 32 : st.y - 36})`}>
                        <rect x="0" y="0" width="28" height="9" rx="2.5" fill="#E0F2FE" className="dark:fill-sky-950" />
                        <text x="14" y="7" textAnchor="middle" fill="#0369A1" fontSize="6.5" fontWeight="800" fontFamily="system-ui" className="dark:fill-sky-300">
                          METRO
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

              {/* Smoothly Gliding GPS-Projected Bus Marker */}
              <g
                className="transition-all duration-700 ease-out"
                style={{ transform: `translate(${busX}px, ${busY}px)` }}
              >
                <circle cx="0" cy="0" r="15" fill="#4F46E5" opacity="0.24" className="animate-ping" />
                <circle cx="0" cy="0" r="11" fill="#4F46E5" stroke="#FFFFFF" strokeWidth="2.2" />
                <rect x="-5" y="-3.5" width="10" height="7" rx="1.5" fill="white" />
                <circle cx="-2" cy="1.5" r="0.8" fill="#4F46E5" />
                <circle cx="2" cy="1.5" r="0.8" fill="#4F46E5" />
                <rect x="-3.5" y="-2.5" width="7" height="2" rx="0.5" fill="#4F46E5" />
              </g>
            </svg>
          </div>
        </div>
      </div>

      {/* Bottom External HUD Bar (Corridor Progress & Free Google Maps Pin) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 bg-[#F7F9FF] px-3.5 py-2.5 text-[11px] dark:border-[#2E3646] dark:bg-[#141821]">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 border border-indigo-200/80 px-2.5 py-0.5 text-[10px] font-extrabold text-[#4F46E5] dark:border-indigo-800/60 dark:bg-indigo-950/60 dark:text-cyan-300">
            Stop {stops.length > 0 ? projection.segmentIndex + 1 : 0} of {stops.length}
          </span>
          {distanceToHighlightText && (
            <span className="font-semibold text-slate-600 dark:text-slate-300 truncate">
              {distanceToHighlightText}
            </span>
          )}
        </div>

        <a
          href={googleMapsPinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-700 shadow-2xs transition hover:border-[#4F46E5] hover:text-[#4F46E5] dark:border-[#2E3646] dark:bg-[#1E2430] dark:text-slate-200 dark:hover:text-cyan-300"
        >
          <Navigation className="h-3 w-3 text-[#4F46E5] dark:text-cyan-300" />
          <span>Open Live Pin in Google Maps</span>
          <ExternalLink className="h-2.5 w-2.5 opacity-70" />
        </a>
      </div>
    </div>
  );
};

export const MetroSchematicMap = React.memo(MetroSchematicMapComponent);
