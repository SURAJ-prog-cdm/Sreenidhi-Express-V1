export type PortalView =
  | 'STUDENT'
  | 'DRIVER'
  | 'ADMIN'
  | 'PARENT'
  | 'SPLIT_DEMO'
  | 'STUDENT_LOGIN'
  | 'LOGIN';

export interface AuthUserSession {
  role: 'STUDENT' | 'ADMIN' | 'DRIVER' | 'PARENT' | 'GUEST';
  id: string;
  name: string;
  rollNumber?: string;
  routeId?: string;
  email?: string;
  token?: string;
  loginTime: string;
  wardName?: string;
  wardRoll?: string;
  wardRouteId?: string;
  wardPickupStop?: string;
  mustChangePassword?: boolean;
}

export type AuthRole = 'STUDENT' | 'ADMIN' | 'DRIVER' | 'PARENT';

export type TripDirection = 'MORNING_TO_CAMPUS' | 'EVENING_FROM_CAMPUS';

export type BoardingStatus =
  | 'WAITING'
  | 'NOT_COMING'
  | 'ON_BOARD'
  | 'ALIGHTED_SAFE'
  | 'ALIGHTED_EARLY'
  | 'OVERSLEPT'
  | 'UNACCOUNTED';

export type PassStatus = 'ACTIVE' | 'EXPIRING_SOON' | 'FEE_PENDING';

export type CheckInMethod =
  | 'NONE'
  | 'BLE_PROXIMITY'
  | 'PHYSICAL_ID_CARD'
  | 'STUDENT_SELF_TAP'
  | 'QR_ROTATING';

export type TelemetrySource =
  | 'DRIVER_PRIMARY'
  | 'CROWD_SOURCED_STUDENTS';

export type ScheduleMode = 'REGULAR' | 'EXAM_HALF_DAY' | 'FEST_EVENTS';

export type StopArrivalStage =
  | 'IDLE'
  | 'HEADS_UP_10_MIN'
  | 'ARRIVED_2_MIN_TIMER'
  | 'TIMER_EXPIRED'
  | 'CLEARED_BOARDED'
  | 'CLEARED_ON_BOARD'
  | 'CLEARED_SKIPPED';

export type BusStatus =
  | 'ON_ROUTE'
  | 'BOARDING_AT_BAY'
  | 'FINAL_CALL'
  | 'REROUTED_SKIP_AREA'
  | 'BREAKDOWN_RESCUE_ACTIVE'
  | 'MERGED_EXAM_MODE'
  | 'DEPARTED';

export interface RouteStop {
  id: string;
  name: string;
  shortName: string;
  lat: number;
  lng: number;
  sequence: number;
  areaClusterId: string;
  areaClusterName: string;
  geofenceRadiusMeters: number;
  scheduledMorningTime: string;
  scheduledEveningTime: string;
  metroInterchange?: {
    stationName: string;
    line: 'Blue Line' | 'Red Line' | 'Green Line' | 'Red/Blue Line';
    walkMinutes: number;
    timeSavedMinutes: number;
  };
  returnTripEligible: boolean;
  isBypassed?: boolean;
}

export interface StudentRecord {
  id: string;
  name: string;
  rollNumber: string;
  program: string;
  routeId: string;
  pickupStopId: string;
  defaultDropStopId: string;
  alternateReturnStopId: string | null;
  parentName: string;
  parentPhoneMasked: string;
  parentTelegramChatId?: string;
  passStatus: PassStatus;
  gracePassActive: boolean;
  boardingStatus: BoardingStatus;
  checkInMethod: CheckInMethod;
  notComingNote?: string;
  wakeUpAlarmEnabled: boolean;
  bleRssiDbm: number;
  boardedAtTime?: string;
  walkDistanceMeters?: number;
  walkTimeMinutes?: number;
  mustChangePassword?: boolean;
  stopId?: string;
  areaClusterId?: string;
  riderType?: 'STUDENT' | 'FACULTY';
  gender?: 'M' | 'F';
}

