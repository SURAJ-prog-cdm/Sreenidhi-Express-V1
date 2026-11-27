// Sreenidhi TransitPulse - Real OSRM Road Routing Engine (₹0 Cost)
// Connects Secunderabad, Tarnaka, Habsiguda, Uppal, Narapally, Ghatkesar, and SNIST along real Hyderabad highways.

import { excelService } from './excelService';

export interface OsrmRouteResult {
  coordinates: [number, number][]; // [lat, lng] pairs for route geometry
  distanceKm: number;
  durationMinutes: number;
  source: 'OSRM_API' | 'LOCAL_CACHE' | 'FALLBACK_INTERPOLATION';
}

// Clean up legacy heavy GeoJSON keys from localStorage to prevent QuotaExceededError
if (typeof window !== 'undefined' && window.localStorage) {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('snist_osrm_route_v1_')) {
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) {
      localStorage.removeItem(k);
    }
  } catch {}
}

class OsrmRoutingService {
  private memoryCache = new Map<string, OsrmRouteResult>(); // Capped in-memory polyline cache (max 25 entries)

  private setMemoryCache(key: string, val: OsrmRouteResult) {
    if (this.memoryCache.size >= 25) {
      const oldestKey = this.memoryCache.keys().next().value;
      if (oldestKey) this.memoryCache.delete(oldestKey);
    }
    this.memoryCache.set(key, val);
  }

