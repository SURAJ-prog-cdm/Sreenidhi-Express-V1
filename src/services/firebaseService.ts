import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getDatabase,
  ref,
  set,
  onValue,
  off,
  type Database,
} from 'firebase/database';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  onSnapshot,
  query,
  orderBy,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  type Auth,
} from 'firebase/auth';
import type {
  ApiKeysConfig,
  StudentRecord,
  ServiceApplication,
} from '../types/transit';
import { loadEffectiveApiConfig } from '../config/apiConfig';

export interface LiveBusTelemetry {
  routeId: string;
  routeNumber?: string;
  lat: number;
  lng: number;
  speedKmh: number;
  heading?: number;
  currentStopIndex: number;
  status: string;
  flyoverBypassActive: boolean;
  skippedClusterIds: string[];
  telemetrySource: 'DRIVER_PRIMARY' | 'CROWD_SOURCED_STUDENTS';
  updatedAt: number;
}

export interface StopTimerData {
  startedAt: number;
  expiresAt: number;
  active: boolean;
}

class FirebaseService {
  private app: FirebaseApp | null = null;
  private rtdb: Database | null = null;
  private firestore: Firestore | null = null;
  private auth: Auth | null = null;
  private activeConfigSignature = '';

  constructor() {
    this.initFromConfig(loadEffectiveApiConfig());
  }

  public isConfigured(cfg: ApiKeysConfig): boolean {
    return Boolean(
      cfg.firebaseApiKey &&
      cfg.firebaseApiKey.trim().length > 5 &&
      cfg.firebaseProjectId &&
      cfg.firebaseProjectId.trim().length > 2
    );
  }

  public initFromConfig(cfg: ApiKeysConfig): boolean {
    if (!this.isConfigured(cfg)) {
      return false;
    }

    const sig = `${cfg.firebaseApiKey}|${cfg.firebaseProjectId}|${cfg.firebaseDatabaseUrl}`;
    if (this.app && this.activeConfigSignature === sig) {
      return true;
    }

    try {
      const existingApps = getApps();
      if (existingApps.length > 0 && existingApps[0]) {
        this.app = existingApps[0];
      } else {
        this.app = initializeApp({
          apiKey: cfg.firebaseApiKey.trim(),
          authDomain:
            cfg.firebaseAuthDomain.trim() ||
            `${cfg.firebaseProjectId.trim()}.firebaseapp.com`,
          databaseURL:
            cfg.firebaseDatabaseUrl.trim() ||
            `https://${cfg.firebaseProjectId.trim()}-default-rtdb.firebaseio.com`,
          projectId: cfg.firebaseProjectId.trim(),
        });
      }

      try {
        this.rtdb = getDatabase(this.app);
      } catch {
        this.rtdb = null;
      }

      try {
        this.firestore = getFirestore(this.app);
      } catch {
        this.firestore = null;
      }

      try {
        this.auth = getAuth(this.app);
      } catch {
        this.auth = null;
      }

      this.activeConfigSignature = sig;
      console.log('[FirebaseService] Initialized with project:', cfg.firebaseProjectId);
      return true;
    } catch (e) {
      console.warn('[FirebaseService] Init non-fatal fallback:', e);
      return false;
    }
  }

  // ==========================================
  // REALTIME DATABASE: LIVE BUS TELEMETRY (3-SECOND)
  // ==========================================

  public async publishBusTelemetry(
    routeId: string,
    telemetry: LiveBusTelemetry
  ): Promise<void> {
    if (!this.rtdb) return;
    try {
      const busRef = ref(this.rtdb, `liveBuses/${routeId}`);
      await set(busRef, {
        ...telemetry,
        updatedAt: Date.now(),
      });
    } catch {
      // Non-fatal if offline
    }
  }

