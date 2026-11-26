import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { ExternalLink, Navigation } from 'lucide-react';
import {
  Circle,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from 'react-leaflet';
import { SREENIDHI_CAMPUS } from '../../data/sreenidhiData';
import type { BusVehicle, RouteStop } from '../../types/transit';
import { osrmRoutingService } from '../../services/osrmRoutingService';
import { useCommuteSimulation } from '../../context/useCommuteSimulation';

interface HybridTransitMapProps {
  buses: BusVehicle[];
  focusedBus: BusVehicle;
  useGoogleMaps?: boolean;
  showAllFleet?: boolean;
  highlightStopId?: string;
  heightClass?: string;
}

const MapCameraController: React.FC<{
  focusedBus: BusVehicle;
  roadCoordinates: [number, number][];
  followBus: boolean;
  setFollowBus: React.Dispatch<React.SetStateAction<boolean>>;
}> = ({ focusedBus, roadCoordinates, followBus, setFollowBus }) => {
  const map = useMap();

  useEffect(() => {
    if (followBus) {
      map.panTo([focusedBus.currentLat, focusedBus.currentLng], { animate: true, duration: 0.7 });
    }
  }, [focusedBus.currentLat, focusedBus.currentLng, followBus, map]);

  useEffect(() => {
    const onDragStart = () => setFollowBus(false);
    map.on('dragstart', onDragStart);
    return () => {
      map.off('dragstart', onDragStart);
    };
  }, [map, setFollowBus]);

  const handleRecenter = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setFollowBus(true);
    map.flyTo([focusedBus.currentLat, focusedBus.currentLng], 13, { duration: 0.8 });
  };

  const handleFitCorridor = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setFollowBus(false);
    if (roadCoordinates.length > 1) {
      map.fitBounds(roadCoordinates, { padding: [36, 36], maxZoom: 14 });
    }
  };

  return (
    <div className="leaflet-top leaflet-right pointer-events-none p-3 z-[400]">
      <div className="pointer-events-auto flex flex-col gap-1.5">
        <button
          type="button"
          onClick={handleRecenter}
          title={followBus ? 'Following Bus (Auto-Pan Active)' : 'Recenter on Bus'}
          aria-label="Recenter on Bus"
          className={`tactile-btn flex h-8 w-8 items-center justify-center rounded-xl border shadow-lg backdrop-blur-md transition-all ${
            followBus
              ? 'border-indigo-500/60 bg-indigo-600 text-white shadow-indigo-500/25'
              : 'border-slate-200/90 bg-white/90 text-slate-700 hover:bg-white dark:border-white/15 dark:bg-slate-900/90 dark:text-slate-200 dark:hover:bg-slate-800'
          }`}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" fill={followBus ? 'currentColor' : 'none'} />
            <circle cx="12" cy="12" r="8" />
            <line x1="12" y1="2" x2="12" y2="5" />
            <line x1="12" y1="19" x2="12" y2="22" />
            <line x1="2" y1="12" x2="5" y2="12" />
            <line x1="19" y1="12" x2="22" y2="12" />
          </svg>
        </button>
        <button
          type="button"
          onClick={handleFitCorridor}
          title="Fit Entire Corridor"
          aria-label="Fit Entire Corridor"
          className="tactile-btn flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200/90 bg-white/90 text-slate-700 shadow-lg backdrop-blur-md transition-all hover:bg-white dark:border-white/15 dark:bg-slate-900/90 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
      </div>
    </div>
  );
};

