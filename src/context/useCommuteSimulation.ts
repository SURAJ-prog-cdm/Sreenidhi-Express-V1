import { createContext, useContext } from 'react';
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

export interface ToastBanner {
  id: string;
  tone: 'info' | 'success' | 'warning' | 'danger';
  title: string;
  body: string;
}

export interface CommuteSimulationContextValue {
  activeView: PortalView;
  setActiveView: (view: PortalView) => void;
  isDark: boolean;
  toggleDark: () => void;
  isApiKeyModalOpen: boolean;
  setIsApiKeyModalOpen: (open: boolean) => void;
  latestToast: ToastBanner | null;
  dismissToast: () => void;
  apiConfig: ApiKeysConfig;
  apiStatus: ApiIntegrationStatus;
  verifyAndHotSwapKeys: (next: ApiKeysConfig) => Promise<ApiIntegrationStatus>;
  resetApiConfigToEnv: () => Promise<void>;
  buses: BusVehicle[];
  activeRouteId: string;
  setActiveRouteId: (routeId: string) => void;
  activeBus: BusVehicle;
  isBusLocationStale: boolean;
  students: StudentRecord[];
  activeStudentId: string;
  setActiveStudentId: (studentId: string) => void;
  syncAuthenticatedStudent: (profile: Record<string, unknown>) => void;
  activeStudent: StudentRecord;
  tripDirection: TripDirection;
  setTripDirection: (dir: TripDirection) => void;
  scheduleMode: ScheduleMode;
  setScheduleMode: (mode: ScheduleMode) => void;
  autoDriveEnabled: boolean;
  toggleAutoDrive: () => void;
  arrivalStage: StopArrivalStage;
  twoMinCountdownSec: number;
  activeStudentEtaSec: number;
  driverVoiceEnabled: boolean;
  setDriverVoiceEnabled: (enabled: boolean) => void;
  wakeUpBannerStopName: string | null;
  dismissWakeUpBanner: () => void;
  getBusOccupiedSeats: (routeId: string) => number;
  notifications: NotificationLogEntry[];
  lostItems: LostItemReport[];
  fuelRoi: FuelRoiMetrics;
  stepBusForward: (routeId?: string) => void;
  triggerTenMinHeadsUp: () => void;
  triggerStopArrivalTimer: () => void;
  markStudentNotComing: (studentId: string, note?: string) => void;
  simulateGateProximityBoarding: (studentId?: string) => void;
  simulatePhysicalIdScan: (queryOrStudentId?: string) => void;
  toggleDriverGpsDropFailover: (routeId?: string) => void;
  selectAlternateReturnStop: (studentId: string, stopId: string | null) => void;
  simulateAreaOptOutAndSkip: (clusterId?: string) => Promise<void>;
  simulateEarlyMetroExit: (stopId?: string) => void;
  simulateOversleepMissedStop: () => void;
  confirmOversleepSafeDropOff: () => void;
  reportLostItem: (
    itemType: LostItemReport['itemType'],
    seatZone: string,
    studentId?: string,
  ) => void;
  acknowledgeLostItem: (itemId: string) => void;
  triggerBreakdownAndRescue: (routeId?: string) => void;
  clearBreakdownStatus: (routeId?: string) => void;
  swapDriverViaWindshieldQr: (routeId: string, substituteName: string) => void;
  toggleBusPassFeeLock: (studentId?: string) => void;
  activateGracePass: (studentId?: string) => void;
  simulateFeePayment: (studentId?: string) => void;
  toggleWakeUpAlarmPreference: (studentId: string) => void;
  addRouteStop: (routeId: string, stop: Omit<RouteStop, 'id' | 'sequence'>) => void;
  updateCampusParkingBay: (routeId: string, row: string, bay: string) => void;
  resetDemoState: () => void;

  // Mobile App Shell & Native Device Hardware
  nativePlatform: 'android' | 'ios' | 'web';
  isMobileShell: boolean;
  mobilePreviewFrame: boolean;
  toggleMobilePreviewFrame: () => void;
  isSimDrawerOpen: boolean;
  setIsSimDrawerOpen: (open: boolean) => void;
  livePhoneGpsActive: boolean;
  toggleLivePhoneGps: () => Promise<boolean>;
  triggerNativeBleGateScan: () => Promise<void>;

  // Excel Backend & Sheet Synchronization
  excelStatus: {
    online: boolean;
    serverUrl: string;
    fileName: string;
    totalSheets: number;
    lastModified?: string;
  };
  downloadMasterExcel: () => Promise<void>;

  // Cyberabad Traffic & Project Nova Adaptations
  trafficAlerts: CyberabadTrafficAlert[];
  activeTrafficAlert: CyberabadTrafficAlert;
  isInstallModalOpen: boolean;
  setIsInstallModalOpen: (open: boolean) => void;
  toggleDriverFlyoverBypass: (routeId?: string) => void;
  updateDriverBattery: (pct: number, charging?: boolean) => void;
  studentCommuteHistory: CommuteTripHistoryEntry[];

  // Authentication & Session
  currentUser: AuthUserSession | null;
  setCurrentUser: (user: AuthUserSession | null) => void;
  logoutUser: () => void;
  pushToast: (tone: 'info' | 'success' | 'warning' | 'danger', title: string, body: string) => void;

  // Route Optimization (Area-Based Dynamic Routing)
  routeOptimizationPlan: any;
  setAbsenceTomorrow: (studentRoll: string, notComing: boolean, day?: 'TODAY' | 'TOMORROW') => Promise<{ success: boolean; error?: string; locked?: boolean }>;
  setClusterOptimizationOverride: (routeId: string, clusterId: string, keep: boolean) => Promise<{ success: boolean; plan?: any; error?: string }>;
  toggleRoutePlanLock: (routeId: string, lock: boolean) => Promise<{ success: boolean; plan?: any; error?: string }>;
}

export const CommuteSimulationContext =
  createContext<CommuteSimulationContextValue | null>(null);

export interface LiveTelemetryContextValue {
  buses: BusVehicle[];
  activeBus: BusVehicle;
  twoMinCountdownSec: number;
  activeStudentEtaSec: number;
  isBusLocationStale: boolean;
  arrivalStage: StopArrivalStage;
}

export const LiveTelemetryContext =
  createContext<LiveTelemetryContextValue | null>(null);

export function useLiveTelemetry(): LiveTelemetryContextValue {
  const ctx = useContext(LiveTelemetryContext);
  if (!ctx) {
    throw new Error('useLiveTelemetry must be used inside CommuteSimulationProvider');
  }
  return ctx;
}

export function useCommuteSimulation(): CommuteSimulationContextValue {
  const ctx = useContext(CommuteSimulationContext);
  if (!ctx) {
    throw new Error('useCommuteSimulation must be used inside CommuteSimulationProvider');
  }
  return ctx;
}
