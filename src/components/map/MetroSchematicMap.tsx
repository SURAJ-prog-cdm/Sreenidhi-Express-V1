import React, { useEffect, useId, useRef, useState } from 'react';
import { ExternalLink, Navigation } from 'lucide-react';
import type { BusVehicle } from '../../types/transit';
import { SREENIDHI_CAMPUS } from '../../data/sreenidhiData';
import {
  buildGoogleMapsRouteUrl,
  haversineMeters,
  projectGpsOntoStops,
} from '../../services/corridorProjection.ts';

export {
  buildGoogleMapsRouteUrl,
  projectGpsOntoStops,
  haversineMeters,
  type GpsProjectionResult,
} from '../../services/corridorProjection.ts';

interface MetroSchematicMapProps {
  activeBus: BusVehicle;
  highlightStopId?: string;
  compact?: boolean;
  className?: string;
}

interface Pt {
  x: number;
  y: number;
}

interface CubicSeg {
  p0: Pt;
  cp1: Pt;
  cp2: Pt;
  p3: Pt;
}

function isMorningShiftIst(): boolean {
  const istHour = new Date(Date.now() + 5.5 * 3600 * 1000).getUTCHours();
  return istHour < 12;
}

function truncateLabel(text: string, maxLen: number): string {
  const clean = text.trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1)}…`;
}

function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function buildSegmentBezier(a: Pt, b: Pt): CubicSeg {
  const midX = (a.x + b.x) / 2;
  return {
    p0: a,
    cp1: { x: midX, y: a.y },
    cp2: { x: midX, y: b.y },
    p3: b,
  };
}

function evalCubicBezier(seg: CubicSeg, t: number): Pt {
  const u = Math.max(0, Math.min(1, t));
  const mt = 1 - u;
  const mt2 = mt * mt;
  const u2 = u * u;
  return {
    x: mt2 * mt * seg.p0.x + 3 * mt2 * u * seg.cp1.x + 3 * mt * u2 * seg.cp2.x + u2 * u * seg.p3.x,
    y: mt2 * mt * seg.p0.y + 3 * mt2 * u * seg.cp1.y + 3 * mt * u2 * seg.cp2.y + u2 * u * seg.p3.y,
  };
}

function splitCubicPrefix(seg: CubicSeg, t: number): CubicSeg {
  const u = Math.max(0, Math.min(1, t));
  const q0 = lerpPt(seg.p0, seg.cp1, u);
  const q1 = lerpPt(seg.cp1, seg.cp2, u);
  const q2 = lerpPt(seg.cp2, seg.p3, u);
  const r0 = lerpPt(q0, q1, u);
  const r1 = lerpPt(q1, q2, u);
  const s = lerpPt(r0, r1, u);
  return { p0: seg.p0, cp1: q0, cp2: r0, p3: s };
}

const MetroSchematicMapComponent: React.FC<MetroSchematicMapProps> = ({
  activeBus,
  highlightStopId,
  compact = false,
  className = '',
}) => {
  const stops = activeBus.stops && activeBus.stops.length > 0 ? activeBus.stops : [];
  const gradientId = useId().replace(/:/g, '');
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledAtRef = useRef<number>(0);
  const isProgrammaticScrollRef = useRef<boolean>(false);
  const didInitialCenterRef = useRef<boolean>(false);
  const lastRouteIdRef = useRef<string>(activeBus.routeId);
  const [hasOverflow, setHasOverflow] = useState<boolean>(stops.length > 5);

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

  const nextStop =
    stops[Math.min(projection.segmentIndex + 1, Math.max(stops.length - 1, 0))] || stops[0];

  const speedRounded = Math.round(activeBus.speedKmh || 0);
  const routeCodeMatch = activeBus.routeNumber.match(/\d+/);
  const routeShortCode = routeCodeMatch ? `R${routeCodeMatch[0]}` : activeBus.routeNumber.slice(0, 5);
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

  // Free multi-stop Google Maps Directions URL (/maps/dir/?api=1)
  const fallbackLat =
    Number.isFinite(activeBus.currentLat) && Math.abs(activeBus.currentLat) > 0.0001
      ? activeBus.currentLat
      : SREENIDHI_CAMPUS.lat;
  const fallbackLng =
    Number.isFinite(activeBus.currentLng) && Math.abs(activeBus.currentLng) > 0.0001
      ? activeBus.currentLng
      : SREENIDHI_CAMPUS.lng;
  const googleMapsRouteUrl = buildGoogleMapsRouteUrl(stops, { lat: fallbackLat, lng: fallbackLng });

  // Render all stops across the full scrollable curved corridor (no 4-stop crop in compact mode)
  const viewWidth = Math.max(760, 112 + Math.max(stops.length - 1, 1) * 88);
  const viewHeight = compact ? 214 : 224;
  const svgMinWidthPx = Math.max(660, stops.length >= 12 ? 920 : stops.length * 68);

  const padX = 56;
  const metroStations = stops.map((stop, i, arr) => {
    const total = Math.max(arr.length - 1, 1);
    const x =
      arr.length === 1
        ? Math.round(viewWidth / 2)
        : Math.round(padX + (i / total) * (viewWidth - padX * 2));

    const isTerminus = stop.areaClusterId === 'cluster-campus' || i === stops.length - 1;
    // Lower nodes stay around 120–132 with +27px below-curve label clearance so the bus pin never covers stop names
    const y = isTerminus
      ? 104
      : i % 2 === 0
        ? i % 4 === 0
          ? 130
          : 118
        : i % 4 === 1
          ? 76
          : 88;

    const isUpper = !isTerminus && i % 2 === 1;
    const isInterchange = Boolean(stop.metroInterchange);
    const isBypassed = Boolean(stop.isBypassed);

    return {
      id: stop.id,
      globalIdx: i,
      name: truncateLabel(stop.shortName || stop.name, 18),
      subtitle:
        typeof stop.metroInterchange === 'object'
          ? truncateLabel(stop.metroInterchange.stationName, 20)
          : isTerminus
            ? 'Campus Terminus'
            : morningShift
              ? stop.scheduledMorningTime
              : stop.scheduledEveningTime,
      x,
      y,
      isUpper,
      isInterchange,
      isTerminus,
      isBypassed,
    };
  });

  // Compute smooth cubic Bézier segments connecting consecutive stations
  const bezierSegments: CubicSeg[] = [];
  for (let i = 0; i < metroStations.length - 1; i++) {
    bezierSegments.push(buildSegmentBezier(metroStations[i], metroStations[i + 1]));
  }

  const fullTrackPathD =
    metroStations.length > 0
      ? [
          `M ${metroStations[0].x} ${metroStations[0].y}`,
          ...bezierSegments.map(
            (s) =>
              `C ${s.cp1.x.toFixed(1)} ${s.cp1.y.toFixed(1)}, ${s.cp2.x.toFixed(1)} ${s.cp2.y.toFixed(1)}, ${s.p3.x.toFixed(1)} ${s.p3.y.toFixed(1)}`
          ),
        ].join(' ')
      : '';

  const localSegIdx = Math.min(
    Math.max(projection.segmentIndex, 0),
    Math.max(metroStations.length - 1, 0)
  );
  const segProg =
    localSegIdx < bezierSegments.length ? projection.segmentProgress : 1;

  // Evaluate exact bus point on the curved Bézier segment at t = segProg
  const busPt: Pt = (() => {
    if (metroStations.length === 0) return { x: viewWidth / 2, y: viewHeight / 2 };
    if (localSegIdx < bezierSegments.length) {
      return evalCubicBezier(bezierSegments[localSegIdx], segProg);
    }
    const last = metroStations[metroStations.length - 1];
    return { x: last.x, y: last.y };
  })();

  // Build exact curved passed track path from start of route up to (busPt.x, busPt.y)
  const passedTrackPathD = (() => {
    if (metroStations.length === 0) return '';
    const parts: string[] = [`M ${metroStations[0].x} ${metroStations[0].y}`];
    for (let i = 0; i < localSegIdx && i < bezierSegments.length; i++) {
      const s = bezierSegments[i];
      parts.push(
        `C ${s.cp1.x.toFixed(1)} ${s.cp1.y.toFixed(1)}, ${s.cp2.x.toFixed(1)} ${s.cp2.y.toFixed(1)}, ${s.p3.x.toFixed(1)} ${s.p3.y.toFixed(1)}`
      );
    }
    if (localSegIdx < bezierSegments.length && segProg > 0.005) {
      const partial = splitCubicPrefix(bezierSegments[localSegIdx], segProg);
      parts.push(
        `C ${partial.cp1.x.toFixed(1)} ${partial.cp1.y.toFixed(1)}, ${partial.cp2.x.toFixed(1)} ${partial.cp2.y.toFixed(1)}, ${partial.p3.x.toFixed(1)} ${partial.p3.y.toFixed(1)}`
      );
    }
    return parts.join(' ');
  })();

  // Clamp bus pin icon and speed callout inside SVG safe bounds
  const busX = Math.max(18, Math.min(viewWidth - 18, busPt.x));
  const busY = Math.max(36, Math.min(viewHeight - 28, busPt.y));
  const pillCenterX = Math.max(38, Math.min(viewWidth - 38, busPt.x));
  const pillY = Math.max(15, busY - 26);

  // Measure horizontal overflow dynamically for responsive scroll hint visibility
  useEffect(() => {
    const checkOverflow = () => {
      const el = scrollContainerRef.current;
      if (!el) return;
      setHasOverflow(el.scrollWidth > el.clientWidth + 4);
    };
    checkOverflow();
    if (typeof ResizeObserver !== 'undefined' && scrollContainerRef.current) {
      const ro = new ResizeObserver(checkOverflow);
      ro.observe(scrollContainerRef.current);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', checkOverflow);
    return () => window.removeEventListener('resize', checkOverflow);
  }, [stops.length, viewWidth]);

  // Keep latest busX/viewWidth in refs so auto-centering fires cleanly on mount, route change, and stop changes
  // without snapping back if the user has manually scrolled within the last 4 seconds
  const scrollTargetRef = useRef({ busX, viewWidth });
  scrollTargetRef.current = { busX, viewWidth };

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const routeChanged = lastRouteIdRef.current !== activeBus.routeId;
    if (routeChanged) {
      lastRouteIdRef.current = activeBus.routeId;
      userScrolledAtRef.current = 0;
    }

    const recentlyScrolledByUser =
      didInitialCenterRef.current && Date.now() - userScrolledAtRef.current < 4000;
    if (recentlyScrolledByUser) return;

    let clearTimer: number | undefined;
    const rafId = window.requestAnimationFrame(() => {
      const el = scrollContainerRef.current;
      if (!el) return;
      const { busX: currentBusX, viewWidth: currentSvgWidth } = scrollTargetRef.current;
      if (el.scrollWidth <= el.clientWidth + 4 || currentSvgWidth <= 0) {
        didInitialCenterRef.current = true;
        return;
      }
      const targetPx = (currentBusX / currentSvgWidth) * el.scrollWidth - el.clientWidth / 2;
      const clampedLeft = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, targetPx));
      isProgrammaticScrollRef.current = true;
      el.scrollTo({
        left: clampedLeft,
        behavior: didInitialCenterRef.current ? 'smooth' : 'auto',
      });
      didInitialCenterRef.current = true;
      clearTimer = window.setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 750);
    });

    return () => {
      window.cancelAnimationFrame(rafId);
      if (clearTimer !== undefined) window.clearTimeout(clearTimer);
    };
  }, [activeBus.routeId, activeBus.currentStopIndex, projection.segmentIndex, stops.length]);

  const markUserInteraction = () => {
    if (!isProgrammaticScrollRef.current) {
      userScrolledAtRef.current = Date.now();
    }
  };

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

      {/* Unified Curved Scrollable Metro-Style SVG Schematic (Both Home Compact & Full Views) */}
      <div
        className={`bg-[#F7F9FF]/75 dark:bg-[#161B26] ${
          compact ? 'px-2 py-2' : 'px-2.5 py-2.5 sm:p-3.5'
        }`}
      >
        {(hasOverflow || stops.length > 5) && (
          <div className={`mb-1 flex items-center justify-center ${hasOverflow ? '' : 'sm:hidden'}`}>
            <span className="rounded-full bg-indigo-50/90 px-2.5 py-0.5 text-[10px] font-bold text-[#4F46E5] dark:bg-indigo-950/60 dark:text-cyan-300">
              ← Swipe / Scroll route →
            </span>
          </div>
        )}

        <div
          ref={scrollContainerRef}
          onScroll={markUserInteraction}
          onPointerDown={markUserInteraction}
          onTouchStart={markUserInteraction}
          className="w-full overflow-x-auto overscroll-x-contain touch-pan-x pb-1"
        >
          {stops.length === 0 ? (
            <p className="py-6 text-center text-xs italic text-slate-500 dark:text-slate-400">
              No corridor stops configured for this route.
            </p>
          ) : (
            <svg
              viewBox={`0 0 ${viewWidth} ${viewHeight}`}
              className={`w-full select-none ${compact ? 'max-h-[178px]' : ''}`}
              style={{ minWidth: `${svgMinWidthPx}px` }}
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#4F46E5" />
                  <stop offset="100%" stopColor="#06B6D4" />
                </linearGradient>
              </defs>

              {/* Outer Curved Track Backing */}
              {fullTrackPathD && (
                <path
                  d={fullTrackPathD}
                  stroke="#E2E8F0"
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="dark:stroke-[#374151]"
                />
              )}

              {/* Remaining Curved Corridor Track (Muted Slate) */}
              {fullTrackPathD && (
                <path
                  d={fullTrackPathD}
                  stroke="#94A3B8"
                  strokeOpacity="0.45"
                  strokeWidth="6.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="dark:stroke-[#64748B]"
                />
              )}

              {/* Passed Curved Track Up To Live GPS Position (Indigo -> Cyan Gradient) */}
              {passedTrackPathD && (
                <path
                  d={passedTrackPathD}
                  stroke={`url(#${gradientId})`}
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="transition-all duration-700 ease-out"
                />
              )}

              {/* Flyover Bypass Arc Indicator */}
              {activeBus.flyoverBypassActive && metroStations.length >= 3 && (
                <path
                  d={`M ${metroStations[0].x} ${metroStations[0].y - 14} Q ${(metroStations[0].x + metroStations[Math.min(2, metroStations.length - 1)].x) / 2} 18 ${metroStations[Math.min(2, metroStations.length - 1)].x} ${metroStations[Math.min(2, metroStations.length - 1)].y - 14}`}
                  stroke="#4F46E5"
                  strokeWidth="3"
                  strokeDasharray="4 4"
                  fill="none"
                />
              )}

              {/* Station Nodes & Alternating Labels (+8px lower label clearance against bus pin) */}
              {metroStations.map((st) => {
                const isPassed =
                  st.globalIdx < projection.segmentIndex ||
                  (st.globalIdx === projection.segmentIndex && projection.segmentProgress > 0.08);
                const isCurrent = st.globalIdx === projection.segmentIndex;
                const isHighlighted = st.id === targetHighlightStopId;
                const isBypassed = st.isBypassed;

                const nameY = st.isUpper ? st.y - 16 : st.y + 27;
                const subY = st.isUpper ? st.y - 27 : st.y + 38;
                const tagY = st.isUpper ? st.y - 40 : st.y + 44;

                return (
                  <g key={st.id} opacity={isBypassed ? 0.45 : 1}>
                    {st.isTerminus ? (
                      <g transform={`translate(${st.x}, ${st.y})`}>
                        <line
                          x1="0"
                          y1="-12"
                          x2="0"
                          y2="12"
                          stroke="#4F46E5"
                          strokeWidth="4"
                          className="dark:stroke-[#818CF8]"
                        />
                        <rect
                          x="-6"
                          y="-6"
                          width="12"
                          height="12"
                          rx="3"
                          fill="#4F46E5"
                          stroke="#FFFFFF"
                          strokeWidth="2.5"
                          className="dark:fill-[#818CF8]"
                        />
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
                          r="3.8"
                          fill={isBypassed ? '#9CA3AF' : isCurrent ? '#06B6D4' : isPassed ? '#4F46E5' : '#94A3B8'}
                          className="dark:fill-[#38BDF8]"
                        />
                      </g>
                    ) : (
                      <circle
                        cx={st.x}
                        cy={st.y}
                        r="6"
                        fill="#FFFFFF"
                        stroke={isBypassed ? '#9CA3AF' : isCurrent ? '#06B6D4' : isPassed ? '#4F46E5' : '#64748B'}
                        strokeWidth="2.5"
                        strokeDasharray={isBypassed ? '2 2' : undefined}
                        className="dark:fill-[#1E2430]"
                      />
                    )}

                    {/* YOUR STOP Highlight Halo & Pill */}
                    {isHighlighted && !isBypassed && (
                      <g>
                        <circle
                          cx={st.x}
                          cy={st.y}
                          r="14"
                          fill="none"
                          stroke="#E65100"
                          strokeWidth="2"
                          strokeDasharray="3 3"
                        />
                        <g transform={`translate(${Math.max(28, Math.min(viewWidth - 28, st.x))}, ${st.isUpper ? Math.max(12, tagY) : Math.min(viewHeight - 14, tagY + 4)})`}>
                          <rect x="-25" y="-5" width="50" height="13" rx="4" fill="#E65100" />
                          <text
                            x="0"
                            y="4"
                            fill="#FFFFFF"
                            fontSize="7.5"
                            fontWeight="800"
                            textAnchor="middle"
                            fontFamily="system-ui"
                          >
                            YOUR STOP
                          </text>
                        </g>
                      </g>
                    )}

                    {/* BYPASSED Badge */}
                    {isBypassed && (
                      <g transform={`translate(${Math.max(24, Math.min(viewWidth - 24, st.x))}, ${st.isUpper ? Math.max(12, tagY) : Math.min(viewHeight - 14, tagY + 4)})`}>
                        <rect x="-21" y="-5" width="42" height="11" rx="3" fill="#6B7280" opacity="0.92" />
                        <text
                          x="0"
                          y="3"
                          fill="#FFFFFF"
                          fontSize="6.5"
                          fontWeight="800"
                          textAnchor="middle"
                          fontFamily="system-ui"
                        >
                          BYPASSED
                        </text>
                      </g>
                    )}

                    {/* Stop Name */}
                    <text
                      x={Math.max(34, Math.min(viewWidth - 34, st.x))}
                      y={nameY}
                      textAnchor="middle"
                      fill="#111827"
                      fontSize="10"
                      fontWeight="800"
                      fontFamily="system-ui"
                      className={isBypassed ? 'line-through fill-slate-400 dark:fill-slate-500' : 'dark:fill-white'}
                    >
                      {st.name}
                    </text>

                    {/* Scheduled Time / Metro Subtitle */}
                    <text
                      x={Math.max(34, Math.min(viewWidth - 34, st.x))}
                      y={subY}
                      textAnchor="middle"
                      fill="#64748B"
                      fontSize="7.8"
                      fontWeight="600"
                      fontFamily="system-ui"
                      className="dark:fill-[#9CA3AF]"
                    >
                      {st.subtitle}
                    </text>

                    {/* Metro Tag when not covered by YOUR STOP or BYPASSED badge */}
                    {st.isInterchange && !isBypassed && !isHighlighted && (
                      <g transform={`translate(${Math.max(20, Math.min(viewWidth - 20, st.x))}, ${st.isUpper ? Math.max(11, tagY) : Math.min(viewHeight - 12, tagY + 3)})`}>
                        <rect x="-15" y="-4" width="30" height="9.5" rx="2.5" fill="#E0F2FE" className="dark:fill-sky-950" />
                        <text
                          x="0"
                          y="3"
                          textAnchor="middle"
                          fill="#0369A1"
                          fontSize="6.5"
                          fontWeight="800"
                          fontFamily="system-ui"
                          className="dark:fill-sky-300"
                        >
                          METRO
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

              {/* Clamped Speed Callout Pill Above Live Bus Pin */}
              <g
                className="transition-all duration-700 ease-out"
                style={{ transform: `translate(${pillCenterX.toFixed(1)}px, ${pillY.toFixed(1)}px)` }}
              >
                <rect
                  x="-36"
                  y="-12"
                  width="72"
                  height="16"
                  rx="8"
                  fill={`url(#${gradientId})`}
                  stroke="#FFFFFF"
                  strokeWidth="1.2"
                />
                <text
                  x="0"
                  y="-1.5"
                  fill="#FFFFFF"
                  fontSize="7.5"
                  fontWeight="800"
                  textAnchor="middle"
                  fontFamily="system-ui"
                >
                  {routeShortCode} • {speedRounded} km/h
                </text>
              </g>

              {/* Smoothly Gliding GPS-Projected Bus Pin Strictly On the Curved Track */}
              <g
                className="transition-all duration-700 ease-out"
                style={{ transform: `translate(${busX.toFixed(1)}px, ${busY.toFixed(1)}px)` }}
              >
                <circle cx="0" cy="0" r="15" fill="#4F46E5" opacity="0.24" className="animate-ping" />
                <circle cx="0" cy="0" r="11" fill={`url(#${gradientId})`} stroke="#FFFFFF" strokeWidth="2.2" />
                <rect x="-5" y="-3.5" width="10" height="7" rx="1.5" fill="white" />
                <circle cx="-2" cy="1.5" r="0.8" fill="#4F46E5" />
                <circle cx="2" cy="1.5" r="0.8" fill="#4F46E5" />
                <rect x="-3.5" y="-2.5" width="7" height="2" rx="0.5" fill="#4F46E5" />
              </g>
            </svg>
          )}
        </div>
      </div>

      {/* Bottom External HUD Bar (Corridor Progress & Free Multi-Stop Google Maps Route) */}
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
          href={googleMapsRouteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-700 shadow-2xs transition hover:border-[#4F46E5] hover:text-[#4F46E5] dark:border-[#2E3646] dark:bg-[#1E2430] dark:text-slate-200 dark:hover:text-cyan-300"
        >
          <Navigation className="h-3 w-3 text-[#4F46E5] dark:text-cyan-300" />
          <span>Open Full Route in Google Maps</span>
          <ExternalLink className="h-2.5 w-2.5 opacity-70" />
        </a>
      </div>
    </div>
  );
};

export const MetroSchematicMap = React.memo(MetroSchematicMapComponent);