export interface BusVehicle {
  routeId: string;
  routeNumber: string;
  routeName: string;
  corridorSummary: string;
  registrationNo: string;
  driverName: string;
  driverPhone: string;
  driverPinQr: string;
  capacity: number;
  boardedCount?: number;
  campusParkingZone: string;
  campusParkingRow: string;
  campusParkingBay: string;
  departureCountdownSec: number;
  status: BusStatus;
  telemetrySource: TelemetrySource;
  crowdSourcedActiveCount: number;
  currentLat: number;
  currentLng: number;
  currentStopIndex: number;
  segmentProgress: number; // 0 to 1 between currentStopIndex and next
  speedKmh: number;
  trafficDelayMinutes: number;
  skippedClusterIds: string[];
  rescueAssignedRouteId: string | null;
  rescueEtaMinutes: number | null;
  stops: RouteStop[];
  shortcutPath?: [number, number][];
  driverBatteryPct: number;
  driverBatteryCharging: boolean;
  flyoverBypassActive: boolean;
}

export interface NotificationLogEntry {
  id: string;
  timestamp: string;
  eventType:
    | 'PRE_ARRIVAL_10M'
    | 'STOP_ARRIVAL_2M'
    | 'BOARDED_CONFIRMED'
    | 'NOT_COMING_OPT_OUT'
    | 'EARLY_UNSCHEDULED_EXIT'
    | 'OVERSLEEP_EMERGENCY'
    | 'AREA_SKIP_REROUTE'
    | 'LOST_ITEM_PING'
    | 'BREAKDOWN_RESCUE'
    | 'SCHEDULE_MODE_BROADCAST';
  recipient: 'PARENT' | 'STUDENT' | 'DRIVER' | 'ALL_FLEET';
  recipientLabel: string;
  title: string;
  message: string;
  channel: 'FCM_PUSH' | 'WHATSAPP_SMS_WEBHOOK' | 'DRIVER_VOICE_HUD';
  deliveryStatus: 'DELIVERED_LIVE' | 'SANDBOX_LOGGED' | 'FAILED_FALLBACK';
  httpStatusCode?: number;
}

export interface LostItemReport {
  id: string;
  studentId: string;
  studentName: string;
  routeId: string;
  itemType: 'University ID Card' | 'Backpack / Laptop Bag' | 'Lab Record Book' | 'Phone / Umbrella';
  seatZone: string;
  reportedAt: string;
  acknowledgedByDriver: boolean;
}

export interface FuelRoiMetrics {
  totalKmBypassed: number;
  totalMinutesSaved: number;
  dieselLitersSaved: number;
  rupeesSaved: number;
  areasSkippedCount: number;
}

export interface ApiKeysConfig {
  googleMapsApiKey: string;
  firebaseApiKey: string;
  firebaseAuthDomain: string;
  firebaseDatabaseUrl: string;
  firebaseProjectId: string;
}

export interface ApiIntegrationStatus {
  googleMapsMode: 'LIVE_GOOGLE_MAPS' | 'FALLBACK_LEAFLET_OSM';
  googleMapsVerified: boolean;
  googleMapsError?: string;
  firebaseMode: 'LIVE_FIREBASE_RTDB' | 'LOCAL_REACTIVE_STORE';
  notificationMode: 'CONNECTED_WEBHOOK' | 'SANDBOX_AUDIT_LOG';
}

export interface ExcelSyncStatus {
  backendOnline: boolean;
  fileName: string;
  totalSheets: number;
  lastModified?: string;
  bufferedRecords: number;
}

export interface CyberabadTrafficAlert {
  id: string;
  corridor: string;
  headline: string;
  severity: 'NORMAL' | 'MODERATE' | 'HEAVY' | 'CRITICAL';
  recommendedBypass: string;
  reportedBy: string;
  reportedAt: string;
}

export interface CommuteTripHistoryEntry {
  id: string;
  date: string;
  day: string;
  routeNumber: string;
  direction: TripDirection;
  boardedTime: string;
  droppedTime: string;
  durationMinutes: number;
  status: 'ON_TIME' | 'SLIGHT_DELAY' | 'BYPASSED';
  pickupStop: string;
  dropStop: string;
}

export interface ServiceApplication {
  id: string;
  type: 'PASS_RENEWAL' | 'ROUTE_CHANGE' | 'FEE_GRACE';
  studentId: string;
  studentName: string;
  rollNumber: string;
  currentRouteId: string;
  requestedRouteId?: string;
  currentStopName?: string;
  requestedStopName?: string;
  reason: string;
  urgency: 'STANDARD' | 'HIGH' | 'EMERGENCY';
  submittedAt: string;
  status: 'PENDING_SCRUTINY' | 'APPROVED' | 'REJECTED';
  adminNote?: string;
  reviewedAt?: string;
  reviewedBy?: string;
}
