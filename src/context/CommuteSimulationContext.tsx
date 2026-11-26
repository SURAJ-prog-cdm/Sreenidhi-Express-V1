import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  clearApiOverrides,
  loadEffectiveApiConfig,
  saveApiOverrides,
} from '../config/apiConfig';
import {
  INITIAL_BUS_FLEET,
  INITIAL_COMMUTE_HISTORY,
  INITIAL_CYBERABAD_TRAFFIC_ALERTS,
  INITIAL_FUEL_ROI,
  INITIAL_NOTIFICATION_LOGS,
  INITIAL_STUDENTS,
} from '../data/sreenidhiData';
import { audioSpeechService } from '../services/audioSpeechService';
import { firebaseSyncService } from '../services/firebaseSyncService';
import { firebaseService } from '../services/firebaseService';
import {
  calculateStopEtaSeconds,
  computeBypassDirections,
  haversineKm,
  verifyAndLoadGoogleMaps,
} from '../services/mapsService';
import { nativeDeviceService } from '../services/nativeDeviceService';
import { dispatchSafetyNotification } from '../services/notificationService';
import { excelService } from '../services/excelService';
import { osrmRoutingService } from '../services/osrmRoutingService';
import { commuteSafetyEngine } from '../services/commuteSafetyEngine';
import type {
  ApiIntegrationStatus,
  ApiKeysConfig,
  AuthUserSession,
  BusVehicle,
  CommuteTripHistoryEntry,
  CyberabadTrafficAlert,
  FuelRoiMetrics,
  LostItemReport,
  NotificationLogEntry,
  PortalView,
  RouteStop,
  ScheduleMode,
  StopArrivalStage,
  StudentRecord,
  TripDirection,
} from '../types/transit';
import {
  CommuteSimulationContext,
  type CommuteSimulationContextValue,
  LiveTelemetryContext,
  type LiveTelemetryContextValue,
  type ToastBanner,
} from './useCommuteSimulation';

// Baseline onboard counts representing students from earlier stops not explicitly listed in the 10-row sample roster
const BASELINE_OCCUPANCY: Record<string, number> = {
  'route-51': 0,
  'route-14': 39,
  'route-15': 35,
  'route-18': 30,
  'route-11': 42,
  'route-22': 28,
};

const normalRouteId = (value: unknown) => {
  const found = String(value || '').match(/\d+/);
  return found ? `route-${Number(found[0])}` : String(value || '').trim().toLowerCase();
};
const normalStopName = (value: unknown) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

function studentFromProfile(profile: Record<string, any>, buses: BusVehicle[], user: AuthUserSession | null): StudentRecord {
  const rollNumber = String(profile['Roll Number'] || profile.rollNumber || user?.wardRoll || user?.rollNumber || '').toUpperCase();
  const routeId = normalRouteId(profile['Assigned Route'] || profile.routeId || user?.wardRouteId);
  const bus = buses.find((candidate) => candidate.routeId === routeId) || buses[0];
  const pickupValue = profile['Pickup Stop'] || profile.pickupStopId || user?.wardPickupStop || '';
  const pickupStop = bus?.stops.find((stop) =>
    normalStopName(stop.id) === normalStopName(pickupValue) ||
    normalStopName(stop.name) === normalStopName(pickupValue) ||
    normalStopName(stop.shortName) === normalStopName(pickupValue),
  );
  const pickupStopId = pickupStop?.id || String(pickupValue || bus?.stops[0]?.id || '');
  const pass = String(profile['Pass Status'] || profile.passStatus || 'FEE_PENDING').toUpperCase();
  return {
    id: `stu-${rollNumber}`,
    rollNumber,
    name: String(profile['Student Name'] || profile.name || user?.wardName || user?.name || 'Student'),
    program: String(profile['Department / Program'] || profile.program || ''),
    routeId,
    pickupStopId,
    stopId: pickupStop?.id,
    areaClusterId: pickupStop?.areaClusterId,
    defaultDropStopId: pickupStopId,
    alternateReturnStopId: null,
    parentName: String(profile['Parent Name'] || profile.parentName || ''),
    parentPhoneMasked: String(profile['Parent Phone'] || profile.parentPhone || ''),
    passStatus: pass === 'ACTIVE' || pass === 'EXPIRING_SOON' ? pass : 'FEE_PENDING',
    gracePassActive: false,
    boardingStatus: profile.boardedToday ? 'ON_BOARD' : 'WAITING',
    checkInMethod: profile.boardedToday ? 'STUDENT_SELF_TAP' : 'NONE',
    wakeUpAlarmEnabled: true,
    bleRssiDbm: -72,
    mustChangePassword: Boolean(profile.mustChangePassword || profile.must_change_password || user?.mustChangePassword),
    riderType: ((profile.riderType || (user as any)?.riderType || 'STUDENT') as string).toUpperCase() as 'STUDENT' | 'FACULTY',
    gender: (profile.gender || 'M') as 'M' | 'F',
  };
}

