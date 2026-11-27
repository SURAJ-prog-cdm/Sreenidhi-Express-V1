import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  AlertOctagon,
  BatteryCharging,
  Bus,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FastForward,
  LocateFixed,
  LogOut,
  Minus,
  Plus,
  Volume2,
  VolumeX,
  Wrench,
  Zap,
  Users,
  Play,
  Square,
  Clock,
  Navigation,
} from 'lucide-react';
import { useCommuteSimulation } from '../../context/useCommuteSimulation';
import { buildGoogleMapsRouteUrl, MetroSchematicMap } from '../map/MetroSchematicMap';
import { audioSpeechService } from '../../services/audioSpeechService';
import { excelService } from '../../services/excelService';
import { nativeDeviceService } from '../../services/nativeDeviceService';
import { haversineKm } from '../../services/mapsService';

const ENABLE_AREA_SKIPPING = import.meta.env.VITE_ENABLE_AREA_SKIPPING === 'true';

function formatTimer(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const DriverConsole: React.FC = () => {
  const {
    currentUser,
    buses,
    activeBus,
    activeRouteId,
    setActiveRouteId,
    students,
    arrivalStage,
    twoMinCountdownSec,
    driverVoiceEnabled,
    setDriverVoiceEnabled,
    confirmOversleepSafeDropOff,
    triggerBreakdownAndRescue,
    clearBreakdownStatus,
    livePhoneGpsActive,
    toggleLivePhoneGps,
    toggleDriverFlyoverBypass,
    stepBusForward,
    triggerStopArrivalTimer,
    simulateGateProximityBoarding,
    logoutUser,
    pushToast,
    routeOptimizationPlan,
  } = useCommuteSimulation();

  // Quick Tap Headcount Stepper State
  const [manualPassengerCount, setManualPassengerCount] = useState<number>(0);

  // Stop-by-Stop Manifest State
  const [manifestExpanded, setManifestExpanded] = useState(true);

  // Trip State Machine & Sub-Navigation
  const [driverTab, setDriverTab] = useState<'TRIP' | 'STOPS' | 'ALERTS'>('TRIP');
  const [tripRunning, setTripRunning] = useState<boolean>(false);
  const [startedTimeIst, setStartedTimeIst] = useState<string | null>(null);
  const [activeDelayMin, setActiveDelayMin] = useState<number>(0);
  const [wakeLockActive, setWakeLockActive] = useState<boolean>(false);

  useEffect(() => {
    return () => {
      void nativeDeviceService.releaseWakeLock();
    };
  }, []);

  // Auto Re-Acquire Screen WakeLock on visibilitychange (e.g. returning from phone call / background)
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && (tripRunning || livePhoneGpsActive)) {
        try {
          if (!nativeDeviceService.isWakeLockActive()) {
            const acquired = await nativeDeviceService.acquireWakeLock();
            setWakeLockActive(acquired);
          }
        } catch (err) {
          console.warn('[DriverConsole] Wake lock re-acquire failed:', err);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [tripRunning, livePhoneGpsActive]);

  // Dead-Zone GPS Breadcrumb Buffer (sreenidhi_driver_breadcrumbs_v1)
  const getStoredBreadcrumbs = (): Array<{ lat: number; lng: number; speedKmh: number; heading: number; accuracyM?: number | null; capturedAt: number }> => {
    try {
      const raw = localStorage.getItem('sreenidhi_driver_breadcrumbs_v1');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  };

  const appendBreadcrumb = (crumb: { lat: number; lng: number; speedKmh: number; heading: number; accuracyM?: number | null; capturedAt: number }) => {
    try {
      const list = getStoredBreadcrumbs();
      list.push(crumb);
      if (list.length > 100) list.splice(0, list.length - 100);
      localStorage.setItem('sreenidhi_driver_breadcrumbs_v1', JSON.stringify(list));
    } catch {}
  };

  const clearBreadcrumbs = () => {
    try {
      localStorage.removeItem('sreenidhi_driver_breadcrumbs_v1');
    } catch {}
  };

  // Telemetry transmission with dead-zone breadcrumb buffer
  const transmitDriverTelemetry = async (coords: { lat: number; lng: number; speedKmh: number; heading?: number; accuracyM?: number | null }) => {
    const payload = {
      routeId: activeBus.routeId,
      lat: coords.lat,
      lng: coords.lng,
      speedKmh: coords.speedKmh,
      heading: coords.heading ?? 0,
      currentStopIndex: activeBus.currentStopIndex,
      delayMinutes: activeDelayMin,
      flyoverBypassActive: activeBus.flyoverBypassActive,
      accuracyM: coords.accuracyM ?? null,
    };
    const success = await excelService.sendBusTelemetry(payload);
    if (!success) {
      appendBreadcrumb({
        lat: coords.lat,
        lng: coords.lng,
        speedKmh: coords.speedKmh,
        heading: coords.heading ?? 0,
        accuracyM: coords.accuracyM ?? null,
        capturedAt: Date.now(),
      });
    } else {
      const crumbs = getStoredBreadcrumbs();
      if (crumbs.length > 0) {
        clearBreadcrumbs();
      }
    }
  };

  // Flush dead-zone breadcrumbs on reconnect
  useEffect(() => {
    const handleOnline = async () => {
      const crumbs = getStoredBreadcrumbs();
      if (crumbs.length > 0 && tripRunning) {
        const latest = crumbs[crumbs.length - 1];
        clearBreadcrumbs();
        if (latest) {
          void excelService.sendBusTelemetry({
            routeId: activeBus.routeId,
            lat: latest.lat,
            lng: latest.lng,
            speedKmh: latest.speedKmh,
            heading: latest.heading,
            currentStopIndex: activeBus.currentStopIndex,
            delayMinutes: activeDelayMin,
            flyoverBypassActive: activeBus.flyoverBypassActive,
            accuracyM: latest.accuracyM ?? null,
          });
        }
      }
    };
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [tripRunning, activeBus.routeId, activeBus.currentStopIndex, activeDelayMin, activeBus.flyoverBypassActive]);

  // Transmit telemetry updates during active trip (simulated / manual advances only)
  useEffect(() => {
    if (!tripRunning || livePhoneGpsActive) return;
    void transmitDriverTelemetry({
      lat: activeBus.currentLat,
      lng: activeBus.currentLng,
      speedKmh: activeBus.speedKmh,
      heading: 0,
    });
  }, [tripRunning, livePhoneGpsActive, activeBus.currentLat, activeBus.currentLng]);

  const [expectedTomorrow, setExpectedTomorrow] = useState<number>(48);
  const [absentTomorrowCount, setAbsentTomorrowCount] = useState<number>(2);

  const prevBusBoardedRef = useRef<number>(activeBus.boardedCount || 0);
  useEffect(() => {
    if (typeof activeBus.boardedCount === 'number' && activeBus.boardedCount !== prevBusBoardedRef.current) {
      prevBusBoardedRef.current = activeBus.boardedCount;
      setManualPassengerCount(activeBus.boardedCount);
    }
  }, [activeBus.boardedCount]);

  // Sync trip state and tomorrow's headcount on mount
  useEffect(() => {
    let mounted = true;
    void (async () => {
      const st = await excelService.getRouteTripState(activeBus.routeId);
      if (mounted) {
        setTripRunning(st.running);
        if (st.running && st.startedAt) {
          const dt = new Date(st.startedAt);
          if (!Number.isNaN(dt.getTime())) {
            setStartedTimeIst(
              dt.toLocaleTimeString('en-IN', {
                timeZone: 'Asia/Kolkata',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
              })
            );
          }
        } else if (!st.running) {
          setStartedTimeIst(null);
        }
        setActiveDelayMin(st.delayMinutes);
        if (typeof st.headcount === 'number') {
          prevBusBoardedRef.current = st.headcount;
          setManualPassengerCount(st.headcount);
        }
        setExpectedTomorrow(typeof st.expectedTomorrow === 'number' ? st.expectedTomorrow : 0);
        setAbsentTomorrowCount(typeof st.absentTomorrowCount === 'number' ? st.absentTomorrowCount : 0);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [activeBus.routeId]);

  const handleToggleTrip = async () => {
    const next = !tripRunning;
    setTripRunning(next);
    if (next) {
      setStartedTimeIst(
        new Date().toLocaleTimeString('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        })
      );
      const acquired = await nativeDeviceService.acquireWakeLock();
      setWakeLockActive(acquired);
      // Automatically request and activate phone GPS on trip start
      if (!livePhoneGpsActive) {
        try {
          await toggleLivePhoneGps();
        } catch {
          pushToast(
            'warning',
            'Live GPS Inactive',
            'Could not obtain device location. Commuters will see corridor schedule instead of live road marker. You can proceed with manual stop departure.'
          );
        }
      }
    } else {
      setStartedTimeIst(null);
      await nativeDeviceService.releaseWakeLock();
      setWakeLockActive(false);
      if (livePhoneGpsActive) {
        await toggleLivePhoneGps();
      }
    }
    await excelService.setTripRunning(next, activeBus.routeId);
    pushToast(
      'info',
      next ? 'Trip Started' : 'Trip Ended',
      next
        ? `${activeBus.routeNumber} is now marked IN PROGRESS. Commuters can track your live movement. Screen Wake Lock active.`
        : 'Trip marked as completed. Bus resting at terminus. Screen Wake Lock released.'
    );
  };

  const handleSetDelay = async (min: number) => {
    setActiveDelayMin(min);
    await excelService.setTripDelay(min, activeBus.routeId);
    pushToast(
      min > 0 ? 'warning' : 'success',
      min > 0 ? `+${min} Min Traffic Delay Broadcasted` : 'Delay Cleared',
      min > 0
        ? `Commuters and parents notified of a +${min} min highway delay.`
        : 'Schedule restored to normal on-time tracking.'
    );
  };

  const busStudents = useMemo(
    () => students.filter((s) => s.routeId === activeBus.routeId),
    [students, activeBus.routeId],
  );

  const totalBooked = busStudents.length;
  const boardedCount = Math.max(manualPassengerCount, busStudents.filter((s) => s.boardingStatus === 'ON_BOARD').length);
  const waitingCount = Math.max(0, totalBooked - boardedCount);
  const notComingCount = busStudents.filter((s) => s.boardingStatus === 'NOT_COMING').length;

  const currentStop = activeBus.stops[activeBus.currentStopIndex] || activeBus.stops[0];

  // Headcount Stepper Actions
  const handleIncrementPassengers = (delta: number) => {
    setManualPassengerCount((prev) => {
      const next = Math.min(activeBus.capacity, Math.max(0, prev + delta));
      audioSpeechService.playClickTone();
      return next;
    });
  };

  const handleBatchBoardCurrentStop = async () => {
    const stopStudents = busStudents.filter((s) => s.pickupStopId === currentStop.id);
    const unboarded = stopStudents.filter((st) => st.boardingStatus !== 'ON_BOARD' && st.boardingStatus !== 'NOT_COMING');
    if (unboarded.length === 0) {
      pushToast('info', 'No Commuters Pending', `All commuters at ${currentStop.name} are already accounted for.`);
      return;
    }
    const count = unboarded.length;
    unboarded.forEach((st) => {
      simulateGateProximityBoarding(st.id);
    });
    void excelService.boardStop(
      currentStop.name,
      count,
      unboarded.map((s) => ({ rollNumber: s.rollNumber || s.id, name: s.name }))
    );
    setManualPassengerCount((prev) => Math.min(activeBus.capacity, prev + count));
    audioSpeechService.playBleBoardingChime();
    pushToast('success', 'Stop Boarded', `Authoritatively checked-in ${count} passengers at ${currentStop.name}.`);
  };

  const handleCheckInIndividualStudent = async (studentId: string, studentName?: string) => {
    simulateGateProximityBoarding(studentId);
    audioSpeechService.playBleBoardingChime();
    const st = busStudents.find((s) => s.id === studentId);
    const roll = st?.rollNumber || studentId;
    const name = studentName || st?.name || 'Student';
    await excelService.boardStop(currentStop.name, 1, [{ rollNumber: roll, name }]);
    setManualPassengerCount((prev) => Math.min(activeBus.capacity, prev + 1));
    pushToast('success', 'Student Boarded', `Verified check-in for student ${name} (${roll}).`);
  };

  // Auto-GPS Geofencing & Dwell Audit Refs and State
  const autoArrivedStopIdRef = useRef<string | null>(null);
  const lastDepartedStopRef = useRef<{ stopId: string; timestampMs: number } | null>(null);
  const arrivedAtMsRef = useRef<{ stopId: string; stopName: string; arrivedAtMs: number } | null>(null);
  const [autoGeofenceDistanceM, setAutoGeofenceDistanceM] = useState<number | null>(null);
  const [showManualOverride, setShowManualOverride] = useState<boolean>(false);

  const flushStopDwellLog = () => {
    const entry = arrivedAtMsRef.current;
    if (!entry) return;
    arrivedAtMsRef.current = null;
    const departedMs = Date.now();
    const dwellSec = Math.max(0, Math.round((departedMs - entry.arrivedAtMs) / 1000));
    void excelService.recordStopDwell({
      routeId: activeBus.routeId,
      stopId: entry.stopId,
      stopName: entry.stopName,
      arrivedAt: new Date(entry.arrivedAtMs).toISOString(),
      departedAt: new Date(departedMs).toISOString(),
      dwellSec,
    });
  };

  const handleArriveCurrentStop = () => {
    if (currentStop && (!arrivedAtMsRef.current || arrivedAtMsRef.current.stopId !== currentStop.id)) {
      arrivedAtMsRef.current = {
        stopId: currentStop.id,
        stopName: currentStop.name,
        arrivedAtMs: Date.now(),
      };
    }
    triggerStopArrivalTimer();
    audioSpeechService.playSuccessChime();
  };

  const handleDepartStop = () => {
    flushStopDwellLog();
    if (currentStop) {
      lastDepartedStopRef.current = { stopId: currentStop.id, timestampMs: Date.now() };
    }
    stepBusForward();
    audioSpeechService.playClickTone();
  };

  // Reset auto-arrived stop tracking ref when trip stops or activeBus changes
  useEffect(() => {
    if (!tripRunning) {
      flushStopDwellLog();
      autoArrivedStopIdRef.current = null;
      lastDepartedStopRef.current = null;
    }
  }, [tripRunning, activeBus.routeId]);

  useEffect(() => {
    if (!tripRunning || !currentStop) return;
    const distKm = haversineKm(activeBus.currentLat, activeBus.currentLng, currentStop.lat, currentStop.lng);
    const distM = Math.round(distKm * 1000);
    setAutoGeofenceDistanceM(distM);

    const arrivalThreshold = Math.min(150, currentStop.geofenceRadiusMeters || 150);

    // Auto-arrive when within arrival geofence threshold
    if (distM <= arrivalThreshold) {
      if (arrivalStage === 'IDLE' && autoArrivedStopIdRef.current !== currentStop.id) {
        autoArrivedStopIdRef.current = currentStop.id;
        if (lastDepartedStopRef.current && lastDepartedStopRef.current.stopId !== currentStop.id) {
          const elapsedSec = Math.round((Date.now() - lastDepartedStopRef.current.timestampMs) / 1000);
          if (elapsedSec >= 30 && elapsedSec <= 3600) {
            void excelService.recordSegmentArrival(
              activeBus.routeId,
              lastDepartedStopRef.current.stopId,
              currentStop.id,
              elapsedSec,
            );
          }
        }
        handleArriveCurrentStop();
      }
    } else if (distM > 225) {
      // Auto-depart when bus has left the stop perimeter
      if (arrivalStage !== 'IDLE' && autoArrivedStopIdRef.current === currentStop.id) {
        handleDepartStop();
        autoArrivedStopIdRef.current = null;
      }
    }
  }, [tripRunning, activeBus.currentLat, activeBus.currentLng, currentStop, arrivalStage]);

  const oversleepingStudents = busStudents.filter(
    (s) => s.boardingStatus === 'OVERSLEPT',
  );

  const loadPercentage = Math.round((boardedCount / activeBus.capacity) * 100);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 pb-16 antialiased">
      {/* Compact Driver Header */}
      <div className="prismatic-card flex flex-wrap items-center justify-between gap-3 rounded-3xl p-3.5 sm:p-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="rounded-full bg-gradient-to-br from-[#4F46E5] to-[#06B6D4] p-0.5 shadow-sm shrink-0">
            <img
              src="/sreenidhi_express_logo.jpg"
              alt="Sreenidhi Express Logo"
              className="h-10 w-10 rounded-full object-cover"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-sm sm:text-base font-extrabold tracking-tight text-slate-900 dark:text-white">
                Driver Console
              </h1>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                  tripRunning
                    ? 'border border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-700/50 dark:bg-cyan-950/60 dark:text-cyan-300'
                    : 'bg-slate-100 text-slate-600 dark:bg-[#2E3646] dark:text-slate-300'
                }`}
              >
                {tripRunning ? (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-[#06B6D4] animate-pulse" />
                    <span>{activeBus.routeNumber} • Live</span>
                  </>
                ) : (
                  <span>Standby</span>
                )}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  wakeLockActive
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                    : 'bg-slate-100 text-slate-500 dark:bg-[#141821] dark:text-slate-400'
                }`}
              >
                {wakeLockActive ? 'Wake Lock: ON' : 'Wake Lock: OFF'}
              </span>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              {currentUser?.role === 'DRIVER' ? (
                <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">
                  {activeBus.driverName || 'Assigned Driver'} • {activeBus.routeNumber} ({activeBus.registrationNo})
                </span>
              ) : (
                <select
                  aria-label="Select Driver Route"
                  value={activeRouteId}
                  onChange={(e) => setActiveRouteId(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-[#F7F9FF] px-2.5 py-0.5 text-[11px] font-bold text-slate-900 focus:border-[#4F46E5] focus:outline-none dark:border-[#2E3646] dark:bg-[#141821] dark:text-white"
                >
                  {buses.map((b) => (
                    <option key={b.routeId} value={b.routeId}>
                      {b.routeNumber} ({b.registrationNo}) — {b.driverName}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={logoutUser}
          className="tactile-btn inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-[#F7F9FF] px-3.5 py-2 text-xs font-bold text-slate-700 transition hover:bg-rose-50 hover:text-rose-600 dark:border-[#2E3646] dark:bg-[#141821] dark:text-slate-300 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 cursor-pointer shrink-0"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>Log out</span>
        </button>
      </div>

      {/* 3-Tab Driver Sub-Navigation */}
      <div className="prismatic-card grid grid-cols-3 gap-1.5 rounded-2xl p-1">
        {(
          [
            { id: 'TRIP', label: 'Trip' },
            { id: 'STOPS', label: 'Stops' },
            { id: 'ALERTS', label: 'Alerts' },
          ] as const
        ).map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setDriverTab(id)}
            className={`tactile-btn rounded-xl py-2 text-xs font-extrabold transition cursor-pointer ${
              driverTab === id
                ? 'bg-gradient-to-r from-[#4F46E5] to-[#06B6D4] text-white shadow-sm shadow-indigo-500/20'
                : 'text-slate-500 hover:bg-indigo-50/70 hover:text-[#4F46E5] dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Emergency Oversleep Pull-Over Banner */}
      {oversleepingStudents.length > 0 && (
        <div className="animate-pulse rounded-3xl border border-rose-400/50 bg-rose-50 p-4 text-rose-900 shadow-md dark:bg-rose-950/40 dark:text-rose-100">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertOctagon className="mt-0.5 h-7 w-7 shrink-0 text-rose-600 dark:text-rose-400" />
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-widest text-rose-700 dark:text-rose-300">
                  Oversleep Alert — Pull Over Safely
                </p>
                <h3 className="text-sm font-extrabold text-rose-900 dark:text-white">
                  {oversleepingStudents.map((s) => s.name).join(', ')} missed their stop and is still on board!
                </h3>
              </div>
            </div>
            <button
              type="button"
              onClick={confirmOversleepSafeDropOff}
              className="tactile-btn rounded-xl bg-rose-600 px-4 py-2 text-xs font-extrabold text-white shadow-sm hover:bg-rose-700 cursor-pointer"
            >
              Student Safely Stepped Off
            </button>
          </div>
        </div>
      )}

      {driverTab === 'TRIP' && (
        <div className="animate-panel-in space-y-4">
          {/* Primary Electric Indigo -> Cyan Driver Hero Card */}
          <div className="electric-hero rounded-3xl p-5 text-white">
            <div className="bg-futuristic-grid pointer-events-none absolute inset-0 opacity-25" />

            {/* Top Row: Live Headcount & Compact Stepper */}
            <div className="relative flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold text-indigo-100/90">Live Headcount:</p>
                <div className="mt-0.5 flex items-baseline gap-2">
                  <span className="font-mono-timer text-3xl sm:text-4xl font-black tracking-tight text-white">
                    {boardedCount}{' '}
                    <span className="text-lg font-bold text-cyan-100/90">/ {activeBus.capacity}</span>
                  </span>
                  <span className="rounded-full bg-white/18 px-2.5 py-0.5 text-[10px] font-bold text-white ring-1 ring-white/25 backdrop-blur-xs">
                    {loadPercentage}% full
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleIncrementPassengers(-1)}
                  title="Decrease passenger count"
                  className="tactile-btn flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 text-white ring-1 ring-white/25 backdrop-blur-xs transition hover:bg-white/30 cursor-pointer"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleIncrementPassengers(1)}
                  title="Increase passenger count"
                  className="tactile-btn flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 text-white ring-1 ring-white/25 backdrop-blur-xs transition hover:bg-white/30 cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Middle Row: Started Time & Live GPS / 5G Pill */}
            <div className="relative mt-3.5 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/15 bg-white/12 px-3.5 py-2.5 text-xs backdrop-blur-md">
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-cyan-200" />
                <span className="font-semibold text-white">
                  Started {startedTimeIst || 'Not Started'}
                </span>
              </div>
              <div className="flex items-center gap-2 rounded-full bg-white/18 px-2.5 py-0.5 font-mono text-[11px] font-bold text-white">
                <BatteryCharging className="h-3.5 w-3.5 text-cyan-200" />
                <span>{livePhoneGpsActive ? 'GPS Active' : 'GPS Standby'} • 5G • {activeBus.driverBatteryPct ?? 86}%</span>
              </div>
            </div>

            {/* Bottom Full-Width Crisp White CTA */}
            <button
              type="button"
              onClick={handleToggleTrip}
              className="animate-electric-sheen tactile-btn relative mt-4 flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-white py-3 text-xs font-extrabold text-[#4F46E5] shadow-md transition hover:bg-indigo-50 cursor-pointer"
            >
              {tripRunning ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              <span>{tripRunning ? 'End Bus Trip' : 'Start Bus Trip'}</span>
            </button>
          </div>

          {/* Next Stop & Quick Delay Card */}
          <div className="prismatic-card rounded-3xl p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-100 pb-3.5 dark:border-[#2E3646]">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Next Stop:
                </p>
                <p className="mt-0.5 text-sm sm:text-base font-extrabold text-slate-900 dark:text-white truncate">
                  {currentStop?.name}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  {waitingCount} waiting • {notComingCount} opt-out
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-indigo-200/80 bg-indigo-50 px-3 py-1 font-mono text-xs font-bold text-[#4F46E5] dark:border-indigo-700/50 dark:bg-indigo-950/60 dark:text-cyan-300">
                  {arrivalStage === 'ARRIVED_2_MIN_TIMER' && twoMinCountdownSec > 0
                    ? `Dwell: ${formatTimer(twoMinCountdownSec)}`
                    : autoGeofenceDistanceM !== null
                    ? `${autoGeofenceDistanceM}m`
                    : 'Scheduled'}
                </span>
                {tripRunning && (
                  <button
                    type="button"
                    onClick={handleDepartStop}
                    className="electric-cta inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
                  >
                    <FastForward className="h-3.5 w-3.5" />
                    <span>Next Stop →</span>
                  </button>
                )}
              </div>
            </div>

            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              {[
                { min: 5, label: '+5 min' },
                { min: 10, label: '+10 min' },
                { min: 20, label: 'Traffic (+20m)' },
              ].map((item) => (
                <button
                  key={item.min}
                  type="button"
                  onClick={() => handleSetDelay(item.min)}
                  className={`tactile-btn rounded-full px-3.5 py-1.5 text-xs font-bold transition cursor-pointer ${
                    activeDelayMin === item.min
                      ? 'bg-amber-500 text-white shadow-xs'
                      : 'border border-slate-200/80 bg-[#F7F9FF] text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-[#4F46E5] dark:border-[#2E3646] dark:bg-[#141821] dark:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
              {activeDelayMin > 0 && (
                <button
                  type="button"
                  onClick={() => handleSetDelay(0)}
                  className="tactile-btn rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300 cursor-pointer"
                >
                  On-Time
                </button>
              )}
            </div>
          </div>

          {/* Compact Live GPS Corridor Schematic Card */}
          <div className="prismatic-card overflow-hidden rounded-3xl">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3.5 dark:border-[#2E3646]">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#06B6D4] shadow-[0_0_8px_rgba(6,182,212,0.85)] animate-pulse" />
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                  Live Corridor Radar • {activeBus.routeNumber}
                </h4>
              </div>
              <span className="prismatic-subcard rounded-lg px-2.5 py-1 font-mono text-[11px] font-bold text-[#4F46E5] dark:text-cyan-300">
                {Math.round(activeBus.speedKmh)} km/h
              </span>
            </div>

            <div className="p-2.5 sm:p-3 bg-[#F7F9FF] dark:bg-[#141821]">
              <MetroSchematicMap activeBus={activeBus} highlightStopId={currentStop?.id} />
            </div>
          </div>
        </div>
      )}

      {driverTab === 'STOPS' && (
        <div className="animate-panel-in space-y-4">
          {/* Stop-by-Stop Passenger Manifest & Batch Boarding */}
          <div className="prismatic-card rounded-3xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4 dark:border-[#2E3646]">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-50 to-cyan-50 text-[#4F46E5] dark:bg-indigo-950/60 dark:text-cyan-300">
                    <Bus className="h-4 w-4" />
                  </span>
                  <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                    Corridor Stop Schedule &amp; Manifest
                  </h2>
                  <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[10px] font-bold text-[#4F46E5] dark:bg-indigo-950/60 dark:text-indigo-300">
                    {activeBus.routeId === 'route-51'
                      ? '26 Registered (18 Students • 8 Faculty/Staff)'
                      : `${busStudents.length} Registered`}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Tomorrow Expected: <b>{routeOptimizationPlan?.expectedRouteStudents ?? expectedTomorrow}</b> ({routeOptimizationPlan?.absentRouteStudents ?? absentTomorrowCount} opted out)
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleBatchBoardCurrentStop}
                  className="electric-cta flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-white cursor-pointer"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Mark {currentStop.name} Boarded</span>
                </button>
                <button
                  type="button"
                  onClick={() => setManifestExpanded(!manifestExpanded)}
                  className="tactile-btn flex items-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50/70 px-2.5 py-2 text-xs font-bold text-[#4F46E5] dark:border-[#2E3646] dark:bg-[#141821] dark:text-cyan-300 cursor-pointer"
                >
                  <span>{manifestExpanded ? 'Collapse' : 'Expand'}</span>
                  {manifestExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {manifestExpanded && (
              <div className="mt-4 space-y-2.5">
                {activeBus.stops.map((stop, idx) => {
                  const isPassed = idx < activeBus.currentStopIndex;
                  const isCurrent = idx === activeBus.currentStopIndex;
                  const stopStudents = busStudents.filter((s) => s.pickupStopId === stop.id);
                  const stopBoarded = stopStudents.filter((s) => s.boardingStatus === 'ON_BOARD').length;

                  return (
                    <div
                      key={stop.id}
                      className={`rounded-2xl border p-3.5 transition-all ${
                        isCurrent
                          ? 'border-[#4F46E5]/60 bg-gradient-to-br from-indigo-50/90 via-white to-cyan-50/70 shadow-sm dark:border-indigo-500 dark:bg-indigo-950/30'
                          : isPassed
                          ? 'border-slate-200/60 bg-slate-50/70 opacity-75 dark:border-[#2E3646] dark:bg-[#141821]'
                          : 'border-slate-200/80 bg-[#F7F9FF] dark:border-[#2E3646] dark:bg-[#141821]'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <span
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl font-bold text-xs ${
                              isCurrent
                                ? 'bg-gradient-to-br from-[#4F46E5] to-[#06B6D4] text-white'
                                : isPassed
                                ? 'bg-slate-300 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                                : 'bg-white text-slate-900 border border-slate-200 dark:bg-[#1E2430] dark:text-white dark:border-[#2E3646]'
                            }`}
                          >
                            {stop.sequence}
                          </span>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-xs font-extrabold text-slate-900 dark:text-white">
                                {stop.name}
                              </h4>
                              {stop.metroInterchange && (
                                <span className="rounded bg-cyan-50 border border-cyan-200 px-1.5 py-0.5 text-[9px] font-bold text-cyan-800 dark:bg-cyan-950 dark:border-cyan-800 dark:text-cyan-300">
                                  METRO
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              {stop.areaClusterName} • Sched: {stop.scheduledMorningTime}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                              isCurrent
                                ? 'bg-gradient-to-r from-[#4F46E5] to-[#06B6D4] text-white'
                                : isPassed
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {isCurrent ? 'CURRENT STOP' : isPassed ? '✓ DEPARTED' : 'UPCOMING'}
                          </span>
                          <span className="text-xs font-mono font-bold text-slate-900 dark:text-white">
                            {stopBoarded}/{stopStudents.length} Boarded
                          </span>
                        </div>
                      </div>

                      {isCurrent && stopStudents.length > 0 && (
                        <div className="mt-3 border-t border-indigo-100 pt-2.5 dark:border-[#2E3646]">
                          <p className="text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1.5">
                            Stop Passenger Manifest:
                          </p>
                          <div className="space-y-1.5">
                            {stopStudents.map((st) => (
                              <div
                                key={st.id}
                                className="flex items-center justify-between rounded-xl bg-white/95 px-2.5 py-1.5 text-xs shadow-2xs dark:bg-[#1E2430]"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-slate-900 dark:text-white">{st.name}</span>
                                  <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                                    ({st.rollNumber || st.id})
                                  </span>
                                  {st.riderType === 'FACULTY' && (
                                    <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-bold text-purple-800 dark:bg-purple-950 dark:text-purple-300">
                                      FACULTY
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase ${
                                      st.boardingStatus === 'ON_BOARD'
                                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                        : st.boardingStatus === 'NOT_COMING'
                                        ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                    }`}
                                  >
                                    {st.boardingStatus === 'ON_BOARD'
                                      ? '✓ Boarded'
                                      : st.boardingStatus === 'NOT_COMING'
                                      ? 'Absent'
                                      : 'Waiting'}
                                  </span>
                                  {st.boardingStatus !== 'ON_BOARD' && st.boardingStatus !== 'NOT_COMING' && (
                                    <button
                                      type="button"
                                      onClick={() => handleCheckInIndividualStudent(st.id, st.name)}
                                      className="electric-cta rounded-lg px-2.5 py-0.5 text-[10px] font-bold text-white cursor-pointer"
                                    >
                                      Board
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tomorrow / Active Route Navigation & Optimization Panel */}
          {!ENABLE_AREA_SKIPPING ? (
            <div className="prismatic-card rounded-3xl p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-50 to-cyan-50 text-[#4F46E5] dark:bg-indigo-950/60 dark:text-cyan-300">
                    <Navigation className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                        Route Navigation &amp; Pilot Mode
                      </h3>
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-[#4F46E5] dark:bg-indigo-950/60 dark:text-cyan-300">
                        Phase 1 Pilot
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      All stops active — area-skipping disabled for Phase 1 pilot • Tomorrow:{' '}
                      <b className="text-slate-800 dark:text-slate-200">
                        {routeOptimizationPlan?.expectedRouteStudents ?? expectedTomorrow} coming
                      </b>{' '}
                      /{' '}
                      <span className="font-semibold text-amber-700 dark:text-amber-300">
                        {routeOptimizationPlan?.absentRouteStudents ?? absentTomorrowCount} opted out
                      </span>
                    </p>
                  </div>
                </div>

                <a
                  href={buildGoogleMapsRouteUrl(activeBus.stops, {
                    lat: activeBus.currentLat,
                    lng: activeBus.currentLng,
                  })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="electric-cta flex items-center gap-2 rounded-xl text-white px-3.5 py-2 text-xs font-bold cursor-pointer"
                >
                  <Navigation className="h-3.5 w-3.5" />
                  <span>Navigate Full Route (Google Maps)</span>
                </a>
              </div>
            </div>
          ) : (
          <div className="prismatic-card rounded-3xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-50 to-cyan-50 text-[#4F46E5] dark:bg-indigo-950/60 dark:text-cyan-300">
                  <Navigation className="h-4 w-4" />
                </span>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                      Dynamic Route Optimization (Tomorrow Run)
                    </h3>
                    {routeOptimizationPlan?.skippedClusterIds?.length > 0 ? (
                      <span className="rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 px-2 py-0.5 text-[10px] font-bold">
                        {routeOptimizationPlan.skippedClusterIds.length} Cluster(s) Bypassed
                      </span>
                    ) : (
                      <span className="rounded-full bg-indigo-50 text-[#4F46E5] dark:bg-slate-800 dark:text-slate-300 px-2 py-0.5 text-[10px] font-bold">
                        Standard Route (All Stops Active)
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Automated area bypass activates when 100% of riders in a cluster are absent.
                  </p>
                </div>
              </div>

              {(() => {
                const activeStops = activeBus.stops.filter((s) => !s.isBypassed);
                const googleMapsUrl = buildGoogleMapsRouteUrl(
                  activeStops.length > 0 ? activeStops : activeBus.stops,
                  { lat: activeBus.currentLat, lng: activeBus.currentLng }
                );

                return (
                  <a
                    href={googleMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="electric-cta flex items-center gap-2 rounded-xl text-white px-3.5 py-2 text-xs font-bold cursor-pointer"
                  >
                    <Navigation className="h-3.5 w-3.5" />
                    <span>Navigate Optimized Route (Google Maps)</span>
                  </a>
                );
              })()}
            </div>

            {routeOptimizationPlan?.skippedClusterIds?.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                <span className="font-bold">Projected Trip Savings:</span>
                <span className="rounded-md bg-white dark:bg-[#1E2430] px-2 py-0.5 font-mono font-bold shadow-2xs">
                  ⏱️ -{routeOptimizationPlan.estimatedMinutesSaved || 12} min
                </span>
                <span className="rounded-md bg-white dark:bg-[#1E2430] px-2 py-0.5 font-mono font-bold shadow-2xs">
                  🛣️ -{routeOptimizationPlan.estimatedKmSaved || 3.5} km
                </span>
                <span className="rounded-md bg-white dark:bg-[#1E2430] px-2 py-0.5 font-mono font-bold shadow-2xs">
                  ⛽ ~₹{Math.round((routeOptimizationPlan.estimatedKmSaved || 3.5) * 0.32 * 98)} diesel saved
                </span>
              </div>
            )}

            {routeOptimizationPlan?.clusters && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
                {routeOptimizationPlan.clusters.map((c: any) => (
                  <div
                    key={c.clusterId}
                    className={`rounded-2xl border p-3 flex flex-col justify-between ${
                      c.isSkipped
                        ? 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/30'
                        : 'prismatic-subcard'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-[11px] font-bold text-slate-900 dark:text-white truncate">
                          {c.clusterName}
                        </span>
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[9px] font-extrabold uppercase shrink-0 ${
                            c.isSkipped
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'bg-indigo-50 text-[#4F46E5] dark:bg-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {c.isSkipped ? 'BYPASS' : 'STOP'}
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                        {c.isCampus ? 'Campus Terminal Hub' : `${c.totalRegisteredStudents} registered rider(s)`}
                      </p>
                    </div>
                    {!c.isCampus && (
                      <div className="mt-2 flex items-center justify-between text-[10px] font-medium pt-1.5 border-t border-slate-200/60 dark:border-[#2E3646]">
                        <span className="text-emerald-700 dark:text-emerald-400 font-bold">
                          {c.comingStudents} coming
                        </span>
                        <span className="text-amber-700 dark:text-amber-400 font-bold">
                          {c.absentStudents} absent
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          )}
        </div>
      )}

      {driverTab === 'ALERTS' && (
        <div className="animate-panel-in space-y-4">
          {/* Automatic GPS Geofence & Manual Override */}
          <div className="prismatic-card rounded-3xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#06B6D4] opacity-75"></span>
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-[#4F46E5]"></span>
                </span>
                <div>
                  <span className="text-xs font-extrabold text-[#4F46E5] dark:text-cyan-300">
                    Automatic GPS Geofence Active
                  </span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Target: <b className="text-slate-900 dark:text-white">{currentStop?.name}</b>{' '}
                    {autoGeofenceDistanceM !== null && `• Distance: ${autoGeofenceDistanceM}m`}
                  </p>
                </div>
              </div>
              <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[10px] font-bold text-[#4F46E5] dark:border-indigo-700/50 dark:bg-indigo-950/60 dark:text-cyan-300 font-mono">
                ≤150m AUTO-ARRIVE • &gt;225m AUTO-DEPART
              </span>
            </div>

            <div className="mt-3.5 pt-3 border-t border-slate-100 dark:border-[#2E3646] flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setShowManualOverride((prev) => !prev)}
                className="self-start text-xs font-bold text-[#4F46E5] hover:underline dark:text-cyan-300 cursor-pointer"
              >
                {showManualOverride ? 'Hide Manual Override' : 'Show Manual Override Controls'}
              </button>
              {showManualOverride && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleArriveCurrentStop}
                    className="tactile-btn rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-amber-700 cursor-pointer"
                  >
                    Force Arrive Stop (2m Timer)
                  </button>
                  <button
                    type="button"
                    onClick={handleDepartStop}
                    className="electric-cta flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-white cursor-pointer"
                  >
                    <FastForward className="h-3.5 w-3.5" />
                    <span>Force Depart / Next Stop</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Cabin Controls */}
          <div className="prismatic-card rounded-3xl p-5">
            <div className="flex items-center gap-2 mb-3.5">
              <Users className="h-4 w-4 text-[#4F46E5] dark:text-cyan-300" />
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                Driver Telemetry &amp; Safety Actions
              </h3>
            </div>

            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={toggleLivePhoneGps}
                className={`tactile-btn inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition cursor-pointer ${
                  livePhoneGpsActive
                    ? 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-500/40 dark:bg-emerald-950/60 dark:text-emerald-300'
                    : 'border border-slate-200 bg-[#F7F9FF] text-slate-800 hover:bg-indigo-50 dark:border-[#2E3646] dark:bg-[#141821] dark:text-white'
                }`}
              >
                <LocateFixed className="h-4 w-4" />
                <span>{livePhoneGpsActive ? 'Phone GPS: ON' : 'Phone GPS: OFF'}</span>
              </button>

              <button
                type="button"
                onClick={() => setDriverVoiceEnabled(!driverVoiceEnabled)}
                className={`tactile-btn inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition cursor-pointer ${
                  driverVoiceEnabled
                    ? 'bg-indigo-100 text-[#4F46E5] ring-1 ring-[#4F46E5]/40 dark:bg-indigo-950/60 dark:text-cyan-300'
                    : 'border border-slate-200 bg-[#F7F9FF] text-slate-800 hover:bg-indigo-50 dark:border-[#2E3646] dark:bg-[#141821] dark:text-white'
                }`}
              >
                {driverVoiceEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                <span>Voice Readouts: {driverVoiceEnabled ? 'ON' : 'OFF'}</span>
              </button>

              {activeBus.status === 'BREAKDOWN_RESCUE_ACTIVE' ? (
                <button
                  type="button"
                  onClick={() => clearBreakdownStatus()}
                  className="tactile-btn inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Clear Rescue / Resume Run</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => triggerBreakdownAndRescue()}
                  className="tactile-btn inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-rose-700 cursor-pointer"
                >
                  <Wrench className="h-4 w-4" />
                  <span>Breakdown / Rescue Bus</span>
                </button>
              )}
            </div>
          </div>

          {/* NH-163 Warangal Highway Corridor Mode */}
          <div className="prismatic-card rounded-3xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-50 to-cyan-50 text-[#4F46E5] dark:bg-indigo-950/60 dark:text-cyan-300">
                  <Zap className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                    NH-163 Warangal Highway Corridor Mode
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {activeBus.flyoverBypassActive
                      ? 'Bypassing congested ground traffic over the Uppal-Narapally elevated flyover (-14 min saved).'
                      : 'Operating on ground-level service road for student neighborhood cluster pickup stops.'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => toggleDriverFlyoverBypass()}
                className={`rounded-xl px-4 py-2 text-xs font-extrabold transition cursor-pointer ${
                  activeBus.flyoverBypassActive
                    ? 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-500/40 dark:bg-emerald-950/60 dark:text-emerald-300'
                    : 'electric-cta text-white'
                }`}
              >
                {activeBus.flyoverBypassActive ? 'Flyover Active (-14 min)' : 'Engage Uppal Flyover Bypass'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