  public async publishCrowdFallbackGps(
    routeId: string,
    fallback: {
      lat: number;
      lng: number;
      speedKmh: number;
      studentRoll: string;
    }
  ): Promise<void> {
    if (!this.rtdb) return;
    try {
      const refFallback = ref(this.rtdb, `liveBuses/${routeId}/crowdFallback`);
      await set(refFallback, {
        ...fallback,
        telemetrySource: 'CROWD_SOURCED_STUDENTS',
        updatedAt: Date.now(),
      });
    } catch {
      // Non-fatal
    }
  }

  public subscribeLiveBus(
    routeId: string,
    onData: (data: LiveBusTelemetry | null) => void
  ): () => void {
    if (!this.rtdb) {
      return () => {};
    }
    const busRef = ref(this.rtdb, `liveBuses/${routeId}`);
    const callback = (snapshot: any) => {
      if (snapshot.exists()) {
        onData(snapshot.val() as LiveBusTelemetry);
      } else {
        onData(null);
      }
    };
    onValue(busRef, callback);
    return () => off(busRef, 'value', callback);
  }

  // ==========================================
  // REALTIME DATABASE: 2-MINUTE STOP TIMERS
  // ==========================================

  public async syncStopTimer(
    routeId: string,
    stopId: string,
    timer: StopTimerData
  ): Promise<void> {
    if (!this.rtdb) return;
    try {
      const timerRef = ref(this.rtdb, `stopTimers/${routeId}/${stopId}`);
      await set(timerRef, timer);
    } catch {
      // Non-fatal
    }
  }

  public subscribeStopTimer(
    routeId: string,
    stopId: string,
    onTimer: (timer: StopTimerData | null) => void
  ): () => void {
    if (!this.rtdb) return () => {};
    const timerRef = ref(this.rtdb, `stopTimers/${routeId}/${stopId}`);
    const callback = (snapshot: any) => {
      if (snapshot.exists()) {
        onTimer(snapshot.val() as StopTimerData);
      } else {
        onTimer(null);
      }
    };
    onValue(timerRef, callback);
    return () => off(timerRef, 'value', callback);
  }

  // ==========================================
  // CLOUD FIRESTORE: PERSISTENT COLLECTIONS
  // ==========================================

  public async syncStudentToFirestore(student: StudentRecord): Promise<void> {
    if (!this.firestore) return;
    try {
      const studentDoc = doc(this.firestore, 'students', student.rollNumber);
      await setDoc(studentDoc, student, { merge: true });
    } catch (e) {
      console.warn('[Firestore] Student sync non-fatal:', e);
    }
  }