function createBusDivIcon(bus: BusVehicle, isFocused: boolean): L.DivIcon {
  const isBreakdown = bus.status === 'BREAKDOWN_RESCUE_ACTIVE';
  const isRerouted = bus.status === 'REROUTED_SKIP_AREA' || bus.flyoverBypassActive;
  const isCrowdSourced = bus.telemetrySource === 'CROWD_SOURCED_STUDENTS';

  const gradient = isBreakdown
    ? 'linear-gradient(135deg, #dc2626, #ef4444)'
    : isRerouted
      ? 'linear-gradient(135deg, #059669, #10b981)'
      : isCrowdSourced
        ? 'linear-gradient(135deg, #d97706, #f59e0b)'
        : 'linear-gradient(135deg, #0d9488, #2563eb)';

  const pulseColor = isBreakdown
    ? 'rgba(239, 68, 68, 0.55)'
    : isRerouted
      ? 'rgba(16, 185, 129, 0.55)'
      : isCrowdSourced
        ? 'rgba(245, 158, 11, 0.55)'
        : 'rgba(56, 189, 248, 0.65)';

  const routeShort = bus.routeNumber.replace('Route ', 'R');
  const speedDisplay = `${Math.round(bus.speedKmh)} km/h`;
  const labelText = isFocused ? `${routeShort} · ${speedDisplay}` : routeShort;

  const busSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;flex-shrink:0;">
    <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10H4V6z"/>
    <path d="M18 16H6"/>
    <path d="M4 10h16"/>
    <circle cx="7.5" cy="18.5" r="1.5" fill="#ffffff"/>
    <circle cx="16.5" cy="18.5" r="1.5" fill="#ffffff"/>
  </svg>`;

  const haloHtml = isFocused
    ? `<div class="animate-bus-pulse" style="position:absolute;inset:-6px;border-radius:9999px;background:${pulseColor};pointer-events:none;z-index:-1;"></div>`
    : '';

  const pillHtml = `<div style="position:relative;display:inline-flex;align-items:center;gap:5px;background:${gradient};color:#ffffff;padding:4px 9px;border-radius:9999px;font-family:'JetBrains Mono',monospace,sans-serif;font-weight:700;font-size:11px;line-height:1;border:2px solid #ffffff;box-shadow:0 4px 14px rgba(0,0,0,0.38);white-space:nowrap;transform:${isFocused ? 'scale(1.06)' : 'scale(0.92)'};">
    ${haloHtml}
    ${busSvg}
    <span style="letter-spacing:-0.02em;">${labelText}</span>
  </div>`;

  const width = isFocused ? 112 : 68;
  const height = 30;

  return L.divIcon({
    className: 'suh-bus-marker',
    html: pillHtml,
    iconSize: [width, height],
    iconAnchor: [width / 2, height / 2],
  });
}

function createStopDivIcon(
  stop: RouteStop,
  isCurrent: boolean,
  isHighlighted: boolean,
  isPassed: boolean,
  isDark: boolean
): L.DivIcon {
  const isCampus = stop.areaClusterId === 'cluster-campus';
  const seq = stop.sequence;

  let badgeContent = '';
  let badgeStyle = '';
  let tagAbove = '';
  let tagBelow = '';
  let size = 18;

  if (stop.isBypassed) {
    size = 18;
    badgeStyle = `width:18px;height:18px;border-radius:9999px;border:2px dashed #94a3b8;background:rgba(148,163,184,0.15);color:#94a3b8;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;opacity:0.45;`;
    badgeContent = `${seq}`;
  } else if (isCampus) {
    size = 24;
    badgeStyle = `width:24px;height:24px;border-radius:9999px;background:#e53c2e;border:2.5px solid #ffffff;box-shadow:0 2px 8px rgba(229,60,46,0.5);display:flex;align-items:center;justify-content:center;`;
    badgeContent = `<span style="width:7px;height:7px;border-radius:9999px;background:#ffffff;"></span>`;
    tagBelow = `<span style="position:absolute;top:calc(100% + 1px);font-size:9px;font-weight:800;letter-spacing:0.04em;color:${isDark ? '#f87171' : '#dc2626'};background:${isDark ? 'rgba(15,23,42,0.85)' : 'rgba(255,255,255,0.9)'};padding:0.5px 4px;border-radius:4px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.25);">SUH</span>`;
  } else if (isHighlighted) {
    size = 22;
    badgeStyle = `width:22px;height:22px;border-radius:9999px;background:#f59e0b;color:#ffffff;border:2px solid #ffffff;box-shadow:0 0 12px rgba(245,158,11,0.65),0 2px 6px rgba(0,0,0,0.3);font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;`;
    badgeContent = `${seq}`;
    tagAbove = `<span style="position:absolute;bottom:calc(100% + 2px);font-size:8.5px;font-weight:800;letter-spacing:0.04em;background:#f59e0b;color:#000000;padding:1px 5px;border-radius:9999px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.35);line-height:1.2;">YOUR STOP</span>`;
  } else if (isCurrent) {
    size = 20;
    badgeStyle = `width:20px;height:20px;border-radius:9999px;background:#10b981;color:#ffffff;border:2px solid #ffffff;box-shadow:0 0 0 3px rgba(16,185,129,0.45),0 2px 6px rgba(0,0,0,0.3);font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;`;
    badgeContent = `${seq}`;
  } else if (isPassed) {
    size = 16;
    badgeStyle = `width:16px;height:16px;border-radius:9999px;background:#475569;color:#94a3b8;border:1.5px solid rgba(255,255,255,0.6);box-shadow:0 1px 4px rgba(0,0,0,0.25);font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;opacity:0.7;`;
    badgeContent = `${seq}`;
  } else {
    size = 18;
    const bg = isDark ? '#1e293b' : '#312e81';
    const border = isDark ? '2px solid #38bdf8' : '2px solid #ffffff';
    badgeStyle = `width:18px;height:18px;border-radius:9999px;background:${bg};color:#ffffff;border:${border};box-shadow:0 2px 6px rgba(0,0,0,0.3);font-size:9.5px;font-weight:700;display:flex;align-items:center;justify-content:center;`;
    badgeContent = `${seq}`;
  }

  const containerHtml = `<div style="position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;width:${size}px;height:${size}px;">
    ${tagAbove}
    <div style="${badgeStyle}">
      ${badgeContent}
    </div>
    ${tagBelow}
  </div>`;

  return L.divIcon({
    className: 'suh-stop-marker',
    html: containerHtml,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

const GoogleMapsCanvas: React.FC<{
  buses: BusVehicle[];
  focusedBus: BusVehicle;
  showAllFleet: boolean;
}> = ({ buses, focusedBus, showAllFleet }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const busMarkersRef = useRef<Map<string, any>>(new Map());
  const stopMarkersRef = useRef<any[]>([]);
  const polylinesRef = useRef<any[]>([]);

  // 1. One-time Map Initialization
  useEffect(() => {
    const gm = window.google?.maps;
    if (!gm || !containerRef.current || mapRef.current) return;

    const map = new gm.Map(containerRef.current, {
      center: { lat: focusedBus.currentLat, lng: focusedBus.currentLng },
      zoom: showAllFleet ? 11 : 12,
      mapTypeControl: false,
      streetViewControl: false,
    });

    const trafficLayer = new gm.TrafficLayer();
    trafficLayer.setMap(map);

    mapRef.current = map;

    return () => {
      busMarkersRef.current.forEach((m) => m.setMap(null));
      busMarkersRef.current.clear();
      stopMarkersRef.current.forEach((m) => m.setMap(null));
      stopMarkersRef.current = [];
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
      mapRef.current = null;
    };
  }, []);

  // 2. Incremental Route & Stops Update (Runs only when route changes)
  useEffect(() => {
    const gm = window.google?.maps;
    const map = mapRef.current;
    if (!gm || !map) return;

    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];
    stopMarkersRef.current.forEach((m) => m.setMap(null));
    stopMarkersRef.current = [];

    const activePath = focusedBus.stops.map((s) => ({ lat: s.lat, lng: s.lng }));
    const mainLine = new gm.Polyline({
      path: activePath,
      strokeColor: '#4f46e5',
      strokeOpacity: focusedBus.shortcutPath ? 0.35 : 0.9,
      strokeWeight: 4,
      map,
    });
    polylinesRef.current.push(mainLine);

    if (focusedBus.shortcutPath && focusedBus.shortcutPath.length > 1) {
      const shortcutLine = new gm.Polyline({
        path: focusedBus.shortcutPath.map(([lat, lng]) => ({ lat, lng })),
        strokeColor: '#10b981',
        strokeOpacity: 0.95,
        strokeWeight: 5,
        map,
      });
      polylinesRef.current.push(shortcutLine);
    }

    focusedBus.stops.forEach((s) => {
      const stopMarker = new gm.Marker({
        position: { lat: s.lat, lng: s.lng },
        title: `${s.sequence}. ${s.name}${s.isBypassed ? ' (SKIPPED)' : ''}`,
        map,
      });
      stopMarkersRef.current.push(stopMarker);
    });
  }, [focusedBus.routeId, focusedBus.stops, focusedBus.shortcutPath]);

  // 3. Incremental Bus GPS Update (Runs on 3-second GPS ticks without destroying map!)
  useEffect(() => {
    const gm = window.google?.maps;
    const map = mapRef.current;
    if (!gm || !map) return;

    const renderedBuses = showAllFleet ? buses : [focusedBus];
    const activeRouteIds = new Set(renderedBuses.map((b) => b.routeId));

    busMarkersRef.current.forEach((marker, routeId) => {
      if (!activeRouteIds.has(routeId)) {
        marker.setMap(null);
        busMarkersRef.current.delete(routeId);
      }
    });

    renderedBuses.forEach((bus) => {
      const existing = busMarkersRef.current.get(bus.routeId);
      const position = { lat: bus.currentLat, lng: bus.currentLng };
      const title = `${bus.routeNumber} (${bus.speedKmh} km/h)`;

      if (existing) {
        existing.setPosition(position);
        existing.setTitle(title);
      } else {
        const marker = new gm.Marker({
          position,
          title,
          label: {
            text: bus.routeNumber.replace('Route ', 'R'),
            color: '#ffffff',
            fontWeight: 'bold',
          },
          map,
        });
        busMarkersRef.current.set(bus.routeId, marker);
      }
    });
  }, [buses, focusedBus, showAllFleet]);

  return <div ref={containerRef} className="h-full w-full" />;
};

const HybridTransitMapComponent: React.FC<HybridTransitMapProps> = ({
  buses,
  focusedBus,
  useGoogleMaps,
  showAllFleet = false,
  highlightStopId,
  heightClass = 'h-72 sm:h-80',
}) => {
  const { isDark } = useCommuteSimulation();
  const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
  const renderedBuses = showAllFleet ? buses : [focusedBus];
  const stopWaypoints = useRef<[number, number][]>([]);
  stopWaypoints.current = focusedBus.stops.map((s) => [s.lat, s.lng]);

  const [followBus, setFollowBus] = useState(true);
  const [roadCoordinates, setRoadCoordinates] = useState<[number, number][]>(() =>
    focusedBus.stops.map((s) => [s.lat, s.lng])
  );
  const [routingSource, setRoutingSource] = useState<'OSRM' | 'FALLBACK'>('FALLBACK');

  const nextStop =
    focusedBus.stops[focusedBus.currentStopIndex + 1] ||
    focusedBus.stops[focusedBus.currentStopIndex] ||
    null;

  const targetStop =
    focusedBus.stops.find((s) => s.id === highlightStopId) ||
    focusedBus.stops[focusedBus.stops.length - 1];
  const googleMapsTrafficUrl = targetStop
    ? `https://www.google.com/maps/dir/?api=1&origin=${focusedBus.currentLat},${focusedBus.currentLng}&destination=${targetStop.lat},${targetStop.lng}&travelmode=driving`
    : `https://www.google.com/maps/search/?api=1&query=${focusedBus.currentLat},${focusedBus.currentLng}`;

  useEffect(() => {
    let active = true;
    const fetchRoadPath = async () => {
      const activeStops = focusedBus.stops.filter((s) => !s.isBypassed);
      const waypoints: [number, number][] = activeStops.map((s) => [s.lat, s.lng]);
      if (waypoints.length < 2) return;

      const res = await osrmRoutingService.getRouteGeometry(waypoints, {
        useFlyoverBypass: focusedBus.flyoverBypassActive,
        skippedClusters: focusedBus.skippedClusterIds,
        routeId: focusedBus.routeId,
      });

      if (active && res.coordinates.length > 1) {
        setRoadCoordinates(res.coordinates);
        setRoutingSource(res.source === 'FALLBACK_INTERPOLATION' ? 'FALLBACK' : 'OSRM');
      }
    };

    void fetchRoadPath();
    return () => {
      active = false;
    };
  }, [focusedBus.routeId, focusedBus.flyoverBypassActive, focusedBus.skippedClusterIds?.length]);

  return (
    <div className={`relative w-full overflow-hidden rounded-2xl border border-slate-200/80 shadow-inner dark:border-white/[0.1] ${heightClass}`}>
      {useGoogleMaps && window.google?.maps ? (
        <GoogleMapsCanvas
          buses={buses}
          focusedBus={focusedBus}
          showAllFleet={showAllFleet}
        />
      ) : (
        <MapContainer
          center={[focusedBus.currentLat, focusedBus.currentLng]}
          zoom={showAllFleet ? 11 : 12}
          className="h-full w-full"
          scrollWheelZoom={true}
        >
          <TileLayer
            key={isDark ? 'carto-dark' : 'carto-light'}
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url={
              isDark
                ? `${apiBase}/api/tiles/dark_all/{z}/{x}/{y}`
                : `${apiBase}/api/tiles/voyager/{z}/{x}/{y}`
            }
            maxZoom={19}
          />
          <MapCameraController
            focusedBus={focusedBus}
            roadCoordinates={roadCoordinates}
            followBus={followBus}
            setFollowBus={setFollowBus}
          />

          {/* Dual-Layer Glowing OSRM Corridor Polyline */}
          <Polyline
            positions={roadCoordinates}
            pathOptions={{
              color: isDark ? '#38bdf8' : '#4f46e5',
              weight: 11,
              opacity: focusedBus.shortcutPath ? 0.12 : 0.22,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
          <Polyline
            positions={roadCoordinates}
            pathOptions={{
              color: isDark ? '#38bdf8' : '#4f46e5',
              weight: 4,
              opacity: focusedBus.shortcutPath ? 0.35 : 0.95,
              dashArray: focusedBus.shortcutPath ? '6 8' : undefined,
            }}
          />

          {/* Shortcut Bypass Polyline when area is skipped */}
          {focusedBus.shortcutPath && focusedBus.shortcutPath.length > 1 && (
            <>
              <Polyline
                positions={focusedBus.shortcutPath}
                pathOptions={{
                  color: '#10b981',
                  weight: 12,
                  opacity: 0.24,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
              <Polyline
                positions={focusedBus.shortcutPath}
                pathOptions={{
                  color: '#10b981',
                  weight: 4.5,
                  opacity: 0.98,
                }}
              />
            </>
          )}

          {/* Stops & Geofences */}
          {focusedBus.stops.map((stop, idx) => {
            const isCurrent = idx === focusedBus.currentStopIndex;
            const isHighlighted = stop.id === highlightStopId;
            const isPassed = idx < focusedBus.currentStopIndex;
            return (
              <React.Fragment key={stop.id}>
                <Circle
                  center={[stop.lat, stop.lng]}
                  radius={stop.geofenceRadiusMeters}
                  pathOptions={{
                    color: stop.isBypassed
                      ? '#64748b'
                      : isHighlighted
                        ? '#f59e0b'
                        : '#4f46e5',
                    fillOpacity: isHighlighted ? 0.2 : 0.08,
                    weight: 1,
                  }}
                />
                <Marker
                  position={[stop.lat, stop.lng]}
                  icon={createStopDivIcon(stop, isCurrent, isHighlighted, isPassed, isDark)}
                >
                  <Popup>
                    <div className="min-w-[175px] text-xs">
                      <p className="font-bold text-slate-900 dark:text-slate-100">
                        {stop.sequence}. {stop.name}
                      </p>
                      <p className="text-slate-600 dark:text-slate-400">{stop.areaClusterName}</p>
                      <p className="mt-1 text-slate-700 dark:text-slate-300">
                        AM: {stop.scheduledMorningTime} • PM: {stop.scheduledEveningTime}
                      </p>
                      {stop.metroInterchange && (
                        <p className="mt-1 font-semibold text-indigo-600 dark:text-indigo-400">
                          🚇 {stop.metroInterchange.stationName} ({stop.metroInterchange.line})
                        </p>
                      )}
                      {stop.isBypassed && (
                        <p className="mt-1 font-bold text-emerald-600 dark:text-emerald-400">
                          ✓ SKIPPED BY BYPASS ROUTE
                        </p>
                      )}
                    </div>
                  </Popup>
                </Marker>
              </React.Fragment>
            );
          })}

          {/* Sreenidhi University Campus Beacon */}
          <Circle
            center={[SREENIDHI_CAMPUS.lat, SREENIDHI_CAMPUS.lng]}
            radius={220}
            pathOptions={{ color: '#e53c2e', fillOpacity: 0.16, weight: 1.5 }}
          />

          {/* Live Bus Markers */}
          {renderedBuses.map((bus) => (
            <Marker
              key={bus.routeId}
              position={[bus.currentLat, bus.currentLng]}
              icon={createBusDivIcon(bus, bus.routeId === focusedBus.routeId)}
            >
              <Popup>
                <div className="min-w-[180px] text-xs">
                  <p className="font-bold text-slate-900 dark:text-slate-100">
                    {bus.routeNumber} — {bus.registrationNo}
                  </p>
                  <p className="text-slate-600 dark:text-slate-400">Driver: {bus.driverName}</p>
                  <p className="mt-1 text-slate-700 dark:text-slate-300">
                    Speed: <b className="text-slate-900 dark:text-white">{bus.speedKmh} km/h</b> • Delay: <b className="text-slate-900 dark:text-white">+{bus.trafficDelayMinutes}m</b>
                  </p>
                  <p className="mt-1 font-medium text-indigo-600 dark:text-indigo-400">
                    GPS: {bus.telemetrySource === 'DRIVER_PRIMARY' ? 'Driver Primary' : 'Crowd-Sourced Students'}
                  </p>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      )}

      {/* Top-Left Floating Telemetry Pill */}
      <div className="pointer-events-none absolute top-3 left-14 z-[400] flex max-w-[calc(100%-110px)] items-center gap-1.5 sm:gap-2 truncate rounded-full border border-slate-200/80 bg-white/92 px-2.5 sm:px-3 py-1 shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-slate-900/92 text-[11px] sm:text-xs">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        <span className="font-bold text-slate-800 dark:text-slate-100 shrink-0">
          {focusedBus.routeNumber}
        </span>
        <span className="text-slate-300 dark:text-slate-600 shrink-0">•</span>
        <span className="font-mono font-semibold text-indigo-600 dark:text-cyan-400 shrink-0">
          {Math.round(focusedBus.speedKmh)} km/h
        </span>
        {nextStop && (
          <>
            <span className="text-slate-300 dark:text-slate-600 shrink-0">•</span>
            <span className="truncate text-slate-600 dark:text-slate-300">
              Next: <span className="font-semibold text-slate-900 dark:text-white">{nextStop.shortName || nextStop.name}</span>
            </span>
          </>
        )}
      </div>

      {/* Prismatic Daylight HUD Map Overlay */}
      <div className="pointer-events-none absolute bottom-6 sm:bottom-3 left-3 z-[400] flex max-w-[calc(100%-1.5rem)] sm:max-w-[calc(100%-15rem)] flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200/80 bg-white/92 px-3 py-1 text-[10px] font-bold tracking-wide text-slate-800 shadow-md backdrop-blur-md dark:border-white/15 dark:bg-slate-900/90 dark:text-slate-100">
          <span className="h-1.5 w-1.5 rounded-full bg-[#06B6D4] shadow-[0_0_6px_rgba(6,182,212,0.9)]" />
          {useGoogleMaps && window.google?.maps
            ? 'Google Maps Live Traffic'
            : routingSource === 'OSRM'
              ? 'OSRM Road-Snapped Corridor (₹0)'
              : 'OpenStreetMap / Leaflet Corridor'}
        </span>
        <a
          href={googleMapsTrafficUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Open live Google Maps traffic directions from bus GPS to stop (₹0, no API key required)"
          className="tactile-btn pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-indigo-200/90 bg-white/95 px-3 py-1 text-[10px] font-extrabold tracking-wide text-[#4F46E5] shadow-md backdrop-blur-md transition-all hover:border-[#4F46E5]/60 hover:bg-indigo-50/95 dark:border-cyan-400/35 dark:bg-slate-900/90 dark:text-cyan-200 dark:hover:bg-slate-800"
        >
          <Navigation className="h-3 w-3 shrink-0 text-[#06B6D4]" />
          <span>Google Maps Traffic</span>
          <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-75" />
        </a>
        {focusedBus.shortcutPath && (
          <span className="rounded-full border border-emerald-400/40 bg-emerald-500/90 px-3 py-1 text-[10px] font-bold text-white shadow-[0_0_12px_rgba(16,185,129,0.45)] backdrop-blur-md">
            Bypass Route Active
          </span>
        )}
      </div>
    </div>
  );
};

export const HybridTransitMap = React.memo(HybridTransitMapComponent);