export const CommuteSimulationProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const nativePlatform = nativeDeviceService.getPlatformLabel();
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  );
  const [mobilePreviewFrame, setMobilePreviewFrame] = useState<boolean>(false);
  const [isSimDrawerOpen, setIsSimDrawerOpen] = useState<boolean>(false);
  const [livePhoneGpsActive, setLivePhoneGpsActive] = useState<boolean>(false);
  const gpsStopWatchRef = useRef<(() => void) | null>(null);

  const isMobileShell =
    nativeDeviceService.isNative() || isMobileViewport || mobilePreviewFrame;

  const [activeView, setActiveView] = useState<PortalView>(() => {
    try {
      const stored = localStorage.getItem('transitpulse_auth_user_v1');
      if (stored) {
        const u = JSON.parse(stored);
        if (u?.role === 'ADMIN') return 'ADMIN';
        if (u?.role === 'DRIVER') return 'DRIVER';
        if (u?.role === 'PARENT') return 'PARENT';
        if (u?.role === 'STUDENT') return 'STUDENT';
      }
    } catch {
      // ignore
    }
    return 'STUDENT_LOGIN';
  });
  const [isDark, setIsDark] = useState<boolean>(true);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState<boolean>(false);
  const [latestToast, setLatestToast] = useState<ToastBanner | null>(null);

  const [apiConfig, setApiConfig] = useState<ApiKeysConfig>(() => loadEffectiveApiConfig());
  const [apiStatus, setApiStatus] = useState<ApiIntegrationStatus>(() => ({
    googleMapsMode: 'FALLBACK_LEAFLET_OSM',
    googleMapsVerified: false,
    firebaseMode: firebaseSyncService.isConfigured(loadEffectiveApiConfig())
      ? 'LIVE_FIREBASE_RTDB'
      : 'LOCAL_REACTIVE_STORE',
    notificationMode: 'CONNECTED_WEBHOOK',
  }));

  const [buses, setBuses] = useState<BusVehicle[]>(() =>
    structuredClone(INITIAL_BUS_FLEET),
  );
  const busesRef = useRef<BusVehicle[]>(buses);
  busesRef.current = buses;
  const [activeRouteId, setActiveRouteId] = useState<string>(() => {
    try {
      const stored = localStorage.getItem('transitpulse_auth_user_v1');
      if (stored) {
        const u = JSON.parse(stored);
        if (u?.wardRouteId || u?.routeId) return u.wardRouteId || u.routeId;
      }
    } catch {
      // ignore
    }
    return 'route-51';
  });
  const [students, setStudents] = useState<StudentRecord[]>(() =>
    structuredClone(INITIAL_STUDENTS),
  );
  const [activeStudentId, setActiveStudentId] = useState<string>('stu-51-18');
  const [tripDirection, setTripDirection] = useState<TripDirection>('MORNING_TO_CAMPUS');
  const [scheduleMode, setScheduleModeState] = useState<ScheduleMode>('REGULAR');

  const [autoDriveEnabled, setAutoDriveEnabled] = useState<boolean>(false);
  const [arrivalStage, setArrivalStage] = useState<StopArrivalStage>('IDLE');
  const [twoMinCountdownSec, setTwoMinCountdownSec] = useState<number>(120);
  const [driverVoiceEnabled, setDriverVoiceEnabled] = useState<boolean>(true);
  const [wakeUpBannerStopName, setWakeUpBannerStopName] = useState<string | null>(null);

  const [notifications, setNotifications] = useState<NotificationLogEntry[]>(
    INITIAL_NOTIFICATION_LOGS,
  );
  const [lostItems, setLostItems] = useState<LostItemReport[]>([]);
  const [fuelRoi, setFuelRoi] = useState<FuelRoiMetrics>(INITIAL_FUEL_ROI);

  const [excelStatus, setExcelStatus] = useState(() => ({
    online: false,
    serverUrl: 'http://localhost:3001',
    fileName: 'sreenidhi_transit_master.xlsx',
    totalSheets: 6,
    lastModified: undefined as string | undefined,
  }));

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      const health = await excelService.checkBackendHealth();
      if (mounted) {
        setExcelStatus({
          online: health.online,
          serverUrl: health.serverUrl,
          fileName: health.fileName,
          totalSheets: health.totalSheets,
          lastModified: health.lastModified,
        });
      }
    };
    void poll();
    const iv = window.setInterval(poll, 7000);
    return () => {
      mounted = false;
      window.clearInterval(iv);
    };
  }, []);

  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);
  const [trafficAlerts] = useState<CyberabadTrafficAlert[]>(INITIAL_CYBERABAD_TRAFFIC_ALERTS);
  const [studentCommuteHistory] = useState<CommuteTripHistoryEntry[]>(INITIAL_COMMUTE_HISTORY);
  const activeTrafficAlert = trafficAlerts[0] || null;

  const pushToast = useCallback(
    (tone: ToastBanner['tone'], title: string, body: string) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
      setLatestToast({ id, tone, title, body });
      if (tone === 'danger') {
        void nativeDeviceService.triggerHaptic('heavy');
        void nativeDeviceService.sendMobileNotification(title, body);
      } else if (tone === 'warning') {
        void nativeDeviceService.triggerHaptic('medium');
        void nativeDeviceService.sendMobileNotification(title, body);
      } else if (tone === 'success') {
        void nativeDeviceService.triggerHaptic('light');
      }
    },
    [],
  );

  const downloadMasterExcel = useCallback(async () => {
    try {
      await excelService.downloadExcelWorkbook({
        students,
        notifications,
        lostItems,
      });
      pushToast('success', 'Excel Workbook Downloaded', 'Master transit dataset exported.');
    } catch (err: any) {
      pushToast('danger', 'Export Failed', err?.message || 'Could not download Excel workbook.');
    }
  }, [students, notifications, lostItems, pushToast]);

  const toggleDriverFlyoverBypass = useCallback(
    (routeId?: string) => {
      const targetId = routeId || activeRouteId;
      setBuses((prev) =>
        prev.map((bus) => {
          if (bus.routeId !== targetId) return bus;
          const next = !bus.flyoverBypassActive;
          pushToast(
            next ? 'success' : 'info',
            next ? 'Uppal Elevated Flyover Engaged' : 'Service Road Active',
            next
              ? 'Driver bypassed NH-163 surface traffic bottleneck via Uppal–Narapally Flyover.'
              : 'Driver returning to ground-level service road for local stops.',
          );
          audioSpeechService.speakDriverAnnouncement(
            next
              ? 'Uppal elevated flyover express bypass engaged. Surface bottlenecks cleared.'
              : 'Service road mode engaged for local stops.',
            driverVoiceEnabled,
          );
          return {
            ...bus,
            flyoverBypassActive: next,
            trafficDelayMinutes: next ? Math.max(2, bus.trafficDelayMinutes - 12) : bus.trafficDelayMinutes + 12,
          };
        }),
      );
    },
    [activeRouteId, driverVoiceEnabled, pushToast],
  );

  const updateDriverBattery = useCallback(
    (pct: number, charging = true) => {
      setBuses((prev) =>
        prev.map((bus) =>
          bus.routeId === activeRouteId
            ? { ...bus, driverBatteryPct: pct, driverBatteryCharging: charging }
            : bus,
        ),
      );
      if (pct <= 15 && !charging) {
        audioSpeechService.speakDriverAnnouncement(
          'Warning: Driver cabin terminal battery low. Plug in bus charger.',
          driverVoiceEnabled,
        );
        pushToast(
          'warning',
          'Driver Phone Battery Low',
          `Driver tablet is at ${pct}%. Connect dashboard charger to maintain live GPS.`,
        );
      }
    },
    [activeRouteId, driverVoiceEnabled, pushToast],
  );

  const [currentUser, setCurrentUser] = useState<AuthUserSession | null>(() => {
    try {
      const stored = localStorage.getItem('transitpulse_auth_user_v1');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const handleSetCurrentUser = useCallback((user: AuthUserSession | null) => {
    setCurrentUser(user);
    if (user) {
      try {
        localStorage.setItem('transitpulse_auth_user_v1', JSON.stringify(user));
      } catch {
        // ignore
      }
    } else {
      try {
        localStorage.removeItem('transitpulse_auth_user_v1');
      } catch {
        // ignore
      }
    }
  }, []);

  const logoutUser = useCallback(() => {
    handleSetCurrentUser(null);
    excelService.clearAuthSession();
    gpsStopWatchRef.current?.();
    gpsStopWatchRef.current = null;
    setLivePhoneGpsActive(false);
    pushToast('info', 'Logged Out', 'You have signed out of Sreenidhi Express.');
    setActiveView('STUDENT_LOGIN');
  }, [handleSetCurrentUser, pushToast]);

  const syncAuthenticatedStudent = useCallback((profile: Record<string, unknown>) => {
    const record = studentFromProfile(profile, buses, currentUser);
    if (!record.rollNumber || !record.routeId || !record.pickupStopId) return;
    setStudents((previous) => {
      const found = previous.some((student) => student.rollNumber.toUpperCase() === record.rollNumber);
      return found
        ? previous.map((student) => student.rollNumber.toUpperCase() === record.rollNumber ? { ...student, ...record } : student)
        : [...previous, record];
    });
    setActiveStudentId(record.id);
    setActiveRouteId(record.routeId);
  }, [buses, currentUser]);

  useEffect(() => {
    if (!currentUser || (currentUser.role !== 'STUDENT' && currentUser.role !== 'PARENT') || !excelService.getAuthToken()) return;
    let cancelled = false;
    void excelService.getStudentProfile().then((profile) => {
      if (!cancelled && profile) syncAuthenticatedStudent(profile);
    });
    return () => { cancelled = true; };
  }, [currentUser?.role, currentUser?.rollNumber, currentUser?.wardRoll, syncAuthenticatedStudent]);

  const apiConfigRef = useRef(apiConfig);
  useEffect(() => {
    apiConfigRef.current = apiConfig;
  }, [apiConfig]);

  // Sync Tailwind dark class on <html> and track responsive viewport
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [isDark]);

  useEffect(() => {
    const onResize = () => setIsMobileViewport(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    return () => {
      gpsStopWatchRef.current?.();
    };
  }, []);

  const toggleDark = useCallback(() => setIsDark((d) => !d), []);
  const dismissToast = useCallback(() => setLatestToast(null), []);
  const dismissWakeUpBanner = useCallback(() => setWakeUpBannerStopName(null), []);

  const activeStudentRef = useRef<StudentRecord | null>(null);

  const appendNotification = useCallback(
    async (
      params: Omit<Parameters<typeof dispatchSafetyNotification>[0], 'apiConfig'>,
    ) => {
      const entry = await dispatchSafetyNotification({
        ...params,
        rollNumber: params.rollNumber ?? activeStudentRef.current?.rollNumber,
        apiConfig: apiConfigRef.current,
      });
      setNotifications((prev) => [entry, ...prev].slice(0, 60));

      // Only notify parent via Telegram for explicitly mapped safety events
      const catMap: Record<string, string> = {
        BUS_DELAY_ALERT: 'DELAY',
        BREAKDOWN_ALERT: 'BREAKDOWN',
        CAMPUS_ARRIVAL: 'ARRIVED_CAMPUS',
        APPROACHING_STOP: 'PRE_ARRIVAL_10M',
        BOARDED_CONFIRMED: 'BOARDED',
        MISSED_STOP: 'OVERSLEEP_MISSED_STOP',
        OVERSLEEP_EMERGENCY: 'OVERSLEEP_MISSED_STOP',
        EARLY_UNSCHEDULED_EXIT: 'EARLY_EXIT',
        EMERGENCY: 'EMERGENCY',
      };
      const cat = catMap[entry.eventType];
      const targetRoll = activeStudentRef.current?.rollNumber;
      if (cat && targetRoll) {
        void excelService.notifyParentTelegram({ category: cat, studentRoll: targetRoll });
      }

      return entry;
    },
    [],
  );

  const verifyAndHotSwapKeys = useCallback(
    async (next: ApiKeysConfig): Promise<ApiIntegrationStatus> => {
      saveApiOverrides(next);
      setApiConfig(next);

      let gmOk = false;
      let gmErr: string | undefined;
      if (next.googleMapsApiKey.trim()) {
        const res = await verifyAndLoadGoogleMaps(next.googleMapsApiKey);
        gmOk = res.ok;
        gmErr = res.error;
      }

      const fbOk = await firebaseSyncService.connect(next);
      const notifOk = true;

      const nextStatus: ApiIntegrationStatus = {
        googleMapsMode: gmOk ? 'LIVE_GOOGLE_MAPS' : 'FALLBACK_LEAFLET_OSM',
        googleMapsVerified: gmOk,
        googleMapsError: gmErr,
        firebaseMode: fbOk ? 'LIVE_FIREBASE_RTDB' : 'LOCAL_REACTIVE_STORE',
        notificationMode: 'CONNECTED_WEBHOOK',
      };
      setApiStatus(nextStatus);

      pushToast(
        gmOk || fbOk || notifOk ? 'success' : 'info',
        'API Integration Settings Updated',
        gmOk
          ? 'Live Google Maps Platform active with Hyderabad traffic & Directions API.'
          : 'Fallback OpenStreetMap / Leaflet mode active (no restart required).',
      );

      return nextStatus;
    },
    [pushToast],
  );

  const resetApiConfigToEnv = useCallback(async () => {
    const base = clearApiOverrides();
    await verifyAndHotSwapKeys(base);
  }, [verifyAndHotSwapKeys]);

  // Initial key verification on boot if .env or localStorage already had keys
  useEffect(() => {
    let active = true;
    const initial = loadEffectiveApiConfig();
    if (!initial.googleMapsApiKey && !initial.firebaseApiKey) return;

    void (async () => {
      const gmRes = initial.googleMapsApiKey.trim()
        ? await verifyAndLoadGoogleMaps(initial.googleMapsApiKey)
        : { ok: false, error: undefined };
      const fbOk = await firebaseSyncService.connect(initial);
      if (!active) return;
      setApiStatus({
        googleMapsMode: gmRes.ok ? 'LIVE_GOOGLE_MAPS' : 'FALLBACK_LEAFLET_OSM',
        googleMapsVerified: gmRes.ok,
        googleMapsError: gmRes.error,
        firebaseMode: fbOk ? 'LIVE_FIREBASE_RTDB' : 'LOCAL_REACTIVE_STORE',
        notificationMode: 'CONNECTED_WEBHOOK',
      });
    })();

    return () => {
      active = false;
    };
  }, []);

  const activeBus = useMemo(() => {
    const rawBus = buses.find((b) => b.routeId === activeRouteId) ?? buses[0];
    if (tripDirection === 'EVENING_FROM_CAMPUS' && rawBus) {
      // Reverse stops for evening drop (SUH Campus -> ... -> Terminal)
      const campusStop = rawBus.stops.find((s) => s.areaClusterId === 'cluster-campus') || rawBus.stops[rawBus.stops.length - 1];
      const boardingStops = rawBus.stops.filter((s) => s.areaClusterId !== 'cluster-campus').slice().reverse();
      const eveningStops = [
        { ...campusStop, sequence: 1, scheduledEveningTime: '05:10 PM' },
        ...boardingStops.map((s, idx) => ({ ...s, sequence: idx + 2 })),
      ];
      return {
        ...rawBus,
        stops: eveningStops,
      };
    }
    return rawBus;
  }, [buses, activeRouteId, tripDirection]);

  const activeStudent = useMemo(() => {
    if (currentUser?.role === 'STUDENT' || currentUser?.role === 'PARENT') {
      const roll = (currentUser.wardRoll || currentUser.rollNumber || '').toUpperCase();
      if (roll) {
        const found = students.find((s) => s.rollNumber.toUpperCase() === roll);
        if (found) return found;
        const effectiveRoute = currentUser.wardRouteId || activeRouteId || 'route-51';
        const routeBus = buses.find((bus) => bus.routeId === effectiveRoute) || buses[0];
        const suppliedStop = currentUser.wardPickupStop || '';
        const effectivePickup = routeBus?.stops.find((stop) =>
          normalStopName(stop.name) === normalStopName(suppliedStop) ||
          normalStopName(stop.shortName) === normalStopName(suppliedStop) ||
          normalStopName(stop.id) === normalStopName(suppliedStop),
        )?.id || suppliedStop;
        return {
          id: `stu-${roll}`,
          rollNumber: roll,
          name: currentUser.wardName || currentUser.name || 'Student',
          program: '',
          routeId: effectiveRoute,
          pickupStopId: effectivePickup,
          defaultDropStopId: 'SNIST Main Bus Bay',
          alternateReturnStopId: null,
          boardingStatus: 'WAITING',
          checkInMethod: 'NONE',
          parentName: '',
          parentPhoneMasked: '',
          // Block actions until the authoritative profile finishes loading.
          passStatus: 'FEE_PENDING',
          gracePassActive: false,
          wakeUpAlarmEnabled: true,
          bleRssiDbm: -72,
          mustChangePassword: Boolean(currentUser.mustChangePassword),
        } as StudentRecord;
      }
    }
    return students.find((s) => s.id === activeStudentId) ?? students[0];
  }, [students, activeStudentId, currentUser, activeRouteId, buses]);

  useEffect(() => {
    activeStudentRef.current = activeStudent;
  }, [activeStudent]);

  // Real-time GPS safety watchdog: oversleep and early-exit detection for active commuters
  useEffect(() => {
    if (currentUser?.role === 'STUDENT' && activeStudent?.boardingStatus === 'ON_BOARD') {
      const dropStop =
        activeBus.stops.find((s) => s.id === activeStudent.defaultDropStopId) ||
        activeBus.stops[activeBus.stops.length - 1];
      if (dropStop) {
        commuteSafetyEngine.startStudentSafetyWatch(activeStudent, dropStop, activeBus.stops, {
          onWakeUpAlert: (stopName, dist) => {
            pushToast('info', 'Wake-Up Alarm', `Approaching ${stopName} (~${dist}m). Prepare to alight.`);
          },
          onOversleepAlert: (stopName) => {
            pushToast('warning', 'Missed Stop Alert', `You appear to have missed your stop at ${stopName}. Pull-over alert sent.`);
          },
          onEarlyExitAlert: (stopName) => {
            pushToast('info', 'Early Alight Recorded', `Unscheduled early exit recorded at ${stopName}.`);
          },
          getBusLocation: () => ({ lat: activeBus.currentLat, lng: activeBus.currentLng }),
        });
      }
    } else {
      commuteSafetyEngine.stopSafetyWatch();
    }
    return () => {
      commuteSafetyEngine.stopSafetyWatch();
    };
  }, [currentUser?.role, activeStudent?.boardingStatus, activeStudent?.defaultDropStopId, activeBus.stops]);

  const getBusOccupiedSeats = useCallback(
    (routeId: string) => {
      const base = BASELINE_OCCUPANCY[routeId] ?? 24;
      const sampleOnBoard = students.filter(
        (s) =>
          s.routeId === routeId &&
          (s.boardingStatus === 'ON_BOARD' || s.boardingStatus === 'OVERSLEPT'),
      ).length;
      const bus = buses.find((b) => b.routeId === routeId);
      return Math.min(bus?.capacity ?? 50, base + sampleOnBoard);
    },
    [students, buses],
  );

  // Active Destination Timer ETA calculation
  const activeStudentEtaSec = useMemo(() => {
    const bus = buses.find((b) => b.routeId === activeStudent.routeId) ?? activeBus;
    const targetStopId =
      tripDirection === 'MORNING_TO_CAMPUS'
        ? bus.stops[bus.stops.length - 1]?.id
        : activeStudent.alternateReturnStopId || activeStudent.defaultDropStopId;

    const targetIndex = bus.stops.findIndex((s) => s.id === targetStopId);
    const resolvedTargetIdx = targetIndex >= 0 ? targetIndex : bus.stops.length - 1;

    return calculateStopEtaSeconds(
      bus.currentLat,
      bus.currentLng,
      bus.stops,
      bus.currentStopIndex,
      resolvedTargetIdx,
      bus.speedKmh,
      bus.trafficDelayMinutes,
    );
  }, [buses, activeBus, activeStudent, tripDirection]);

  // Sync active bus telemetry to Firebase if connected
  useEffect(() => {
    if (apiStatus.firebaseMode === 'LIVE_FIREBASE_RTDB') {
      void firebaseSyncService.pushBusTelemetry(activeBus);
    }
  }, [activeBus, apiStatus.firebaseMode]);

  // 2-Minute Countdown Timer Ticker
  useEffect(() => {
    if (arrivalStage !== 'ARRIVED_2_MIN_TIMER') return;
    const timer = window.setInterval(() => {
      setTwoMinCountdownSec((prev) => {
        if (prev <= 1) {
          setArrivalStage('TIMER_EXPIRED');
          setStudents((curr) =>
            curr.map((st) =>
              st.id === activeStudentId && st.boardingStatus === 'WAITING'
                ? { ...st, boardingStatus: 'UNACCOUNTED' }
                : st,
            ),
          );
          audioSpeechService.speakDriverAnnouncement(
            '2 minute stop timer expired. Check unaccounted rider manifest before departing.',
            driverVoiceEnabled,
          );
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [arrivalStage, activeStudentId, driverVoiceEnabled]);

  // Campus TV Countdown Ticker
  useEffect(() => {
    const iv = window.setInterval(() => {
      setBuses((prev) =>
        prev.map((bus) => {
          if (bus.departureCountdownSec <= 0) return bus;
          const nextSec = Math.max(0, bus.departureCountdownSec - 1);
          return {
            ...bus,
            departureCountdownSec: nextSec,
            status:
              bus.status === 'BREAKDOWN_RESCUE_ACTIVE' ||
              bus.status === 'MERGED_EXAM_MODE' ||
              bus.status === 'REROUTED_SKIP_AREA'
                ? bus.status
                : nextSec === 0
                  ? 'DEPARTED'
                  : nextSec <= 240
                    ? 'FINAL_CALL'
                    : bus.status,
          };
        }),
      );
    }, 1000);
    return () => window.clearInterval(iv);
  }, []);

  // Step Bus Forward along non-bypassed stops
  const stepBusForward = useCallback(
    (targetRouteId?: string) => {
      const rId = targetRouteId || activeRouteId;
      setBuses((prev) =>
        prev.map((bus) => {
          if (bus.routeId !== rId) return bus;
          if (bus.status === 'BREAKDOWN_RESCUE_ACTIVE') return bus;

          let nextIdx = bus.currentStopIndex + 1;
          while (nextIdx < bus.stops.length && bus.stops[nextIdx].isBypassed) {
            nextIdx++;
          }
          if (nextIdx >= bus.stops.length) {
            nextIdx = 0; // loop back for continuous testing
          }

          const stop = bus.stops[nextIdx];
          const updated: BusVehicle = {
            ...bus,
            currentStopIndex: nextIdx,
            segmentProgress: 0,
            currentLat: stop.lat,
            currentLng: stop.lng,
            trafficDelayMinutes: Math.max(2, bus.trafficDelayMinutes - 1),
          };

          // Check 1 km wake-up alarm if active student is ON_BOARD and approaching drop stop
          const stu = students.find((s) => s.id === activeStudentId);
          if (
            stu &&
            stu.routeId === rId &&
            stu.boardingStatus === 'ON_BOARD' &&
            stu.wakeUpAlarmEnabled
          ) {
            const dropStopId = stu.alternateReturnStopId || stu.defaultDropStopId;
            const dropStop = bus.stops.find((s) => s.id === dropStopId);
            if (dropStop) {
              const distKm = haversineKm(stop.lat, stop.lng, dropStop.lat, dropStop.lng);
              if (distKm <= 1.6 && stop.id !== dropStop.id) {
                setWakeUpBannerStopName(dropStop.name);
                audioSpeechService.playWakeUpChime();
              }
            }
          }

          return updated;
        }),
      );
    },
    [activeRouteId, students, activeStudentId],
  );

  // Continuous Auto-Drive loop
  useEffect(() => {
    if (!autoDriveEnabled) return;
    const iv = window.setInterval(() => {
      setBuses((prev) =>
        prev.map((bus) => {
          if (bus.routeId !== activeRouteId || bus.status === 'BREAKDOWN_RESCUE_ACTIVE') {
            return bus;
          }
          let nextIdx = bus.currentStopIndex + 1;
          while (nextIdx < bus.stops.length && bus.stops[nextIdx].isBypassed) {
            nextIdx++;
          }
          if (nextIdx >= bus.stops.length) {
            nextIdx = 0;
          }
          const currStop = bus.stops[bus.currentStopIndex];
          const nextStop = bus.stops[nextIdx];
          if (!currStop || !nextStop) return bus;

          const newProg = bus.segmentProgress + 0.25;
          if (newProg >= 1) {
            return {
              ...bus,
              currentStopIndex: nextIdx,
              segmentProgress: 0,
              currentLat: nextStop.lat,
              currentLng: nextStop.lng,
            };
          }
          return {
            ...bus,
            segmentProgress: newProg,
            currentLat: currStop.lat + (nextStop.lat - currStop.lat) * newProg,
            currentLng: currStop.lng + (nextStop.lng - currStop.lng) * newProg,
          };
        }),
      );
    }, 1500);
    return () => window.clearInterval(iv);
  }, [autoDriveEnabled, activeRouteId]);

  const toggleAutoDrive = useCallback(() => {
    setAutoDriveEnabled((v) => !v);
  }, []);

  // Stage 1: 10-Min Pre-Arrival Heads-Up
  const triggerTenMinHeadsUp = useCallback(() => {
    const stu = students.find((s) => s.id === activeStudentId) ?? students[0];
    const bus = buses.find((b) => b.routeId === stu.routeId) ?? buses[0];
    const pickupIdx = bus.stops.findIndex((s) => s.id === stu.pickupStopId);
    const preIdx = Math.max(0, pickupIdx - 2);
    const preStop = bus.stops[preIdx];

    if (preStop) {
      setBuses((prev) =>
        prev.map((b) =>
          b.routeId === bus.routeId
            ? {
                ...b,
                currentStopIndex: preIdx,
                currentLat: preStop.lat,
                currentLng: preStop.lng,
              }
            : b,
        ),
      );
    }

    setArrivalStage('HEADS_UP_10_MIN');
    const pickupName = bus.stops[pickupIdx]?.name ?? 'your stop';
    void appendNotification({
      eventType: 'PRE_ARRIVAL_10M',
      recipient: 'STUDENT',
      recipientLabel: `${stu.name} (${stu.rollNumber})`,
      title: 'Stage 1: Bus 10 Minutes Away',
      message: `${bus.routeNumber} is ~10 mins from ${pickupName}. Confirm boarding or tap "Not Coming Today".`,
      channel: 'FCM_PUSH',
    });
    pushToast(
      'info',
      'Stage 1: 10-Min Pre-Arrival Heads-Up',
      `Sent to ${stu.name}. Early opt-outs unlock driver area skipping.`,
    );
  }, [students, activeStudentId, buses, appendNotification, pushToast]);

  // Stage 2: Stop Arrival (Start 2:00 Countdown Timer)
  const triggerStopArrivalTimer = useCallback(() => {
    const stu = students.find((s) => s.id === activeStudentId) ?? students[0];
    const bus = buses.find((b) => b.routeId === stu.routeId) ?? buses[0];
    const pickupIdx = bus.stops.findIndex((s) => s.id === stu.pickupStopId);
    const stop = bus.stops[pickupIdx >= 0 ? pickupIdx : 0];

    setBuses((prev) =>
      prev.map((b) =>
        b.routeId === bus.routeId && stop
          ? {
              ...b,
              currentStopIndex: pickupIdx >= 0 ? pickupIdx : 0,
              segmentProgress: 0,
              currentLat: stop.lat,
              currentLng: stop.lng,
            }
          : b,
      ),
    );
    setStudents((prev) =>
      prev.map((s) =>
        s.id === stu.id
          ? { ...s, boardingStatus: 'WAITING', checkInMethod: 'NONE' }
          : s,
      ),
    );
    setTwoMinCountdownSec(120);
    setArrivalStage('ARRIVED_2_MIN_TIMER');

    const pendingAtStop = students.filter(
      (s) => s.pickupStopId === stop?.id && s.boardingStatus !== 'NOT_COMING',
    ).length;

    audioSpeechService.speakDriverAnnouncement(
      `Approaching ${stop?.shortName ?? 'stop'}. ${pendingAtStop} student expected. 2 minute boarding timer started.`,
      driverVoiceEnabled,
    );

    // Broadcast authoritative stop timer to server so all students & driver devices sync
    void excelService.startStopTimer(stop?.name ?? 'Current Stop', 120);

    void appendNotification({
      eventType: 'STOP_ARRIVAL_2M',
      recipient: 'STUDENT',
      recipientLabel: `${stu.name} (${stop?.shortName ?? ''})`,
      title: 'Stage 2: Bus Arrived — 2:00 Timer Started',
      message: `${bus.routeNumber} entered the 150m geofence at ${stop?.name}. Walk to the single front gate or tap "Not Coming".`,
      channel: 'FCM_PUSH',
    });
    pushToast(
      'warning',
      `Arrived at ${stop?.shortName ?? 'Stop'}`,
      '2:00 latecomer countdown started on Student & Driver screens.',
    );
  }, [students, activeStudentId, buses, driverVoiceEnabled, appendNotification, pushToast]);

  const markStudentNotComing = useCallback(
    (studentId: string, note = 'Skipping today') => {
      const stu = students.find((s) => s.id === studentId || s.rollNumber.toUpperCase() === studentId.toUpperCase());
      if (!stu) return;
      setStudents((prev) =>
        prev.map((s) =>
          s.id === stu.id
            ? { ...s, boardingStatus: 'NOT_COMING', notComingNote: note }
            : s,
        ),
      );
      if (stu.id === activeStudentId) {
        setArrivalStage('CLEARED_SKIPPED');
        setTwoMinCountdownSec(0);
      }

      // Broadcast student stop opt-out to server
      void excelService.optOutStop(stu.routeId, note);

      audioSpeechService.speakDriverAnnouncement(
        `${stu.name} marked not coming. No wait needed.`,
        driverVoiceEnabled,
      );
      void appendNotification({
        eventType: 'NOT_COMING_OPT_OUT',
        recipient: 'DRIVER',
        recipientLabel: `Driver Console (${stu.routeId.toUpperCase()})`,
        title: 'Student Opted Out — Timer Cleared',
        message: `${stu.name} (${stu.rollNumber}) marked "Not Coming": ${note}.`,
        channel: 'DRIVER_VOICE_HUD',
      });
      // Record to master Excel (dev/simulation only)
      if (import.meta.env.DEV) {
        void excelService.recordEvent('Boarding_Attendance', {
          'Roll Number': stu.rollNumber,
          'Student Name': stu.name,
          'Route ID': stu.routeId,
          'Stop Name': stu.pickupStopId,
          'Event Type': 'NOT_COMING_OPT_OUT',
          'Check-In Method': 'APP_2MIN_TIMER_ACTION',
          Notes: note,
        });
      }

      pushToast(
        'info',
        'Opt-Out Synced to Driver',
        `${stu.name} marked "Not Coming" (${note}). Driver doesn't need to wait.`,
      );
    },
    [students, activeStudentId, driverVoiceEnabled, appendNotification, pushToast],
  );

  const performBoarding = useCallback(
    (studentId: string, method: 'BLE_PROXIMITY' | 'PHYSICAL_ID_CARD') => {
      const stu = students.find((s) => s.id === studentId || s.rollNumber.toUpperCase() === studentId.toUpperCase());
      if (!stu) return;

      if (stu.passStatus === 'FEE_PENDING' && !stu.gracePassActive) {
        pushToast(
          'danger',
          'Bus Pass Fee Compliance Hold',
          `${stu.name}'s semester bus pass is FEE_PENDING. Activate a 1-Day Grace Pass or simulate fee payment first.`,
        );
        return;
      }

      const nowStr = new Date().toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
      });

      setStudents((prev) =>
        prev.map((s) =>
          s.id === stu.id
            ? {
                ...s,
                boardingStatus: 'ON_BOARD',
                checkInMethod: method,
                bleRssiDbm: method === 'BLE_PROXIMITY' ? -44 : -90,
                boardedAtTime: nowStr,
              }
            : s,
        ),
      );
      if (studentId === activeStudentId) {
        setArrivalStage('CLEARED_BOARDED');
        setTwoMinCountdownSec(0);
      }

      const label =
        method === 'BLE_PROXIMITY'
          ? 'Single-Gate BLE Proximity'
          : 'Physical Sreenidhi ID Card Scan';

      audioSpeechService.speakDriverAnnouncement(
        `${stu.name} boarded via ${method === 'BLE_PROXIMITY' ? 'gate proximity' : 'ID card scan'}. Timer stopped.`,
        driverVoiceEnabled,
      );
      void appendNotification({
        eventType: 'BOARDED_CONFIRMED',
        recipient: 'STUDENT',
        recipientLabel: `${stu.name} (${stu.rollNumber})`,
        title: `${label} Verified`,
        message: `Boarded at ${nowStr}. Bus Pass: ${stu.gracePassActive ? '1-DAY GRACE' : stu.passStatus}. 2-min countdown cleared.`,
        channel: 'FCM_PUSH',
      });
      // Record to master Excel (dev/simulation only)
      if (import.meta.env.DEV) {
        void excelService.recordEvent('Boarding_Attendance', {
          'Roll Number': stu.rollNumber,
          'Student Name': stu.name,
          'Route ID': stu.routeId,
          'Stop Name': stu.pickupStopId,
          'Event Type': method === 'BLE_PROXIMITY' ? 'BOARDED_BLE' : 'BOARDED_ID_SCAN',
          'Check-In Method': method === 'BLE_PROXIMITY' ? 'BLE_PROXIMITY (-44 dBm)' : 'PHYSICAL_ID_SCAN',
          Notes: `Boarded at ${nowStr}. Pass: ${stu.gracePassActive ? '1-DAY GRACE PASS' : stu.passStatus}`,
        });
      }

      pushToast(
        'success',
        `Proximity Triggered: ${stu.name} Boarded`,
        `${label} verified (${stu.gracePassActive ? 'GRACE PASS' : stu.passStatus}). 2-min timer stopped.`,
      );
    },
    [students, activeStudentId, driverVoiceEnabled, appendNotification, pushToast],
  );

  const simulateGateProximityBoarding = useCallback(
    (studentId?: string) => {
      performBoarding(studentId || activeStudentId, 'BLE_PROXIMITY');
    },
    [performBoarding, activeStudentId],
  );

  const simulatePhysicalIdScan = useCallback(
    (queryOrStudentId?: string) => {
      const target =
        students.find(
          (s) =>
            s.id === queryOrStudentId ||
            s.rollNumber.toLowerCase() === (queryOrStudentId || '').toLowerCase(),
        ) ??
        students.find((s) => s.id === activeStudentId) ??
        students[0];
      performBoarding(target.id, 'PHYSICAL_ID_CARD');
    },
    [students, activeStudentId, performBoarding],
  );

  const toggleDriverGpsDropFailover = useCallback(
    (routeId?: string) => {
      const rId = routeId || activeRouteId;
      setBuses((prev) =>
        prev.map((bus) => {
          if (bus.routeId !== rId) return bus;
          const nextSource =
            bus.telemetrySource === 'DRIVER_PRIMARY'
              ? 'CROWD_SOURCED_STUDENTS'
              : 'DRIVER_PRIMARY';
          const onboardCount = Math.max(
            2,
            students.filter(
              (s) => s.routeId === rId && s.boardingStatus === 'ON_BOARD',
            ).length + 2,
          );
          pushToast(
            nextSource === 'CROWD_SOURCED_STUDENTS' ? 'warning' : 'success',
            nextSource === 'CROWD_SOURCED_STUDENTS'
              ? 'Driver GPS Dropped — Crowd-Sourced Failover Active'
              : 'Driver Primary GPS Restored',
            nextSource === 'CROWD_SOURCED_STUDENTS'
              ? `Live bus dot seamlessly switched to ${onboardCount} onboard student phones.`
              : 'Primary cabin tablet GPS telemetry locked.',
          );
          return {
            ...bus,
            telemetrySource: nextSource,
            crowdSourcedActiveCount: onboardCount,
          };
        }),
      );
    },
    [activeRouteId, students, pushToast],
  );

  const selectAlternateReturnStop = useCallback(
    (studentId: string, stopId: string | null) => {
      const stu = students.find((s) => s.id === studentId);
      const bus = buses.find((b) => b.routeId === (stu?.routeId || activeRouteId));
      const stop = bus?.stops.find((s) => s.id === stopId);
      setStudents((prev) =>
        prev.map((s) =>
          s.id === studentId ? { ...s, alternateReturnStopId: stopId } : s,
        ),
      );
      if (stop) {
        // Record to master Excel
        void excelService.recordEvent('Return_Trip_Changes', {
          'Roll Number': stu?.rollNumber || 'UNKNOWN',
          'Student Name': stu?.name || 'Student',
          'Route ID': stu?.routeId || activeRouteId,
          'Original Drop Stop': stu?.defaultDropStopId || 'Default Campus Stop',
          'Selected Alternate Stop': stop.name,
          'Parent Notification Status': 'DISPATCHED_SMS',
        });

        pushToast(
          'info',
          'Return Drop-Off Stop Updated',
          `${stu?.name ?? 'Student'} added extra drop-off at ${stop.name} on Driver's manifest.`,
        );
      }
    },
    [students, buses, activeRouteId, pushToast],
  );

  /* ---------------- Server-Authoritative Route Optimization ---------------- */
  const [routeOptimizationPlan, setRouteOptimizationPlan] = useState<any>(null);

  const applyOptimizationPlan = useCallback(
    async (plan: any) => {
      if (!plan) return;
      setRouteOptimizationPlan(plan);
      const rId = plan.routeId;
      const skippedClusterIds: string[] = Array.isArray(plan.skippedClusterIds)
        ? plan.skippedClusterIds
        : [];

      setBuses((prev) =>
        prev.map((b) => {
          const match =
            !rId ||
            b.routeId.toLowerCase().replace(/[^a-z0-9]/g, '') ===
              rId.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (!match) return b;

          const updatedStops = b.stops.map((s) => ({
            ...s,
            isBypassed:
              s.areaClusterId !== 'cluster-campus' &&
              skippedClusterIds.includes(s.areaClusterId),
          }));

          return {
            ...b,
            skippedClusterIds,
            stops: updatedStops,
            status:
              skippedClusterIds.length > 0
                ? 'REROUTED_SKIP_AREA'
                : b.status === 'REROUTED_SKIP_AREA'
                ? 'ON_ROUTE'
                : b.status,
          };
        }),
      );

      // Compute savings & shortcut path via OSRM
      const currentBuses = busesRef.current;
      const bus =
        currentBuses.find(
          (b) =>
            !rId ||
            b.routeId.toLowerCase().replace(/[^a-z0-9]/g, '') ===
              rId.toLowerCase().replace(/[^a-z0-9]/g, ''),
        ) || currentBuses[0];
      if (bus && bus.stops && bus.stops.length > 0) {
        try {
          const savings = await osrmRoutingService.computeOptimizationSavings(
            bus.stops,
            skippedClusterIds,
          );
          setBuses((prev) =>
            prev.map((b) => {
              const match =
                !rId ||
                b.routeId.toLowerCase().replace(/[^a-z0-9]/g, '') ===
                  rId.toLowerCase().replace(/[^a-z0-9]/g, '');
              if (!match) return b;
              return {
                ...b,
                shortcutPath:
                  skippedClusterIds.length > 0
                    ? savings.optimizedCoordinates
                    : undefined,
              };
            }),
          );
          if (skippedClusterIds.length > 0 && (savings.savedMinutes > 0 || savings.savedKm > 0)) {
            setFuelRoi({
              totalKmBypassed: Number((INITIAL_FUEL_ROI.totalKmBypassed + savings.savedKm).toFixed(1)),
              totalMinutesSaved: INITIAL_FUEL_ROI.totalMinutesSaved + savings.savedMinutes,
              dieselLitersSaved: Number((INITIAL_FUEL_ROI.dieselLitersSaved + savings.savedDieselLiters).toFixed(1)),
              rupeesSaved: INITIAL_FUEL_ROI.rupeesSaved + savings.savedRupees,
              areasSkippedCount: skippedClusterIds.length,
            });
          } else {
            setFuelRoi(INITIAL_FUEL_ROI);
          }
        } catch (err) {
          console.warn('Failed to compute route optimization geometry:', err);
        }
      }
    },
    [],
  );

  const applyOptimizationPlanRef = useRef(applyOptimizationPlan);
  applyOptimizationPlanRef.current = applyOptimizationPlan;

  const setAbsenceTomorrow = useCallback(
    async (
      studentRoll: string,
      notComing: boolean,
      day?: 'TODAY' | 'TOMORROW',
    ): Promise<{ success: boolean; error?: string; locked?: boolean }> => {
      const res = await excelService.setAbsenceTomorrow(notComing, studentRoll, day);
      if (res.ok) {
        setStudents((prev) =>
          prev.map((s) =>
            s.rollNumber.toUpperCase() === studentRoll.toUpperCase()
              ? {
                  ...s,
                  boardingStatus: notComing ? 'NOT_COMING' : 'WAITING',
                  notComingNote: notComing ? 'Not Travelling Tomorrow' : undefined,
                }
              : s,
          ),
        );
        if (res.routePlan) {
          applyOptimizationPlan(res.routePlan);
        }
        pushToast(
          'info',
          notComing ? 'Marked Not Travelling Tomorrow' : 'Marked Travelling Tomorrow',
          notComing
            ? 'Driver and transport office will not expect you at the stop tomorrow.'
            : 'You are registered for tomorrow’s morning run.',
        );
        return { success: true };
      } else {
        const errorMsg =
          res.error ||
          (res.status === 409
            ? 'Cutoff passed (1 hour before bus departure). Contact the Transport Office for urgent updates.'
            : 'Failed to update absence');
        pushToast('danger', 'Absence Update Failed', errorMsg);
        return { success: false, error: errorMsg, locked: res.status === 409 };
      }
    },
    [applyOptimizationPlan, pushToast],
  );

  const setClusterOptimizationOverride = useCallback(
    async (routeId: string, clusterId: string, keep: boolean) => {
      const action = keep ? 'OVERRIDE_KEEP_CLUSTER' : 'CLEAR_OVERRIDE';
      const res = await excelService.controlRouteOptimization(routeId, action, clusterId);
      if (res.success && res.plan) {
        applyOptimizationPlan(res.plan);
        pushToast(
          'success',
          'Override Updated',
          `Cluster ${clusterId} override set to ${keep ? 'FORCE KEEP' : 'AUTO'}.`,
        );
      } else {
        pushToast('danger', 'Override Failed', res.error || 'Failed to update cluster override');
      }
      return res;
    },
    [applyOptimizationPlan, pushToast],
  );

  const toggleRoutePlanLock = useCallback(
    async (routeId: string, lock: boolean) => {
      const action = lock ? 'LOCK' : 'UNLOCK';
      const res = await excelService.controlRouteOptimization(routeId, action);
      if (res.success && res.plan) {
        applyOptimizationPlan(res.plan);
        pushToast(
          'info',
          lock ? 'Route Plan Locked' : 'Route Plan Unlocked',
          `Route ${routeId} plan for tomorrow is now ${lock ? 'locked (1h pre-departure cutoff)' : 'unlocked'}.`,
        );
      } else {
        pushToast('danger', 'Lock Failed', res.error || 'Failed to toggle route plan lock');
      }
      return res;
    },
    [applyOptimizationPlan, pushToast],
  );

  const simulateAreaOptOutAndSkip = useCallback(
    async (requestedClusterId?: string) => {
      const bus = buses.find((b) => b.routeId === activeRouteId) ?? buses[0];
      // Default to Uppal–Boduppal or Habsiguda–Nacharam cluster
      const clusterId =
        requestedClusterId ||
        bus.stops.find(
          (s) =>
            !s.isBypassed &&
            s.areaClusterId !== 'cluster-campus' &&
            s.sequence > bus.currentStopIndex + 1,
        )?.areaClusterId ||
        'cluster-habsi-nacharam';

      const targetStops = bus.stops.filter((s) => s.areaClusterId === clusterId);
      if (targetStops.length === 0) return;

      const targetStopIds = new Set(targetStops.map((s) => s.id));
      const clusterName = targetStops[0].areaClusterName;

      // Mark all students in this cluster as NOT_COMING
      setStudents((prev) =>
        prev.map((s) =>
          s.routeId === bus.routeId && targetStopIds.has(s.pickupStopId)
            ? {
                ...s,
                boardingStatus: 'NOT_COMING',
                notComingNote: 'Area Opt-Out Bypass',
              }
            : s,
        ),
      );

      const updatedStops = bus.stops.map((s) =>
        targetStopIds.has(s.id) ? { ...s, isBypassed: true } : s,
      );
      const result = await computeBypassDirections(updatedStops, targetStops);

      setBuses((prev) =>
        prev.map((b) =>
          b.routeId === bus.routeId
            ? {
                ...b,
                status: 'REROUTED_SKIP_AREA',
                skippedClusterIds: Array.from(
                  new Set([...b.skippedClusterIds, clusterId]),
                ),
                stops: updatedStops,
                shortcutPath: result.shortcutPoints,
                trafficDelayMinutes: Math.max(
                  0,
                  b.trafficDelayMinutes - result.minutesSaved,
                ),
              }
            : b,
        ),
      );

      const liters = Number((result.kmSaved * 0.25).toFixed(2));
      const rupees = Math.round(liters * 97.5);
      setFuelRoi((prev) => ({
        totalKmBypassed: Number((prev.totalKmBypassed + result.kmSaved).toFixed(1)),
        totalMinutesSaved: prev.totalMinutesSaved + result.minutesSaved,
        dieselLitersSaved: Number((prev.dieselLitersSaved + liters).toFixed(1)),
        rupeesSaved: prev.rupeesSaved + rupees,
        areasSkippedCount: prev.areasSkippedCount + 1,
      }));

      audioSpeechService.speakDriverAnnouncement(
        `${clusterName} empty. Rerouting via highway bypass, saving ${result.minutesSaved} minutes.`,
        driverVoiceEnabled,
      );
      void appendNotification({
        eventType: 'AREA_SKIP_REROUTE',
        recipient: 'ALL_FLEET',
        recipientLabel: `${bus.routeNumber} (${clusterName})`,
        title: `Area Skipped — ${result.kmSaved} km & ${result.minutesSaved} mins Saved`,
        message: `All riders opted out in ${clusterName}. ${result.usedLiveGoogleDirections ? 'Google Directions API' : 'Highway shortcut'} bypass applied.`,
        channel: 'DRIVER_VOICE_HUD',
      });
      pushToast(
        'success',
        `Bypass Active: Skipped ${clusterName}`,
        `Saved ${result.kmSaved} km, ${result.minutesSaved} mins, and ~₹${rupees} diesel.`,
      );
    },
    [buses, activeRouteId, driverVoiceEnabled, appendNotification, pushToast],
  );

  const simulateEarlyMetroExit = useCallback(
    (requestedStopId?: string) => {
      const stu = students.find((s) => s.id === activeStudentId) ?? students[0];
      const bus = buses.find((b) => b.routeId === stu.routeId) ?? buses[0];
      const metroStop =
        bus.stops.find((s) => s.id === requestedStopId) ??
        bus.stops.find((s) => Boolean(s.metroInterchange) && s.id !== stu.defaultDropStopId) ??
        bus.stops[4] ??
        bus.stops[0];

      const stopIdx = bus.stops.findIndex((s) => s.id === metroStop.id);
      const timeStr = new Date().toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
      });

      setBuses((prev) =>
        prev.map((b) =>
          b.routeId === bus.routeId
            ? {
                ...b,
                currentStopIndex: stopIdx >= 0 ? stopIdx : b.currentStopIndex,
                currentLat: metroStop.lat,
                currentLng: metroStop.lng,
              }
            : b,
        ),
      );
      setStudents((prev) =>
        prev.map((s) =>
          s.id === stu.id
            ? { ...s, boardingStatus: 'ALIGHTED_EARLY', bleRssiDbm: -99 }
            : s,
        ),
      );
      setArrivalStage('IDLE');

      void appendNotification({
        eventType: 'EARLY_UNSCHEDULED_EXIT',
        recipient: 'PARENT',
        recipientLabel: `${stu.parentName} (${stu.parentPhoneMasked})`,
        title: `Early Deboarding Alert — ${metroStop.shortName}`,
        message: `Sreenidhi Express Safety Alert: ${stu.name} (${stu.rollNumber}) got off ${bus.routeNumber} at ${metroStop.name} at ${timeStr} instead of their regular stop (${bus.stops.find((x) => x.id === stu.defaultDropStopId)?.shortName ?? 'Assigned Stop'}).`,
        channel: 'WHATSAPP_SMS_WEBHOOK',
        phoneNumber: stu.parentPhoneMasked,
      });

      pushToast(
        'warning',
        `Parent Notified: Early Exit at ${metroStop.shortName}`,
        `BLE disconnect + stationary GPS verified. SMS/WhatsApp logged for ${stu.parentName}.`,
      );
    },
    [students, activeStudentId, buses, appendNotification, pushToast],
  );

  const simulateOversleepMissedStop = useCallback(() => {
    const stu = students.find((s) => s.id === activeStudentId) ?? students[0];
    const bus = buses.find((b) => b.routeId === stu.routeId) ?? buses[0];
    const dropStopId = stu.alternateReturnStopId || stu.defaultDropStopId;
    const dropIdx = bus.stops.findIndex((s) => s.id === dropStopId);
    const pastIdx = Math.min(bus.stops.length - 1, (dropIdx >= 0 ? dropIdx : 2) + 1);
    const dropStop = bus.stops[dropIdx >= 0 ? dropIdx : 2];
    const pastStop = bus.stops[pastIdx];

    setTripDirection('EVENING_FROM_CAMPUS');
    setBuses((prev) =>
      prev.map((b) =>
        b.routeId === bus.routeId && pastStop
          ? {
              ...b,
              currentStopIndex: pastIdx,
              currentLat: pastStop.lat,
              currentLng: pastStop.lng,
            }
          : b,
      ),
    );
    setStudents((prev) =>
      prev.map((s) =>
        s.id === stu.id
          ? {
              ...s,
              boardingStatus: 'OVERSLEPT',
              bleRssiDbm: -45,
              checkInMethod: s.checkInMethod === 'NONE' ? 'BLE_PROXIMITY' : s.checkInMethod,
            }
          : s,
      ),
    );

    audioSpeechService.playOversleepEmergencyAlarm();
    audioSpeechService.speakDriverAnnouncement(
      `Emergency oversleep alert! ${stu.name} missed ${dropStop?.shortName ?? 'stop'} and is still on board. Pull over safely.`,
      driverVoiceEnabled,
    );

    void appendNotification({
      eventType: 'OVERSLEEP_EMERGENCY',
      recipient: 'PARENT',
      recipientLabel: `${stu.parentName} (${stu.parentPhoneMasked})`,
      title: `URGENT: Missed Stop Oversleep Alert — ${stu.name}`,
      message: `${stu.name} remained on board ${bus.routeNumber} >250m past ${dropStop?.name ?? 'assigned stop'}. Driver alerted to halt safely near ${pastStop?.shortName ?? 'next bay'}.`,
      channel: 'WHATSAPP_SMS_WEBHOOK',
      phoneNumber: stu.parentPhoneMasked,
    });
    pushToast(
      'danger',
      `OVERSLEEP ALERT: ${stu.name} Missed ${dropStop?.shortName ?? 'Stop'}!`,
      'Simultaneous Student alarm, Driver pull-over banner, and Parent alert fired.',
    );
  }, [students, activeStudentId, buses, driverVoiceEnabled, appendNotification, pushToast]);

  const confirmOversleepSafeDropOff = useCallback(() => {
    const oversleepers = students.filter((s) => s.boardingStatus === 'OVERSLEPT');
    if (oversleepers.length === 0) return;

    setStudents((prev) =>
      prev.map((s) =>
        s.boardingStatus === 'OVERSLEPT'
          ? { ...s, boardingStatus: 'ALIGHTED_SAFE', bleRssiDbm: -99 }
          : s,
      ),
    );

    oversleepers.forEach((stu) => {
      void appendNotification({
        eventType: 'BOARDED_CONFIRMED',
        recipient: 'PARENT',
        recipientLabel: `${stu.parentName} (${stu.parentPhoneMasked})`,
        title: `Safe Drop-Off Confirmed — ${stu.name}`,
        message: `Driver confirmed ${stu.name} has safely alighted from the bus after oversleep alert.`,
        channel: 'WHATSAPP_SMS_WEBHOOK',
        phoneNumber: stu.parentPhoneMasked,
      });
    });

    pushToast(
      'success',
      'Student Safely Dropped Off',
      'Oversleep alarm cleared and confirmation sent to parents.',
    );
  }, [students, appendNotification, pushToast]);

  const reportLostItem = useCallback(
    (
      itemType: LostItemReport['itemType'],
      seatZone: string,
      studentId?: string,
    ) => {
      const stu = students.find((s) => s.id === (studentId || activeStudentId)) ?? students[0];
      const report: LostItemReport = {
        id: `lost-${Date.now()}`,
        studentId: stu.id,
        studentName: stu.name,
        routeId: stu.routeId,
        itemType,
        seatZone,
        reportedAt: new Date().toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        acknowledgedByDriver: false,
      };
      setLostItems((prev) => [report, ...prev]);

      audioSpeechService.speakDriverAnnouncement(
        `Lost item alert. ${stu.name} reported ${itemType} left near ${seatZone}.`,
        driverVoiceEnabled,
      );
      void appendNotification({
        eventType: 'LOST_ITEM_PING',
        recipient: 'DRIVER',
        recipientLabel: `Driver (${stu.routeId.toUpperCase()})`,
        title: `Lost Item Ping: ${itemType}`,
        message: `${stu.name} (${stu.rollNumber}) left ${itemType} in ${seatZone}. Check before depot.`,
        channel: 'DRIVER_VOICE_HUD',
      });
      // Record to master Excel
      void excelService.recordEvent('Lost_Item_Claims', {
        'Claim ID': report.id,
        'Roll Number': stu.rollNumber,
        'Student Name': stu.name,
        'Route ID': stu.routeId,
        'Item Type': itemType,
        'Seat Zone': seatZone,
        Status: 'PENDING_DRIVER_CHECK',
      });

      pushToast(
        'warning',
        'Lost Item Ping Sent to Driver',
        `${itemType} (${seatZone}) flagged on Driver Console.`,
      );
    },
    [students, activeStudentId, driverVoiceEnabled, appendNotification, pushToast],
  );

  const acknowledgeLostItem = useCallback(
    (itemId: string) => {
      setLostItems((prev) =>
        prev.map((item) =>
          item.id === itemId ? { ...item, acknowledgedByDriver: true } : item,
        ),
      );
      pushToast('success', 'Lost Item Secured', 'Student notified that the driver found & secured the item.');
    },
    [pushToast],
  );

  const triggerBreakdownAndRescue = useCallback(
    (targetRouteId?: string) => {
      const rId = targetRouteId || activeRouteId;
      const brokenBus = buses.find((b) => b.routeId === rId) ?? buses[0];
      // Find trailing bus with most spare capacity (prefer Route 15 or Route 18)
      const candidates = buses
        .filter((b) => b.routeId !== brokenBus.routeId && b.status !== 'BREAKDOWN_RESCUE_ACTIVE')
        .map((b) => ({
          bus: b,
          spareSeats: b.capacity - getBusOccupiedSeats(b.routeId),
        }))
        .sort((a, b) => b.spareSeats - a.spareSeats);

      const rescue = candidates[0]?.bus ?? buses[1];
      const rescueEta = rescue.routeId === 'route-15' ? 12 : 16;

      // Move broken bus near Narapally/Ghatkesar highway stretch
      const highwayStop =
        brokenBus.stops.find((s) => s.shortName.includes('Narapally')) ??
        brokenBus.stops[Math.max(0, brokenBus.stops.length - 2)];

      setBuses((prev) =>
        prev.map((b) =>
          b.routeId === brokenBus.routeId
            ? {
                ...b,
                status: 'BREAKDOWN_RESCUE_ACTIVE',
                speedKmh: 0,
                currentLat: highwayStop?.lat ?? b.currentLat,
                currentLng: highwayStop?.lng ?? b.currentLng,
                rescueAssignedRouteId: rescue.routeId,
                rescueEtaMinutes: rescueEta,
              }
            : b,
        ),
      );

      audioSpeechService.speakDriverAnnouncement(
        `Breakdown protocol activated. Rescue ${rescue.routeNumber} paired, arriving in ${rescueEta} minutes.`,
        driverVoiceEnabled,
      );
      void appendNotification({
        eventType: 'BREAKDOWN_RESCUE',
        recipient: 'ALL_FLEET',
        recipientLabel: `${brokenBus.routeNumber} → Rescue ${rescue.routeNumber}`,
        title: `Breakdown Rescue Paired (${rescue.routeNumber})`,
        message: `${brokenBus.routeNumber} halted near ${highwayStop?.name ?? 'Ghatkesar Hwy'}. Trailing ${rescue.routeNumber} (${candidates[0]?.spareSeats ?? 14} empty seats) arriving in ${rescueEta} mins. Parents & waiting students notified.`,
        channel: 'WHATSAPP_SMS_WEBHOOK',
      });
      pushToast(
        'danger',
        `Breakdown Protocol: ${rescue.routeNumber} Dispatched`,
        `Rescue bus arrives in ${rescueEta} mins with ${candidates[0]?.spareSeats ?? 14} spare seats.`,
      );
    },
    [activeRouteId, buses, getBusOccupiedSeats, driverVoiceEnabled, appendNotification, pushToast],
  );

  const clearBreakdownStatus = useCallback(
    (targetRouteId?: string) => {
      const rId = targetRouteId || activeRouteId;
      setBuses((prev) =>
        prev.map((b) =>
          b.routeId === rId
            ? {
                ...b,
                status: 'ON_ROUTE',
                speedKmh: 34,
                rescueAssignedRouteId: null,
                rescueEtaMinutes: null,
              }
            : b,
        ),
      );
      pushToast('success', 'Bus Restored to Normal Service', 'Breakdown rescue flag cleared.');
    },
    [activeRouteId, pushToast],
  );

  const swapDriverViaWindshieldQr = useCallback(
    (routeId: string, substituteName: string) => {
      const cleanName = substituteName.trim() || 'Sub. Driver Ramesh Babu';
      setActiveRouteId(routeId);
      setBuses((prev) =>
        prev.map((b) =>
          b.routeId === routeId ? { ...b, driverName: cleanName } : b,
        ),
      );
      audioSpeechService.speakDriverAnnouncement(
        `Windshield QR verified. Loaded ${routeId.replace('-', ' ')} manifest for ${cleanName}.`,
        driverVoiceEnabled,
      );
      pushToast(
        'success',
        'Windshield QR Swap Complete',
        `Console synced to ${routeId.toUpperCase()} for ${cleanName}.`,
      );
    },
    [driverVoiceEnabled, pushToast],
  );

  const toggleBusPassFeeLock = useCallback(
    (studentId?: string) => {
      const targetId = studentId || activeStudentId;
      setStudents((prev) =>
        prev.map((s) => {
          if (s.id !== targetId) return s;
          const nextPass = s.passStatus === 'FEE_PENDING' ? 'ACTIVE' : 'FEE_PENDING';
          pushToast(
            nextPass === 'FEE_PENDING' ? 'warning' : 'success',
            nextPass === 'FEE_PENDING'
              ? `Bus Pass Locked: ${s.name}`
              : `Bus Pass Active: ${s.name}`,
            nextPass === 'FEE_PENDING'
              ? 'Live map & boarding gated behind fee compliance screen.'
              : 'Fee compliance verified; full tracking unlocked.',
          );
          return {
            ...s,
            passStatus: nextPass,
            gracePassActive: nextPass === 'ACTIVE' ? false : s.gracePassActive,
          };
        }),
      );
    },
    [activeStudentId, pushToast],
  );

  const activateGracePass = useCallback(
    (studentId?: string) => {
      const targetId = studentId || activeStudentId;
      setStudents((prev) =>
        prev.map((s) =>
          s.id === targetId ? { ...s, gracePassActive: true } : s,
        ),
      );
      pushToast(
        'info',
        '1-Day Emergency Grace Pass Activated',
        'Student granted 24h temporary tracking & boarding access; Admin notified.',
      );
    },
    [activeStudentId, pushToast],
  );

  const simulateFeePayment = useCallback(
    (studentId?: string) => {
      const targetId = studentId || activeStudentId;
      setStudents((prev) =>
        prev.map((s) =>
          s.id === targetId
            ? { ...s, passStatus: 'ACTIVE', gracePassActive: false }
            : s,
        ),
      );
      pushToast(
        'success',
        'Semester Transport Fee Paid',
        'Digital Sreenidhi Bus Pass upgraded to ACTIVE.',
      );
    },
    [activeStudentId, pushToast],
  );

  const toggleWakeUpAlarmPreference = useCallback((studentId: string) => {
    setStudents((prev) =>
      prev.map((s) =>
        s.id === studentId ? { ...s, wakeUpAlarmEnabled: !s.wakeUpAlarmEnabled } : s,
      ),
    );
  }, []);

  const setScheduleMode = useCallback(
    (mode: ScheduleMode) => {
      setScheduleModeState(mode);
      setBuses((prev) =>
        prev.map((b) => {
          if (mode === 'EXAM_HALF_DAY') {
            if (b.routeId === 'route-22') {
              return {
                ...b,
                status: 'MERGED_EXAM_MODE',
                campusParkingBay: 'Merged → Bay 15',
                departureCountdownSec: 180,
              };
            }
            return {
              ...b,
              status: b.status === 'BREAKDOWN_RESCUE_ACTIVE' ? b.status : 'BOARDING_AT_BAY',
              departureCountdownSec: 210,
            };
          }
          if (mode === 'FEST_EVENTS') {
            return {
              ...b,
              status: 'BOARDING_AT_BAY',
              departureCountdownSec: 900,
              campusParkingBay: `Fest Shuttle ${b.campusParkingBay.split(' ')[0]} ${b.routeNumber.split(' ')[1]}`,
            };
          }
          const orig = INITIAL_BUS_FLEET.find((o) => o.routeId === b.routeId);
          return {
            ...b,
            status: 'ON_ROUTE',
            campusParkingBay: orig?.campusParkingBay ?? b.campusParkingBay,
            departureCountdownSec: orig?.departureCountdownSec ?? 360,
          };
        }),
      );

      const modeLabel =
        mode === 'EXAM_HALF_DAY'
          ? 'Mid-Term / Semester Exam Half-Day Mode (1:15 PM Departure, Route 22 Merged)'
          : mode === 'FEST_EVENTS'
            ? 'Campus Fest / Sreenidhi ASCEND Mode (Late 6:30 PM Evening Shuttles)'
            : 'Regular Campus Schedule (08:45 AM / 04:15 PM)';

      void appendNotification({
        eventType: 'SCHEDULE_MODE_BROADCAST',
        recipient: 'ALL_FLEET',
        recipientLabel: 'All Sreenidhi Students & Parents',
        title: `Schedule Mode Switched: ${mode}`,
        message: `Admin activated ${modeLabel}. Campus TV boards & bays updated automatically.`,
        channel: 'FCM_PUSH',
      });
      pushToast('info', 'Fleet Schedule Mode Updated', modeLabel);
    },
    [appendNotification, pushToast],
  );

  const addRouteStop = useCallback(
    (routeId: string, stop: Omit<RouteStop, 'id' | 'sequence'>) => {
      setBuses((prev) =>
        prev.map((b) => {
          if (b.routeId !== routeId) return b;
          const newStop: RouteStop = {
            ...stop,
            id: `${routeId}-s${b.stops.length + 1}-${Date.now().toString().slice(-3)}`,
            sequence: b.stops.length + 1,
          };
          return { ...b, stops: [...b.stops, newStop] };
        }),
      );
      pushToast('success', 'Stop Added to Route', `${stop.name} added to geofence registry.`);
    },
    [pushToast],
  );

  const updateCampusParkingBay = useCallback(
    (routeId: string, row: string, bay: string) => {
      setBuses((prev) =>
        prev.map((b) =>
          b.routeId === routeId
            ? { ...b, campusParkingRow: row, campusParkingBay: bay }
            : b,
        ),
      );
      pushToast('success', 'Campus Bay Reassigned', `Updated to ${row}, ${bay} on Lobby TV Board.`);
    },
    [pushToast],
  );

  const resetDemoState = useCallback(() => {
    setBuses(structuredClone(INITIAL_BUS_FLEET));
    setStudents(structuredClone(INITIAL_STUDENTS));
    setNotifications(INITIAL_NOTIFICATION_LOGS);
    setLostItems([]);
    setFuelRoi(INITIAL_FUEL_ROI);
    setAutoDriveEnabled(false);
    setArrivalStage('IDLE');
    setTwoMinCountdownSec(120);
    setScheduleModeState('REGULAR');
    setWakeUpBannerStopName(null);
    pushToast('info', 'Simulation Reset', 'All Sreenidhi routes, timers & safety feeds restored.');
  }, [pushToast]);

  const toggleMobilePreviewFrame = useCallback(() => {
    setMobilePreviewFrame((prev) => {
      const next = !prev;
      if (!next && !isMobileViewport) {
        setIsSimDrawerOpen(false);
      }
      return next;
    });
    void nativeDeviceService.triggerHaptic('light');
  }, [isMobileViewport]);

  const toggleLivePhoneGps = useCallback(async (): Promise<boolean> => {
    if (livePhoneGpsActive) {
      gpsStopWatchRef.current?.();
      gpsStopWatchRef.current = null;
      setLivePhoneGpsActive(false);
      pushToast('info', 'Phone GPS Stream Stopped', 'Returned to route simulator telemetry.');
      return true;
    }

    setLivePhoneGpsActive(true);
    void nativeDeviceService.triggerHaptic('medium');
    let setupFailed = false;
    const stopFn = await nativeDeviceService.watchLiveGps(
      (lat, lng, speedKmh) => {
        setBuses((prev) =>
          prev.map((b) =>
            b.routeId === activeRouteId
              ? { ...b, currentLat: lat, currentLng: lng, speedKmh }
              : b,
          ),
        );

        void firebaseService.publishBusTelemetry(activeRouteId, {
          routeId: activeRouteId,
          lat,
          lng,
          speedKmh,
          currentStopIndex: activeBus.currentStopIndex,
          status: activeBus.status,
          flyoverBypassActive: activeBus.flyoverBypassActive,
          skippedClusterIds: activeBus.skippedClusterIds,
          telemetrySource: 'DRIVER_PRIMARY',
          updatedAt: Date.now(),
        });

        void excelService.sendBusTelemetry({
          routeId: activeRouteId,
          lat,
          lng,
          speedKmh,
          stopIndex: activeBus.currentStopIndex,
          source: 'DRIVER_PRIMARY',
          timestamp: Date.now(),
        });
      },
      (errMsg) => {
        setupFailed = true;
        gpsStopWatchRef.current?.();
        gpsStopWatchRef.current = null;
        setLivePhoneGpsActive(false);
        pushToast('warning', 'Device GPS Notice', errMsg);
      },
    );
    if (setupFailed) {
      stopFn();
      return false;
    }
    gpsStopWatchRef.current = stopFn;
    pushToast(
      'success',
      'Live Phone GPS Active',
      `Streaming device coordinates for ${activeRouteId.toUpperCase()}.`,
    );
    return true;
  }, [livePhoneGpsActive, activeRouteId, activeBus, pushToast]);

  // Real-time server SSE bus location and telemetry subscription for students, parents, drivers and admins
  const [isBusLocationStale, setIsBusLocationStale] = useState<boolean>(false);

  useEffect(() => {
    if (!currentUser || !['STUDENT', 'PARENT', 'DRIVER', 'ADMIN'].includes(currentUser.role) || !excelService.getAuthToken()) return;
    const route = activeRouteId || 'route-51';
    const unsub = excelService.subscribeBusLiveStream(
      route,
      (t: any) => {
        if (!t || !t.routeId) return;
        setIsBusLocationStale(false);
        setBuses((prev) =>
          prev.map((b) =>
            b.routeId === t.routeId
              ? {
                  ...b,
                  currentLat: t.lat,
                  currentLng: t.lng,
                  speedKmh: typeof t.speedKmh === 'number' ? t.speedKmh : b.speedKmh,
                  currentStopIndex: typeof t.currentStopIndex === 'number' ? t.currentStopIndex : b.currentStopIndex,
                  trafficDelayMinutes: typeof t.delayMinutes === 'number' ? t.delayMinutes : b.trafficDelayMinutes,
                  flyoverBypassActive: t.flyoverBypassActive === true,
                }
              : b,
          ),
        );
      },
      (statusEvt: any) => {
        if (statusEvt.type === 'BUS_STALE') {
          setIsBusLocationStale(true);
        } else if (statusEvt.type === 'BUS_RECOVERED') {
          setIsBusLocationStale(false);
        } else if (statusEvt.type === 'BUS_DELAY') {
          const delay = Number(statusEvt.data?.delayMinutes) || 0;
          setBuses((prev) =>
            prev.map((b) =>
              b.routeId === (statusEvt.data?.routeId || route)
                ? { ...b, trafficDelayMinutes: delay }
                : b,
            ),
          );
        } else if (statusEvt.type === 'BUS_TRIP') {
          const running = Boolean(statusEvt.data?.running);
          setBuses((prev) =>
            prev.map((b) =>
              b.routeId === (statusEvt.data?.routeId || route)
                ? { ...b, status: running ? 'ON_ROUTE' : 'BOARDING_AT_BAY' }
                : b,
            ),
          );
        } else if (statusEvt.type === 'STOP_BOARDED') {
          const count = Number(statusEvt.data?.headcount) || 0;
          setBuses((prev) =>
            prev.map((b) =>
              b.routeId === (statusEvt.data?.routeId || route)
                ? { ...b, boardedCount: count }
                : b,
            ),
          );
        } else if (statusEvt.type === 'STOP_TIMER_STARTED') {
          const duration = Number(statusEvt.data?.durationSeconds) || 120;
          setTwoMinCountdownSec(duration);
          setArrivalStage('ARRIVED_2_MIN_TIMER');
        } else if (statusEvt.type === 'STOP_TIMER_CLEARED') {
          setTwoMinCountdownSec(0);
          setArrivalStage('IDLE');
        } else if (statusEvt.type === 'STUDENT_BOARDED') {
          const roll = statusEvt.data?.rollNumber;
          const evtRouteId = statusEvt.data?.routeId;
          const nextHeadcount = statusEvt.data?.headcount;
          if (typeof nextHeadcount === 'number' && evtRouteId) {
            setBuses((prev) =>
              prev.map((b) => (b.routeId === evtRouteId ? { ...b, boardedCount: nextHeadcount } : b))
            );
          }
          if (roll) {
            setStudents((prev) =>
              prev.map((s) =>
                s.rollNumber.toUpperCase() === roll.toUpperCase()
                  ? { ...s, boardingStatus: 'ON_BOARD', checkInMethod: statusEvt.data?.method || 'STUDENT_SELF_TAP' }
                  : s
              )
            );
            if (activeStudentRef.current?.rollNumber.toUpperCase() === roll.toUpperCase()) {
              setArrivalStage('CLEARED_ON_BOARD');
              setTwoMinCountdownSec(0);
            }
          }
        } else if (statusEvt.type === 'STUDENT_OPT_OUT') {
          const roll = statusEvt.data?.rollNumber;
          if (roll) {
            setStudents((prev) =>
              prev.map((s) =>
                s.rollNumber.toUpperCase() === roll.toUpperCase()
                  ? { ...s, boardingStatus: 'NOT_COMING', notComingNote: statusEvt.data?.note || 'Skipping stop' }
                  : s
              )
            );
            if (activeStudentRef.current?.rollNumber.toUpperCase() === roll.toUpperCase()) {
              setArrivalStage('CLEARED_SKIPPED');
              setTwoMinCountdownSec(0);
            }
          }
        } else if (statusEvt.type === 'route_plan_updated' || statusEvt.type === 'ROUTE_PLAN_UPDATED') {
          const plan = statusEvt.data?.plan || statusEvt.data;
          if (plan) applyOptimizationPlanRef.current(plan);
        } else if (statusEvt.type === 'STUDENT_SAFETY_ALERT' && statusEvt.data) {
          if (currentUser.role === 'DRIVER') {
            audioSpeechService.playOversleepEmergencyAlarm();
            pushToast(
              'danger',
              `SAFETY ALERT: ${statusEvt.data.category}`,
              `${statusEvt.data.studentName} (${statusEvt.data.rollNumber}): ${statusEvt.data.message}`
            );
          }
        } else if (statusEvt.type === 'PARENT_ALERT' && statusEvt.data) {
          if (currentUser.role === 'PARENT') {
            const title = statusEvt.data.title || 'Transport Alert';
            const message = statusEvt.data.message || 'New update regarding your ward transit.';
            pushToast('info', title, message);
            void nativeDeviceService.sendMobileNotification(title, message);
          }
        }
      },
    );

    // Initial check for active stop timer on server
    excelService.getStopTimer(route).then((res) => {
      if (res && res.active && typeof res.remainingSeconds === 'number' && res.remainingSeconds > 0) {
        setTwoMinCountdownSec(res.remainingSeconds);
        setArrivalStage('ARRIVED_2_MIN_TIMER');
      }
    });

    // Initial fetch for server-authoritative route optimization
    excelService.getRouteOptimization(route).then((plan) => {
      if (plan && (plan.success || plan.routeId)) {
        applyOptimizationPlanRef.current(plan);
      }
    });

    return () => {
      unsub();
    };
  }, [currentUser?.role, currentUser?.routeId, currentUser?.rollNumber, activeRouteId]);

  const triggerNativeBleGateScan = useCallback(async () => {
    void nativeDeviceService.triggerHaptic('medium');
    const scan = await nativeDeviceService.scanGateBeaconToken();
    if (!scan.detected || !scan.token) {
      pushToast('info', 'Gate BLE Proximity Scan', scan.reason);
      return;
    }
    const r = await excelService.checkIn({
      routeId: activeBus.routeId,
      method: 'BLE',
      token: scan.token,
      rssi: scan.rssi,
    });
    if (r.success) {
      performBoarding(activeStudentId, 'BLE_PROXIMITY');
    } else {
      pushToast('warning', 'Check-in failed', r.message);
    }
  }, [activeBus.routeId, performBoarding, activeStudentId, pushToast]);

  const value: CommuteSimulationContextValue = useMemo(
    () => ({
      activeView,
      setActiveView,
      isDark,
      toggleDark,
      isApiKeyModalOpen,
      setIsApiKeyModalOpen,
      latestToast,
      dismissToast,
      apiConfig,
      apiStatus,
      verifyAndHotSwapKeys,
      resetApiConfigToEnv,
      buses,
      activeRouteId,
      setActiveRouteId,
      activeBus,
      isBusLocationStale,
      students,
      activeStudentId,
      setActiveStudentId,
      syncAuthenticatedStudent,
      activeStudent,
      tripDirection,
      setTripDirection,
      scheduleMode,
      setScheduleMode,
      autoDriveEnabled,
      toggleAutoDrive,
      arrivalStage,
      twoMinCountdownSec,
      activeStudentEtaSec,
      driverVoiceEnabled,
      setDriverVoiceEnabled,
      wakeUpBannerStopName,
      dismissWakeUpBanner,
      getBusOccupiedSeats,
      notifications,
      lostItems,
      fuelRoi,
      stepBusForward,
      triggerTenMinHeadsUp,
      triggerStopArrivalTimer,
      markStudentNotComing,
      simulateGateProximityBoarding,
      simulatePhysicalIdScan,
      toggleDriverGpsDropFailover,
      selectAlternateReturnStop,
      simulateAreaOptOutAndSkip,
      simulateEarlyMetroExit,
      simulateOversleepMissedStop,
      confirmOversleepSafeDropOff,
      reportLostItem,
      acknowledgeLostItem,
      triggerBreakdownAndRescue,
      clearBreakdownStatus,
      swapDriverViaWindshieldQr,
      toggleBusPassFeeLock,
      activateGracePass,
      simulateFeePayment,
      toggleWakeUpAlarmPreference,
      addRouteStop,
      updateCampusParkingBay,
      resetDemoState,
      nativePlatform,
      isMobileShell,
      mobilePreviewFrame,
      toggleMobilePreviewFrame,
      isSimDrawerOpen,
      setIsSimDrawerOpen,
      livePhoneGpsActive,
      toggleLivePhoneGps,
      triggerNativeBleGateScan,
      excelStatus,
      downloadMasterExcel,
      trafficAlerts,
      activeTrafficAlert,
      isInstallModalOpen,
      setIsInstallModalOpen,
      toggleDriverFlyoverBypass,
      updateDriverBattery,
      studentCommuteHistory,
      currentUser,
      setCurrentUser: handleSetCurrentUser,
      logoutUser,
      pushToast,
      routeOptimizationPlan,
      setAbsenceTomorrow,
      setClusterOptimizationOverride,
      toggleRoutePlanLock,
    }),
    [
      activeView,
      setActiveView,
      isDark,
      toggleDark,
      isApiKeyModalOpen,
      setIsApiKeyModalOpen,
      latestToast,
      dismissToast,
      apiConfig,
      apiStatus,
      verifyAndHotSwapKeys,
      resetApiConfigToEnv,
      buses,
      activeRouteId,
      setActiveRouteId,
      activeBus,
      isBusLocationStale,
      students,
      activeStudentId,
      setActiveStudentId,
      syncAuthenticatedStudent,
      activeStudent,
      tripDirection,
      setTripDirection,
      scheduleMode,
      setScheduleMode,
      autoDriveEnabled,
      toggleAutoDrive,
      arrivalStage,
      twoMinCountdownSec,
      activeStudentEtaSec,
      driverVoiceEnabled,
      setDriverVoiceEnabled,
      wakeUpBannerStopName,
      dismissWakeUpBanner,
      getBusOccupiedSeats,
      notifications,
      lostItems,
      fuelRoi,
      stepBusForward,
      triggerTenMinHeadsUp,
      triggerStopArrivalTimer,
      markStudentNotComing,
      simulateGateProximityBoarding,
      simulatePhysicalIdScan,
      toggleDriverGpsDropFailover,
      selectAlternateReturnStop,
      simulateAreaOptOutAndSkip,
      simulateEarlyMetroExit,
      simulateOversleepMissedStop,
      confirmOversleepSafeDropOff,
      reportLostItem,
      acknowledgeLostItem,
      triggerBreakdownAndRescue,
      clearBreakdownStatus,
      swapDriverViaWindshieldQr,
      toggleBusPassFeeLock,
      activateGracePass,
      simulateFeePayment,
      toggleWakeUpAlarmPreference,
      addRouteStop,
      updateCampusParkingBay,
      resetDemoState,
      nativePlatform,
      isMobileShell,
      mobilePreviewFrame,
      toggleMobilePreviewFrame,
      isSimDrawerOpen,
      setIsSimDrawerOpen,
      livePhoneGpsActive,
      toggleLivePhoneGps,
      triggerNativeBleGateScan,
      excelStatus,
      downloadMasterExcel,
      trafficAlerts,
      activeTrafficAlert,
      isInstallModalOpen,
      setIsInstallModalOpen,
      toggleDriverFlyoverBypass,
      updateDriverBattery,
      studentCommuteHistory,
      currentUser,
      handleSetCurrentUser,
      logoutUser,
      pushToast,
      routeOptimizationPlan,
      setAbsenceTomorrow,
      setClusterOptimizationOverride,
      toggleRoutePlanLock,
    ],
  );

  const telemetryValue: LiveTelemetryContextValue = useMemo(
    () => ({
      buses,
      activeBus,
      twoMinCountdownSec,
      activeStudentEtaSec,
      isBusLocationStale,
      arrivalStage,
    }),
    [buses, activeBus, twoMinCountdownSec, activeStudentEtaSec, isBusLocationStale, arrivalStage],
  );

  return (
    <LiveTelemetryContext.Provider value={telemetryValue}>
      <CommuteSimulationContext.Provider value={value}>
        {children}
      </CommuteSimulationContext.Provider>
    </LiveTelemetryContext.Provider>
  );
};