  public async recordBoardingAttendance(record: {
    studentId: string;
    rollNumber: string;
    studentName: string;
    routeId: string;
    stopName: string;
    method: 'CAMERA_QR_GATE' | 'BLE_PROXIMITY' | 'DRIVER_MANUAL';
    status: string;
  }): Promise<void> {
    if (!this.firestore) return;
    try {
      const attendanceCol = collection(this.firestore, 'boarding_attendance');
      const id = `att-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      await setDoc(doc(attendanceCol, id), {
        ...record,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[Firestore] Attendance write non-fatal:', e);
    }
  }

  public async recordReturnTripChange(record: {
    studentRoll: string;
    studentName: string;
    originalRouteId: string;
    selectedRouteId: string;
    selectedStopName: string;
    reason?: string;
  }): Promise<void> {
    if (!this.firestore) return;
    try {
      const col = collection(this.firestore, 'return_trip_changes');
      const id = `ret-${Date.now()}`;
      await setDoc(doc(col, id), {
        ...record,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[Firestore] Return trip write non-fatal:', e);
    }
  }

  public async recordLostItemClaim(item: {
    id: string;
    studentId: string;
    studentName: string;
    routeId: string;
    itemType: string;
    seatZone: string;
    reportedAt: string;
  }): Promise<void> {
    if (!this.firestore) return;
    try {
      const col = collection(this.firestore, 'lost_item_claims');
      await setDoc(doc(col, item.id), item, { merge: true });
    } catch (e) {
      console.warn('[Firestore] Lost item write non-fatal:', e);
    }
  }

  public async recordParentAlertLog(alert: {
    recipientPhone: string;
    recipientName: string;
    category: string;
    title: string;
    message: string;
    deliveryStatus: string;
  }): Promise<void> {
    if (!this.firestore) return;
    try {
      const col = collection(this.firestore, 'parent_alerts_log');
      const id = `alert-${Date.now()}`;
      await setDoc(doc(col, id), {
        ...alert,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[Firestore] Parent alert write non-fatal:', e);
    }
  }

  public async recordDriverTripLog(trip: {
    routeId: string;
    driverName: string;
    busRegistration: string;
    startTime: string;
    endTime?: string;
    status: string;
    fuelSavedKm?: number;
  }): Promise<void> {
    if (!this.firestore) return;
    try {
      const col = collection(this.firestore, 'driver_trip_logs');
      const id = `trip-${Date.now()}`;
      await setDoc(doc(col, id), trip, { merge: true });
    } catch (e) {
      console.warn('[Firestore] Driver trip log non-fatal:', e);
    }
  }

  // ==========================================
  // SERVICE APPLICATIONS (TRANSIT SERVICES HUB -> ADMIN SCRUTINY DESK)
  // ==========================================

  public async submitServiceApplication(app: ServiceApplication): Promise<void> {
    if (!this.firestore) return;
    try {
      const col = collection(this.firestore, 'service_applications');
      await setDoc(doc(col, app.id), app, { merge: true });
    } catch (e) {
      console.warn('[Firestore] Application write non-fatal:', e);
    }
  }

  public async updateApplicationScrutiny(
    id: string,
    status: 'APPROVED' | 'REJECTED',
    adminNote: string,
    reviewedBy: string
  ): Promise<void> {
    if (!this.firestore) return;
    try {
      const docRef = doc(this.firestore, 'service_applications', id);
      await setDoc(
        docRef,
        {
          status,
          adminNote,
          reviewedBy,
          reviewedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (e) {
      console.warn('[Firestore] Application scrutiny update non-fatal:', e);
    }
  }

  public subscribeServiceApplications(
    onUpdate: (apps: ServiceApplication[]) => void
  ): Unsubscribe | (() => void) {
    if (!this.firestore) return () => {};
    try {
      const col = collection(this.firestore, 'service_applications');
      const q = query(col, orderBy('submittedAt', 'desc'));
      return onSnapshot(
        q,
        (snapshot) => {
          const list: ServiceApplication[] = [];
          snapshot.forEach((d) => {
            list.push(d.data() as ServiceApplication);
          });
          onUpdate(list);
        },
        (error) => {
          console.warn('[Firestore] Applications snapshot warning:', error);
        }
      );
    } catch {
      return () => {};
    }
  }

  // ==========================================
  // FIREBASE AUTH (EMAIL/PASSWORD)
  // ==========================================

  public async authenticateStudent(
    rollNumber: string,
    pass: string
  ): Promise<{ success: boolean; user?: any; error?: string }> {
    if (!this.auth) {
      return { success: false, error: 'Firebase Auth not initialized' };
    }
    const email = `${rollNumber.trim().toLowerCase()}@sreenidhi.edu.in`;
    try {
      const cred = await signInWithEmailAndPassword(this.auth, email, pass);
      return { success: true, user: cred.user };
    } catch (err: any) {
      // If user does not exist yet in Firebase Auth, attempt auto-provision on first login
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
        try {
          const newCred = await createUserWithEmailAndPassword(this.auth, email, pass);
          return { success: true, user: newCred.user };
        } catch (createErr: any) {
          return { success: false, error: createErr.message || String(createErr) };
        }
      }
      return { success: false, error: err.message || String(err) };
    }
  }
}

export const firebaseService = new FirebaseService();