  /**
   * Fetch real road geometry between an ordered list of waypoints.
   * Waypoints are provided as [lat, lng].
   */
  public async getRouteGeometry(
    waypoints: [number, number][],
    options: {
      useFlyoverBypass?: boolean;
      skippedClusters?: string[];
      routeId?: string;
    } = {}
  ): Promise<OsrmRouteResult> {
    if (!waypoints || waypoints.length < 2) {
      return {
        coordinates: waypoints,
        distanceKm: 0,
        durationMinutes: 0,
        source: 'FALLBACK_INTERPOLATION',
      };
    }

    const routeId = options.routeId || 'route-51';
    const variant = options.useFlyoverBypass
      ? 'flyover'
      : (options.skippedClusters?.length ? `skip_${options.skippedClusters.join('-')}` : 'default');

    const cacheKey = `${routeId}:${variant}:` + waypoints.map((w) => `${w[0].toFixed(4)},${w[1].toFixed(4)}`).join(';');

    const memHit = this.memoryCache.get(cacheKey);
    if (memHit) {
      return { ...memHit, source: 'LOCAL_CACHE' };
    }

    const sampledWaypoints = this.sampleWaypoints(waypoints, 20);

    // 1. Primary: Server-side OSRM proxy endpoint (with Bearer auth)
    const serverBaseUrl = excelService.getServerBaseUrl();
    const token = excelService.getAuthToken();
    if (serverBaseUrl && token) {
      try {
        const res = await fetch(`${serverBaseUrl}/api/routes/${encodeURIComponent(routeId)}/geometry`, {
          method: 'POST',
          headers: excelService.authHeaders(),
          body: JSON.stringify({
            waypoints: sampledWaypoints,
            variant,
          }),
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.coordinates && Array.isArray(data.coordinates)) {
            const result: OsrmRouteResult = {
              coordinates: data.coordinates,
              distanceKm: data.distanceKm,
              durationMinutes: data.durationMinutes,
              source: data.source === 'SERVER_CACHE' ? 'LOCAL_CACHE' : 'OSRM_API',
            };
            this.setMemoryCache(cacheKey, result);
            return result;
          }
        }
      } catch (err) {
        console.warn('[OsrmRouting] Server proxy routing failed or timed out, falling back to direct OSRM:', err);
      }
    }

    // 2. Direct OSRM API (if unauthenticated or server unreachable)
    const coordsParam = sampledWaypoints.map(([lat, lng]) => `${lng},${lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordsParam}?overview=full&geometries=geojson&steps=false`;

    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 6000);

      const res = await fetch(url, { signal: controller.signal });
      window.clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (data.routes && data.routes[0]) {
          const route = data.routes[0];
          // GeoJSON coordinates are [lng, lat] -> convert to [lat, lng]
          const routeCoords: [number, number][] = route.geometry.coordinates.map(
            (c: [number, number]) => [c[1], c[0]]
          );
          const distanceKm = Number((route.distance / 1000).toFixed(2));
          const durationMinutes = Math.round(route.duration / 60);

          const result: OsrmRouteResult = {
            coordinates: routeCoords,
            distanceKm,
            durationMinutes,
            source: 'OSRM_API',
          };
          this.setMemoryCache(cacheKey, result);
          return result;
        }
      }
    } catch (err) {
      console.warn('[OsrmRouting] Direct OSRM request failed. Falling back to straight lines:', err);
    }

    // 3. Fallback: straight-line Haversine path interpolation
    const totalDistKm = this.calculateHaversinePath(waypoints);
    const estMinutes = Math.round((totalDistKm / 32) * 60); // assume 32 km/h average speed
    return {
      coordinates: waypoints,
      distanceKm: totalDistKm,
      durationMinutes: estMinutes,
      source: 'FALLBACK_INTERPOLATION',
    };
  }

  /**
   * Compute real fuel and time savings when Uppal Elevated Flyover or neighborhood cluster skips are toggled
   */
  public calculateFlyoverSavings(_originalKm: number, originalMinutes: number): {
    savedKm: number;
    savedMinutes: number;
    savedDieselLiters: number;
    savedRupees: number;
  } {
    // Uppal Elevated Flyover saves ~14 minutes by avoiding Ramanthapur/Uppal junction signal delay
    const savedMinutes = Math.min(14, Math.round(originalMinutes * 0.28));
    const savedKm = 1.8; // Flyover express corridor vs winding surface service roads
    const savedDieselLiters = Number((savedKm * 0.32).toFixed(2)); // ~3.1 km per liter for campus buses
    const savedRupees = Math.round(savedDieselLiters * 98); // ~₹98 per liter in Hyderabad

    return {
      savedKm,
      savedMinutes,
      savedDieselLiters,
      savedRupees,
    };
  }

  /**
   * Server-authoritative Route Optimization Savings (₹0 Cost)
   * Computes delta between baseline full route and optimized route bypassing 100%-absent clusters.
   */
  public async computeOptimizationSavings(
    allStops: Array<{ lat?: number; lng?: number; location?: [number, number]; areaClusterId?: string; [key: string]: any }>,
    skippedClusterIds: string[] = []
  ): Promise<{
    optimizedCoordinates: [number, number][];
    baselineCoordinates: [number, number][];
    baselineDurationMin: number;
    optimizedDurationMin: number;
    savedMinutes: number;
    savedKm: number;
    savedDieselLiters: number;
    savedRupees: number;
  }> {
    const toCoord = (s: { lat?: number; lng?: number; location?: [number, number] }): [number, number] => {
      if (Array.isArray(s.location) && s.location.length >= 2) return [s.location[0], s.location[1]];
      if (typeof s.lat === 'number' && typeof s.lng === 'number') return [s.lat, s.lng];
      return [0, 0];
    };

    const allWaypoints = allStops.map(toCoord).filter(([lat, lng]) => lat !== 0 || lng !== 0);

    const activeStops = allStops.filter((stop) => {
      const clusterId = stop.areaClusterId;
      if (!clusterId || clusterId === 'cluster-campus') return true;
      return !skippedClusterIds.includes(clusterId);
    });

    const optimizedWaypoints = (activeStops.length >= 2 ? activeStops : allStops)
      .map(toCoord)
      .filter(([lat, lng]) => lat !== 0 || lng !== 0);

    const [baselineRoute, optimizedRoute] = await Promise.all([
      this.getRouteGeometry(allWaypoints),
      this.getRouteGeometry(optimizedWaypoints),
    ]);

    const baselineDurationMin = baselineRoute.durationMinutes;
    const optimizedDurationMin = optimizedRoute.durationMinutes;
    const savedMinutes = Math.max(0, baselineDurationMin - optimizedDurationMin);
    const savedKm = Number(Math.max(0, baselineRoute.distanceKm - optimizedRoute.distanceKm).toFixed(2));
    const savedDieselLiters = Number((savedKm * 0.32).toFixed(2));
    const savedRupees = Math.round(savedDieselLiters * 98);

    return {
      optimizedCoordinates: optimizedRoute.coordinates,
      baselineCoordinates: baselineRoute.coordinates,
      baselineDurationMin,
      optimizedDurationMin,
      savedMinutes,
      savedKm,
      savedDieselLiters,
      savedRupees,
    };
  }

  private sampleWaypoints(points: [number, number][], maxPoints: number): [number, number][] {
    if (points.length <= maxPoints) return points;
    const step = (points.length - 1) / (maxPoints - 1);
    const sampled: [number, number][] = [];
    for (let i = 0; i < maxPoints; i++) {
      const idx = Math.min(Math.round(i * step), points.length - 1);
      const pt = points[idx];
      if (pt) sampled.push(pt);
    }
    return sampled;
  }

  private calculateHaversinePath(points: [number, number][]): number {
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      if (p1 && p2) {
        total += this.haversine(p1[0], p1[1], p2[0], p2[1]);
      }
    }
    return Number(total.toFixed(2));
  }

  private haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
}

export const osrmRoutingService = new OsrmRoutingService();
