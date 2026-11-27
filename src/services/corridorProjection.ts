import type { RouteStop } from '../types/transit.ts';

export interface GpsProjectionResult {
  segmentIndex: number;
  segmentProgress: number;
  offRouteMeters: number;
  isGpsProjected: boolean;
  nearestStopIndex: number;
}

/**
 * Compute great-circle Haversine distance in meters between two lat/lng coordinates.
 */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isValidGpsCoord(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return false;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/**
 * Orthogonally project live GPS coordinates onto consecutive route stop segments
 * using local flat-earth equirectangular scaling and clamped t in [0, 1].
 */
export function projectGpsOntoStops(
  lat: number,
  lng: number,
  stops: RouteStop[],
  fallbackIndex = 0,
  fallbackProgress = 0
): GpsProjectionResult {
  if (!Array.isArray(stops) || stops.length === 0) {
    return {
      segmentIndex: 0,
      segmentProgress: 0,
      offRouteMeters: 0,
      isGpsProjected: false,
      nearestStopIndex: 0,
    };
  }

  const maxIdx = stops.length - 1;
  const safeFallbackIdx = Math.min(Math.max(Math.round(fallbackIndex || 0), 0), maxIdx);
  const safeFallbackProg = Number.isFinite(fallbackProgress)
    ? Math.max(0, Math.min(1, fallbackProgress))
    : 0;

  if (!isValidGpsCoord(lat, lng)) {
    return {
      segmentIndex: safeFallbackIdx,
      segmentProgress: safeFallbackProg,
      offRouteMeters: 0,
      isGpsProjected: false,
      nearestStopIndex: safeFallbackIdx,
    };
  }

  let nearestStopIndex = 0;
  let nearestStopDist = Infinity;
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    if (!s || !isValidGpsCoord(s.lat, s.lng)) continue;
    const dist = haversineMeters(lat, lng, s.lat, s.lng);
    if (dist < nearestStopDist) {
      nearestStopDist = dist;
      nearestStopIndex = i;
    }
  }

  if (stops.length === 1) {
    return {
      segmentIndex: 0,
      segmentProgress: 0,
      offRouteMeters: Number.isFinite(nearestStopDist) ? Math.round(nearestStopDist) : 0,
      isGpsProjected: true,
      nearestStopIndex: 0,
    };
  }

  let bestIndex = safeFallbackIdx;
  let bestT = safeFallbackProg;
  let minDistMeters = Infinity;

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (!a || !b || !isValidGpsCoord(a.lat, a.lng) || !isValidGpsCoord(b.lat, b.lng)) {
      continue;
    }

    const latMidRad = (((a.lat + b.lat) / 2) * Math.PI) / 180;
    const cosLat = Math.cos(latMidRad);

    const ax = a.lng * cosLat;
    const ay = a.lat;
    const bx = b.lng * cosLat;
    const by = b.lat;
    const px = lng * cosLat;
    const py = lat;

    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    const rawT = lenSq > 1e-14 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
    const t = Math.max(0, Math.min(1, rawT));

    const projLat = a.lat + (b.lat - a.lat) * t;
    const projLng = a.lng + (b.lng - a.lng) * t;
    const distMeters = haversineMeters(lat, lng, projLat, projLng);

    if (distMeters < minDistMeters) {
      minDistMeters = distMeters;
      bestIndex = i;
      bestT = t;
    }
  }

  if (!Number.isFinite(minDistMeters)) {
    return {
      segmentIndex: safeFallbackIdx,
      segmentProgress: safeFallbackProg,
      offRouteMeters: 0,
      isGpsProjected: false,
      nearestStopIndex: safeFallbackIdx,
    };
  }

  return {
    segmentIndex: bestIndex,
    segmentProgress: Number(bestT.toFixed(4)),
    offRouteMeters: Math.round(minDistMeters),
    isGpsProjected: true,
    nearestStopIndex,
  };
}
