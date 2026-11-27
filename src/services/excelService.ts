import { enqueue, flush, pendingCount, startAutoFlush, subOf } from './eventQueue';
import { INITIAL_BUS_FLEET } from '../data/sreenidhiData';

export interface ExcelBackendStatus {
  online: boolean;
  serverUrl: string;
  fileName: string;
  totalSheets: number;
  lastModified?: string;
  bufferedRecordsCount: number;
}

export interface StudentAuthPayload {
  rollNumber: string;
  name: string;
  program: string;
  routeId: string;
  pickupStopId: string;
  parentName: string;
  parentPhone: string;
}

export interface BufferedEvent {
  eventId: string;
  sheetName: string;
  data: Record<string, any>;
  timestamp: string;
}

const AUTH_SESSION_KEY = 'transitpulse_active_student_session_v1';
const AUTH_TOKEN_KEY = 'transitpulse_auth_token_v1';

class ExcelService {
  private serverBaseUrl = '';

  constructor() {
    if (typeof window !== 'undefined' && window.location.origin && window.location.origin.startsWith('http') && window.location.protocol !== 'capacitor:' && window.location.protocol !== 'ionic:') {
      // In web browser (desktop or mobile phone): use the exact host/origin serving the app
      this.serverBaseUrl = window.location.origin;
    } else {
      const envBase = (import.meta as any).env?.VITE_API_BASE_URL;
      this.serverBaseUrl = envBase ? envBase.replace(/\/$/, '') : 'http://localhost:3001';
    }

    if (typeof window !== 'undefined') {
      // Durable offline queue (IndexedDB): flushes on reconnect, tab focus and a 30 s timer with backoff.
      startAutoFlush({ baseUrl: this.serverBaseUrl, getToken: () => this.getAuthToken(), onAuthExpired: () => this.clearAuthSession() });
    }
  }

  public getServerBaseUrl(): string {
    return this.serverBaseUrl;
  }

  public getAuthToken(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      return localStorage.getItem(AUTH_TOKEN_KEY);
    } catch {
      return null;
    }
  }

  public setAuthToken(token: string | null): void {
    if (typeof window === 'undefined') return;
    try {
      if (token) {
        localStorage.setItem(AUTH_TOKEN_KEY, token);
      } else {
        localStorage.removeItem(AUTH_TOKEN_KEY);
      }
    } catch {}
  }

  /** @deprecated localStorage buffer removed; events live in IndexedDB (see eventQueue.ts). */
  public getBufferedEvents(): BufferedEvent[] {
    return [];
  }

  public bufferLocalEvent(sheetName: string, data: Record<string, any>): string {
    void enqueue(sheetName, data, subOf(this.getAuthToken()));
    return '';
  }

  public async flushBufferedEvents(): Promise<number> {
    const before = await pendingCount();
    await flush({ baseUrl: this.serverBaseUrl, getToken: () => this.getAuthToken(), onAuthExpired: () => this.clearAuthSession() });
    return Math.max(0, before - (await pendingCount()));
  }

  public async checkBackendHealth(): Promise<ExcelBackendStatus> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/health`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(2000),
      });

      if (res.ok) {
        const data = await res.json();
        return {
          online: true,
          serverUrl: this.serverBaseUrl || (typeof window !== 'undefined' ? `${window.location.origin}` : 'http://localhost:3001'),
          fileName: 'sreenidhi_transit_master.xlsx',
          totalSheets: data.totalSheets || 7,
          lastModified: data.lastModified,
          bufferedRecordsCount: await pendingCount(),
        };
      }
    } catch {
      // Backend not running on port 3001
    }

    return {
      online: false,
      serverUrl: 'Offline',
      fileName: 'sreenidhi_transit_master.xlsx',
      totalSheets: 7,
      bufferedRecordsCount: await pendingCount(),
    };
  }

  /** Durable: returns true once the event is safely queued; delivery is idempotent and retried automatically. */
  public async recordEvent(sheetName: string, data: Record<string, any>): Promise<boolean> {
    const token = this.getAuthToken();
    if (!token) return false;
    await enqueue(sheetName, data, subOf(token));
    void this.flushBufferedEvents();
    return true;
  }

  /** Server-verified boarding: QR payload "SUH-GATE:route-14:<12 hex>" or the BLE beacon's rotating token. */
  public async checkIn(args: { routeId: string; method: 'QR' | 'BLE'; token: string; rssi?: number }): Promise<{ success: boolean; code?: string; message: string }> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/boarding/check-in`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ ...args, eventId: `CI-${crypto.randomUUID()}`, clientTime: new Date().toISOString() }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? { success: true, message: data.duplicate ? 'Already checked in' : 'Boarding verified' } : { success: false, code: data.code, message: data.error ?? 'Check-in failed' };
    } catch {
      // The gate token is only valid ~60 s, so a queued retry would be rejected anyway: tell the user instead of guessing.
      return { success: false, message: 'No connection. Try again, or ask the driver to mark you manually.' };
    }
  }

  /** Driver phone: rotating QR payload for the gate (refresh every `refreshInSeconds`). Render with any QR component. */
  public async getDriverGateToken(): Promise<{ token: string; qrPayload: string; refreshInSeconds: number } | null> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/driver/gate-token`, { headers: this.authHeaders(), signal: AbortSignal.timeout(8000) });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  public authHeaders(): Record<string, string> {
    const token = this.getAuthToken();
    return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }

  public async loginStudent(rollNumber: string, password?: string): Promise<{ success: boolean; student?: any; message: string }> {
    const cleanRoll = rollNumber.trim().toUpperCase();
    let res: Response;
    try {
      res = await fetch(`${this.serverBaseUrl}/api/students/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rollNumber: cleanRoll, password }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      return { success: false, message: 'Cannot reach the server. Check your connection and try again.' };
    }
    const data = await res.json().catch(() => ({}));
    // A rejected login is a rejected login: no "offline mirror" session is ever created from a 401/429/5xx.
    if (!res.ok) return { success: false, message: data.error ?? 'Sign-in failed' };
    this.saveAuthSession(data.student);
    if (data.token) this.setAuthToken(data.token);
    return { success: true, student: data.student, message: 'Signed in' };
  }

  public async loginParent(code: string): Promise<{ success: boolean; parent?: any; message: string }> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/parents/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code.trim() }), signal: AbortSignal.timeout(10000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { success: false, message: data.error ?? 'Sign-in failed' };
      if (data.token) this.setAuthToken(data.token);
      return { success: true, parent: data.parent, message: 'Signed in' };
    } catch {
      return { success: false, message: 'Cannot reach the server. Check your connection and try again.' };
    }
  }

  /** Student app → "Share with parent": 30-day portal code (a new code revokes the old one). */
  public async createParentAccessCode(): Promise<string | null> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/students/me/parent-access-code`, { method: 'POST', headers: this.authHeaders(), signal: AbortSignal.timeout(10000) });
      return res.ok ? (await res.json()).code : null;
    } catch { return null; }
  }

  public async testParentNotification(rollNumber?: string): Promise<{ success: boolean; notification?: any; whatsappUrl?: string | null }> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/notifications/parent-test`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ rollNumber }),
        signal: AbortSignal.timeout(10000),
      });
      return res.ok ? await res.json() : { success: false };
    } catch {
      return { success: false };
    }
  }

  public async loginAdmin(adminId: string, password?: string): Promise<{ success: boolean; admin?: any; message: string }> {
    const cleanId = adminId.trim();
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminId: cleanId, password }),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.token) this.setAuthToken(data.token);
        return { success: true, admin: data.admin, message: data.message };
      } else {
        const err = await res.json().catch(() => ({}));
        return { success: false, message: err.error || 'Invalid Admin credentials' };
      }
    } catch (err) {
      console.error('[ExcelService] loginAdmin network error:', err);
      return {
        success: false,
        message: 'Unable to connect to Sreenidhi Authentication Server. Please verify network connection.',
      };
    }
  }

  public async loginDriver(routeId: string, pin: string): Promise<{ success: boolean; driver?: any; token?: string; message: string }> {
    const cleanRoute = routeId.trim().toUpperCase();
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/driver/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routeId: cleanRoute, pin }),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.token) this.setAuthToken(data.token);
        return { success: true, driver: data.driver, token: data.token, message: data.message };
      } else {
        const err = await res.json().catch(() => ({}));
        return { success: false, message: err.error || 'Invalid Driver PIN' };
      }
    } catch (err) {
      console.error('[ExcelService] loginDriver network error:', err);
      return { success: false, message: 'Cannot reach the server. Check your connection.' };
    }
  }

  public async sendBusTelemetry(telemetry: Record<string, any>): Promise<boolean> {
    try {
      const token = this.getAuthToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${this.serverBaseUrl}/api/bus/telemetry`, {
        method: 'POST',
        headers,
        body: JSON.stringify(telemetry),
        signal: AbortSignal.timeout(5000), // telemetry is deliberately NOT queued: replaying stale positions is worse than dropping them
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** EventSource can't send headers, so trade the bearer token for a 2-minute stream ticket; reconnect with a fresh one. */
  public subscribeBusLiveStream(_routeId: string, onTelemetry: (data: any) => void, onStatus?: (e: { type: string; data: any }) => void): () => void {
    if (typeof window === 'undefined' || !window.EventSource) return () => {};
    let es: EventSource | null = null, stopped = false, retry = 0;
    const connect = async () => {
      if (stopped) return;
      try {
        const r = await fetch(`${this.serverBaseUrl}/api/bus/stream-ticket`, { method: 'POST', headers: this.authHeaders(), signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error('ticket');
        const { ticket } = await r.json();
        es = new EventSource(`${this.serverBaseUrl}/api/bus/live-stream?ticket=${encodeURIComponent(ticket)}`);
        es.onopen = () => { retry = 0; };
        es.onmessage = (event) => {
          try {
            const p = JSON.parse(event.data);
            if (p.type === 'BUS_TELEMETRY' && p.data) onTelemetry(p.data);
            else onStatus?.(p); // BUS_STALE / BUS_RECOVERED: show "bus went silent" to students
          } catch {}
        };
        es.onerror = () => { es?.close(); setTimeout(connect, Math.min(30000, 1000 * 2 ** retry++)); };
      } catch {
        setTimeout(connect, Math.min(30000, 1000 * 2 ** retry++));
      }
    };
    void connect();
    return () => { stopped = true; es?.close(); };
  }

  public async submitApplication(payload: Record<string, any>): Promise<{ success: boolean; application?: any }> {
    try {
      const token = this.getAuthToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${this.serverBaseUrl}/api/applications`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {}
    return { success: false };
  }

  public async fetchApplications(): Promise<any[]> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/applications`, {
        method: 'GET',
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        return data.applications || [];
      }
    } catch {}
    return [];
  }

  /** category must be one of the server's templates (PRE_ARRIVAL_10M, BOARDED, ARRIVED_CAMPUS, DELAY, BREAKDOWN, OVERSLEEP_MISSED_STOP, EMERGENCY). */
  public async notifyParentTelegram(payload: { studentRoll?: string; category: string; note?: string }): Promise<{ success: boolean; delivered?: boolean; message?: string; mode?: string }> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/alerts/notify-parent`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? data : { success: false, message: data.error ?? 'Alert failed' };
    } catch {
      return { success: false, message: 'No connection' };
    }
  }

  public saveAuthSession(student: any): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(student));
    } catch { }
  }

  public getSavedAuthSession(): any | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(AUTH_SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /* ---------------- Digital Bus Pass & Grace Pass ---------------- */
  public async getPassStatus(): Promise<{ feeStatus: string; isGraceActive: boolean; graceUntil: number; canTravel: boolean; passStatus: string; offlineCached?: boolean }> {
    const session = this.getSavedAuthSession();
    const token = this.getAuthToken();
    const currentRoll = session?.rollNumber || session?.roll_number || subOf(token) || '';

    try {
      const res = await fetch(`${this.serverBaseUrl}/api/students/me/pass`, { headers: this.authHeaders(), signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json();
      const statusObj = {
        feeStatus: d.feeStatus || 'UNAVAILABLE',
        isGraceActive: Boolean(d.isGraceActive),
        graceUntil: d.graceUntil || 0,
        canTravel: Boolean(d.canTravel),
        passStatus: d.passStatus || 'ACTIVE',
        offlineCached: false,
      };

      // Persist lightweight snapshot to localStorage
      if (typeof window !== 'undefined' && currentRoll) {
        try {
          const snapshot = {
            rollNumber: currentRoll,
            name: session?.name || session?.student_name || '',
            routeId: session?.routeId || session?.route_id || '',
            pickupStop: session?.pickupStop || session?.pickup_stop || '',
            feeStatus: statusObj.feeStatus,
            passStatus: statusObj.passStatus,
            canTravel: statusObj.canTravel,
            cachedAt: Date.now(),
          };
          localStorage.setItem('sreenidhi_offline_pass_v1', JSON.stringify(snapshot));
        } catch { }
      }

      return statusObj;
    } catch {
      // Offline fallback: check cached snapshot (< 7 days old) for logged-in roll number
      if (typeof window !== 'undefined' && currentRoll) {
        try {
          const raw = localStorage.getItem('sreenidhi_offline_pass_v1');
          if (raw) {
            const cached = JSON.parse(raw);
            const isFresh = Date.now() - (cached.cachedAt || 0) < 7 * 86400000;
            if (cached && (cached.rollNumber === currentRoll || !currentRoll) && isFresh) {
              return {
                feeStatus: cached.feeStatus || 'PAID',
                isGraceActive: false,
                graceUntil: 0,
                canTravel: cached.canTravel !== undefined ? Boolean(cached.canTravel) : true,
                passStatus: cached.passStatus || 'ACTIVE',
                offlineCached: true,
              };
            }
          }
        } catch { }
      }

      return { feeStatus: 'UNAVAILABLE', isGraceActive: false, graceUntil: 0, canTravel: false, passStatus: 'UNAVAILABLE', offlineCached: false };
    }
  }

  public async activateGracePass(): Promise<{ success: boolean; validUntilText?: string; message?: string }> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/students/grace`, { method: 'POST', headers: this.authHeaders(), signal: AbortSignal.timeout(8000) });
      const data = await res.json();
      return { success: res.ok, validUntilText: data.validUntilText, message: data.error };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Network error' };
    }
  }

  public async setAdminFeeStatus(rollNumber: string, status: 'PAID' | 'DUE'): Promise<boolean> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/admin/fee`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ rollNumber, status }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /* ---------------- v20 Hybrid Self-Check-In, Dwell Audit & Self-Signup ---------------- */
  public async selfCheckInBoarding(
    method: 'STUDENT_SELF_TAP' | 'BLE_PROXIMITY' = 'STUDENT_SELF_TAP',
  ): Promise<{ success: boolean; alreadyBoarded?: boolean; boardedCount?: number; message?: string }> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/boarding/self-checkin`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ method }),
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, message: data.error || 'Self check-in failed' };
      }
      return {
        success: true,
        alreadyBoarded: Boolean(data.alreadyBoarded),
        boardedCount: typeof data.boardedCount === 'number' ? data.boardedCount : undefined,
        message: data.message,
      };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Network error during check-in' };
    }
  }

  public async recordStopDwell(params: {
    routeId: string;
    stopId: string;
    stopName: string;
    arrivedAt: string;
    departedAt: string;
    dwellSec: number;
  }): Promise<boolean> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/bus/stop-dwell`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(params),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  public async getDriverUtilityLogs(routeId?: string, date?: string): Promise<{
    logs: Array<{
      id: number;
      route_id: string;
      stop_id: string;
      stop_name: string;
      arrived_at: string;
      departed_at: string;
      dwell_sec: number;
      flag: string;
      recorded_at: number;
      arrived_at_ist?: string;
      arrived_time_ist?: string;
      departed_at_ist?: string;
      departed_time_ist?: string;
      date_ist?: string;
      dwell_formatted?: string;
      scheduled_time?: string | null;
      delay_minutes?: number | null;
    }>;
    tripStarts: Array<{
      route_id: string;
      started_at: string;
      started_at_ist?: string;
      running: number;
      headcount: number;
    }>;
    summary: {
      totalStopsLogged: number;
      avgDwellSec: number;
      avgDwellFormatted: string;
      maxDwellSec: number;
      longestStopName: string | null;
      tooShortCount: number;
      tooLongCount: number;
    };
  }> {
    const emptySummary = {
      totalStopsLogged: 0,
      avgDwellSec: 0,
      avgDwellFormatted: '0s',
      maxDwellSec: 0,
      longestStopName: null,
      tooShortCount: 0,
      tooLongCount: 0,
    };
    try {
      const params = new URLSearchParams();
      if (routeId) params.set('routeId', routeId);
      if (date) params.set('date', date);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await fetch(`${this.serverBaseUrl}/api/admin/driver-utility${qs}`, {
        headers: this.authHeaders(),
      });
      if (!res.ok) return { logs: [], tripStarts: [], summary: emptySummary };
      const data = await res.json();
      return {
        logs: Array.isArray(data.logs) ? data.logs : [],
        tripStarts: Array.isArray(data.tripStarts) ? data.tripStarts : [],
        summary: data.summary || emptySummary,
      };
    } catch {
      return { logs: [], tripStarts: [], summary: emptySummary };
    }
  }

  public async registerStudent(payload: {
    rollNumber: string;
    name: string;
    email: string;
    password: string;
    studentPhone: string;
    pickupStop: string;
  }): Promise<{ success: boolean; message?: string; status?: string }> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/students/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, message: data.error || 'Registration failed' };
      }
      return { success: true, message: data.message, status: data.status };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Network error during registration' };
    }
  }

  public async listPendingVerifications(): Promise<Array<{
    roll_number: string;
    name: string;
    email: string;
    student_phone: string;
    pickup_stop: string;
    registered_at: string;
    verification_status: string;
  }>> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/admin/pending-verifications`, {
        headers: this.authHeaders(),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.pending) ? data.pending : [];
    } catch {
      return [];
    }
  }

  public async verifyStudentRegistration(
    rollNumber: string,
    payload: { approved: boolean; routeId?: string; pickupStop?: string },
  ): Promise<{ success: boolean; message?: string }> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/admin/students/${encodeURIComponent(rollNumber)}/verify`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      return { success: res.ok, message: data.error };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Network error' };
    }
  }

  /* ---------------- Absences ("Not Travelling") ---------------- */
  public async setAbsenceTomorrow(
    on: boolean,
    rollNumber?: string,
    day?: 'TODAY' | 'TOMORROW',
  ): Promise<{ ok: boolean; status: number; locked?: boolean; lockReason?: string | null; cutoffIso?: string | null; error?: string; routePlan?: any }> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/students/absence`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ on, rollNumber, ...(day ? { day } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      return {
        ok: res.ok,
        status: res.status,
        locked: Boolean(data.locked),
        lockReason: data.lockReason ?? null,
        cutoffIso: data.cutoffIso || null,
        error: data.error,
        routePlan: data.routePlan,
      };
    } catch (err: any) {
      return { ok: false, status: 0, lockReason: null, error: err?.message || 'Network error' };
    }
  }

  public async getAbsenceTomorrow(
    rollNumber?: string,
    day?: 'TODAY' | 'TOMORROW',
  ): Promise<{ absentTomorrow: boolean; locked?: boolean; lockReason?: string | null; cutoffIso?: string | null; routePlan?: any }> {
    try {
      const params = new URLSearchParams();
      if (rollNumber) params.set('rollNumber', rollNumber);
      if (day) params.set('day', day);
      const qs = params.toString();
      const url = qs
        ? `${this.serverBaseUrl}/api/students/absence?${qs}`
        : `${this.serverBaseUrl}/api/students/absence`;
      const res = await fetch(url, { headers: this.authHeaders() });
      if (!res.ok) return { absentTomorrow: false, lockReason: null };
      const data = await res.json();
      return {
        absentTomorrow: Boolean(data.absentTomorrow),
        locked: Boolean(data.locked),
        lockReason: data.lockReason ?? null,
        cutoffIso: data.cutoffIso || null,
        routePlan: data.routePlan,
      };
    } catch {
      return { absentTomorrow: false, lockReason: null };
    }
  }

  public async getRouteOptimization(routeId: string, day?: string): Promise<any> {
    try {
      const url = day
        ? `${this.serverBaseUrl}/api/routes/${encodeURIComponent(routeId)}/optimization?day=${encodeURIComponent(day)}`
        : `${this.serverBaseUrl}/api/routes/${encodeURIComponent(routeId)}/optimization`;
      const res = await fetch(url, { headers: this.authHeaders() });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  public async controlRouteOptimization(
    routeId: string,
    action: 'LOCK' | 'UNLOCK' | 'OVERRIDE_KEEP_CLUSTER' | 'CLEAR_OVERRIDE',
    clusterId?: string,
    day?: string
  ): Promise<{ success: boolean; plan?: any; error?: string }> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/admin/routes/${encodeURIComponent(routeId)}/optimization-control`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ action, clusterId, day }),
      });
      const data = await res.json().catch(() => ({}));
      return { success: res.ok, plan: data.plan, error: data.error };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Network error' };
    }
  }

  /* ---------------- Trip State & Delay ---------------- */
  public async getRouteTripState(routeId: string): Promise<{ running: boolean; delayMinutes: number; headcount: number; startedAt?: string | null; expectedTomorrow: number; absentTomorrowCount?: number; hasRosterData?: boolean }> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/bus/state/${encodeURIComponent(routeId)}`, { headers: this.authHeaders() });
      if (!res.ok) return { running: false, delayMinutes: 0, headcount: 0, startedAt: null, expectedTomorrow: 0, absentTomorrowCount: 0, hasRosterData: false };
      const d = await res.json();
      return {
        running: Boolean(d.running),
        delayMinutes: Number(d.delayMinutes || 0),
        headcount: Number(d.headcount || 0),
        startedAt: d.startedAt || null,
        expectedTomorrow: Number(d.expectedTomorrow || 0),
        absentTomorrowCount: Number(d.absentTomorrowCount || 0),
        hasRosterData: Boolean(d.hasRosterData),
      };
    } catch {
      return { running: false, delayMinutes: 0, headcount: 0, startedAt: null, expectedTomorrow: 0, absentTomorrowCount: 0, hasRosterData: false };
    }
  }

  public async setTripRunning(running: boolean, routeId: string = 'route-14'): Promise<boolean> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/bus/trip`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ running, routeId }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  public async setTripDelay(delayMinutes: number, routeId: string = 'route-14'): Promise<boolean> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/bus/delay`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ delayMinutes, routeId }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /* ---------------- Incidents & Announcements ---------------- */
  public async reportIncident(kind: 'SOS' | 'BREAKDOWN', msg: string, routeId: string = 'route-14'): Promise<boolean> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/incidents`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ kind, msg, routeId }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  public async fetchIncidents(openOnly: boolean = true): Promise<any[]> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/incidents?open=${openOnly}`, { headers: this.authHeaders() });
      if (!res.ok) return [];
      const d = await res.json();
      return d.incidents || [];
    } catch {
      return [];
    }
  }

  public async resolveIncident(id: number): Promise<boolean> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/incidents/${id}/resolve`, {
        method: 'POST',
        headers: this.authHeaders(),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  public async fetchAnnouncements(routeId?: string): Promise<any[]> {
    try {
      const url = routeId ? `${this.serverBaseUrl}/api/announcements?routeId=${encodeURIComponent(routeId)}` : `${this.serverBaseUrl}/api/announcements`;
      const res = await fetch(url, { headers: this.authHeaders() });
      if (!res.ok) return [];
      const d = await res.json();
      return d.announcements || [];
    } catch {
      return [];
    }
  }

  public async createAnnouncement(msg: string, routeId: string = 'route-14'): Promise<boolean> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/announcements`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ msg, routeId }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  public async deleteAnnouncement(id: number): Promise<boolean> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/announcements/${id}/delete`, {
        method: 'POST',
        headers: this.authHeaders(),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /* ---------------- Lost & Found ---------------- */
  public async reportLostItem(msg: string, contact?: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/lost`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ msg, contact }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  public async fetchLostItems(openOnly: boolean = false): Promise<any[]> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/lost?open=${openOnly}`, { headers: this.authHeaders() });
      if (!res.ok) return [];
      const d = await res.json();
      return d.items || [];
    } catch {
      return [];
    }
  }

  public async resolveLostItem(id: number): Promise<boolean> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/lost/${id}/resolve`, {
        method: 'POST',
        headers: this.authHeaders(),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /* ---------------- Ride Feedback ---------------- */
  public async submitFeedback(rating: number, msg: string, routeId: string = 'route-14'): Promise<boolean> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/feedback`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ rating, msg, routeId }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  public async fetchFeedback(): Promise<any[]> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/feedback`, { headers: this.authHeaders() });
      if (!res.ok) return [];
      const d = await res.json();
      return d.feedback || [];
    } catch {
      return [];
    }
  }

  /* ---------------- CSV Exports ---------------- */
  public async downloadCsvExport(
    type: 'incidents' | 'feedback' | 'absences' | 'lost' | 'boardings' | 'driver_utility',
    filters?: { routeId?: string; date?: string }
  ): Promise<void> {
    const params = new URLSearchParams({ type });
    if (filters?.routeId) params.set('routeId', filters.routeId);
    if (filters?.date) params.set('date', filters.date);
    const res = await fetch(`${this.serverBaseUrl}/api/export?${params.toString()}`, {
      headers: this.authHeaders(),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error('Export failed. Admin sign-in required.');
    this.triggerFileDownload(await res.blob(), `${type}.csv`);
  }

  public async getContactInfo(rollNumber?: string): Promise<{
    success: boolean;
    rollNumber: string;
    studentName: string;
    studentPhone: string;
    studentPhoneVerified: boolean;
    parentName: string;
    parentPhone: string;
    parentPhoneVerified: boolean;
  } | null> {
    try {
      const q = rollNumber ? `?rollNumber=${encodeURIComponent(rollNumber)}` : '';
      const r = await fetch(`${this.serverBaseUrl}/api/users/contact${q}`, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(8000),
      });
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  }

  public async requestOtp(phoneNumber: string): Promise<{ success: boolean; simulatedOtp?: string; message?: string; error?: string; verified?: boolean; mode?: string } | null> {
    try {
      const r = await fetch(`${this.serverBaseUrl}/api/otp/request`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ phoneNumber }),
        signal: AbortSignal.timeout(8000),
      });
      return await r.json();
    } catch (e: any) {
      return { success: false, error: e.message || 'Network error' };
    }
  }

  public async verifyOtp(phoneNumber: string, otp: string, userType: 'STUDENT' | 'PARENT' = 'STUDENT', rollNumber?: string): Promise<{ success: boolean; error?: string } | null> {
    try {
      const r = await fetch(`${this.serverBaseUrl}/api/otp/verify`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ phoneNumber, otp, userType, rollNumber }),
        signal: AbortSignal.timeout(8000),
      });
      return await r.json();
    } catch (e: any) {
      return { success: false, error: e.message || 'Verification failed' };
    }
  }

  public async getNotificationFeed(rollNumber?: string, userType?: string): Promise<any[]> {
    try {
      const params = new URLSearchParams();
      if (rollNumber) params.set('rollNumber', rollNumber);
      if (userType) params.set('userType', userType);
      const q = params.toString() ? `?${params.toString()}` : '';
      const r = await fetch(`${this.serverBaseUrl}/api/notifications/feed${q}`, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d.notifications) ? d.notifications : [];
    } catch {
      return [];
    }
  }

  public async getNotificationPreferences(rollNumber?: string, userType?: string): Promise<any> {
    try {
      const params = new URLSearchParams();
      if (rollNumber) params.set('rollNumber', rollNumber);
      if (userType) params.set('userType', userType);
      const q = params.toString() ? `?${params.toString()}` : '';
      const r = await fetch(`${this.serverBaseUrl}/api/notifications/preferences${q}`, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return null;
      const d = await r.json();
      return d.preferences || null;
    } catch {
      return null;
    }
  }

  public async saveNotificationPreferences(preferences: any, rollNumber?: string, userType?: string): Promise<boolean> {
    try {
      const r = await fetch(`${this.serverBaseUrl}/api/notifications/preferences`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ preferences, rollNumber, userType }),
        signal: AbortSignal.timeout(8000),
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  public async boardStop(
    stopName: string, 
    count: number = 1, 
    students?: Array<{ rollNumber: string; name: string }>
  ): Promise<{ success: boolean; headcount?: number }> {
    try {
      const r = await fetch(`${this.serverBaseUrl}/api/driver/board-stop`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ stopName, count, students }),
        signal: AbortSignal.timeout(8000),
      });
      return r.ok ? await r.json() : { success: false };
    } catch {
      return { success: false };
    }
  }

  public async startStopTimer(stopName: string, durationSeconds: number = 120): Promise<boolean> {
    try {
      const r = await fetch(`${this.serverBaseUrl}/api/trips/timer`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ stopName, durationSeconds }),
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  public async clearStopTimer(): Promise<boolean> {
    try {
      const r = await fetch(`${this.serverBaseUrl}/api/trips/clear-timer`, {
        method: 'POST',
        headers: this.authHeaders(),
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  public async getStopTimer(routeId: string): Promise<{ success: boolean; active: boolean; stopName?: string; remainingSeconds?: number }> {
    try {
      const r = await fetch(`${this.serverBaseUrl}/api/trips/timer/${encodeURIComponent(routeId)}`, {
        headers: this.authHeaders(),
      });
      return r.ok ? await r.json() : { success: false, active: false };
    } catch {
      return { success: false, active: false };
    }
  }

  public async optOutStop(routeId: string, note?: string): Promise<boolean> {
    try {
      const r = await fetch(`${this.serverBaseUrl}/api/trips/opt-out`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ routeId, note }),
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  public async getBusState(routeId: string): Promise<{ success: boolean; running?: boolean; delayMinutes?: number; assignedCount?: number; expectedTomorrow?: number }> {
    try {
      const norm = (routeId || 'route-14').toLowerCase();
      const r = await fetch(`${this.serverBaseUrl}/api/bus/state/${encodeURIComponent(norm)}`, {
        headers: this.authHeaders(),
      });
      return r.ok ? await r.json() : { success: false };
    } catch {
      return { success: false };
    }
  }

  public async changePassword(current: string, next: string): Promise<{ success: boolean; message?: string; token?: string }> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/students/me/password`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ current, next }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        if (data.token) this.setAuthToken(data.token);
        return { success: true, token: data.token };
      }
      return { success: false, message: data.error || 'Failed to update password' };
    } catch {
      return { success: false, message: 'Network error updating password' };
    }
  }

  public async getStudentProfile(): Promise<any> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/students/me`, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const s = data.student || null;

      // Update offline pass cache with latest profile details if available
      if (typeof window !== 'undefined' && s) {
        try {
          const roll = s.roll_number || s.rollNumber || '';
          const existingRaw = localStorage.getItem('sreenidhi_offline_pass_v1');
          let existing: any = {};
          if (existingRaw) {
            try { existing = JSON.parse(existingRaw); } catch { }
          }
          const snapshot = {
            rollNumber: roll || existing.rollNumber || '',
            name: s.student_name || s.name || existing.name || '',
            routeId: s.route_id || s.routeId || existing.routeId || '',
            pickupStop: s.pickup_stop || s.pickupStop || existing.pickupStop || '',
            feeStatus: s.fee_status || s.feeStatus || existing.feeStatus || 'PAID',
            passStatus: s.pass_status || s.passStatus || existing.passStatus || 'ACTIVE',
            canTravel: s.can_travel !== undefined ? Boolean(s.can_travel) : (existing.canTravel !== undefined ? existing.canTravel : true),
            cachedAt: Date.now(),
          };
          localStorage.setItem('sreenidhi_offline_pass_v1', JSON.stringify(snapshot));
        } catch { }
      }

      return s;
    } catch {
      return null;
    }
  }

  public async resetBillingCycle(newCycle?: string): Promise<{ success: boolean; resetCount?: number; newCycle?: string }> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/admin/billing-cycle/reset`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ newCycle }),
        signal: AbortSignal.timeout(8000),
      });
      return res.ok ? await res.json() : { success: false };
    } catch {
      return { success: false };
    }
  }

  public async listApplications(): Promise<any[]> {
    try {
      const r = await fetch(`${this.serverBaseUrl}/api/applications`, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d.applications) ? d.applications : [];
    } catch {
      return [];
    }
  }

  public async reviewApplication(id: string, status: 'APPROVED' | 'REJECTED', adminNote: string = ''): Promise<boolean> {
    try {
      const r = await fetch(`${this.serverBaseUrl}/api/applications/${encodeURIComponent(id)}/scrutiny`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ status, adminNote }),
        signal: AbortSignal.timeout(8000),
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  public async createTelegramLinkCode(): Promise<{ code: string; deepLink?: string } | null> {
    try {
      const r = await fetch(`${this.serverBaseUrl}/api/students/me/parent-link-code`, {
        method: 'POST',
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }

  public async fetchGateToken(): Promise<{ token: string; qrPayload: string; refreshInSeconds: number } | null> {
    try {
      const r = await fetch(`${this.serverBaseUrl}/api/driver/gate-token`, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(6000),
      });
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  }

  public clearAuthSession(): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(AUTH_SESSION_KEY);
      localStorage.removeItem(AUTH_TOKEN_KEY);
      localStorage.removeItem('sreenidhi_offline_pass_v1');
    } catch { }
  }

  /**
   * Downloads the real .xlsx file from backend if available, or generates it on-the-fly in browser!
   */
  /** Admin export. Throws on failure: the old fallback built a workbook of hard-coded sample rows that looked like real data. */
  public async downloadExcelWorkbook(_options?: unknown): Promise<void> {
    const res = await fetch(`${this.serverBaseUrl}/api/excel/download`, { headers: this.authHeaders(), signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(res.status === 403 || res.status === 401 ? 'Admin sign-in required' : 'Export failed. Try again.');
    this.triggerFileDownload(await res.blob(), 'sreenidhi_transit_master.xlsx');
  }

  private triggerFileDownload(blob: Blob, filename: string): void {
    if (typeof window === 'undefined') return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 150);
  }

  /* ---------------- Web Push Subscriptions (VAPID, ₹0) ---------------- */
  public async getVapidPublicKey(): Promise<{ enabled: boolean; publicKey: string | null }> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/push/vapid-public-key`, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok ? await res.json() : { enabled: false, publicKey: null };
    } catch {
      return { enabled: false, publicKey: null };
    }
  }

  public async subscribePush(subscription: any): Promise<{ success: boolean; message?: string }> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/push/subscribe`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(subscription),
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? { success: true } : { success: false, message: data.error };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Failed to register push subscription' };
    }
  }

  public async unsubscribePush(endpoint: string): Promise<{ success: boolean }> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/push/subscribe`, {
        method: 'DELETE',
        headers: this.authHeaders(),
        body: JSON.stringify({ endpoint }),
        signal: AbortSignal.timeout(6000),
      });
      return { success: res.ok };
    } catch {
      return { success: false };
    }
  }

  /* ---------------- Predictive ETAs ---------------- */
  public async recordSegmentArrival(routeId: string, fromStopId: string, toStopId: string, durationSec: number): Promise<{ success: boolean }> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/bus/segment-arrival`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ routeId, fromStopId, toStopId, durationSec }),
        signal: AbortSignal.timeout(6000),
      });
      return { success: res.ok };
    } catch {
      return { success: false };
    }
  }

  public async fetchEtaModel(routeId: string): Promise<{ routeId: string; dayOfWeek: number; shift: string; segments: Record<string, { medianSec: number; sampleCount: number }> } | null> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/routes/${encodeURIComponent(routeId)}/eta-model`, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(6000),
      });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  /* ---------------- Canonical Route Topology API ---------------- */
  public async fetchCanonicalRoutes(): Promise<any[]> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/routes`, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        const rawRoutes = Array.isArray(data?.routes)
          ? data.routes
          : data?.routes && typeof data.routes === 'object'
            ? Object.values(data.routes)
            : [];
        if (rawRoutes.length > 0) {
          if (typeof window !== 'undefined') {
            try {
              localStorage.setItem('sreenidhi_routes_cache_v1', JSON.stringify(rawRoutes));
            } catch { }
          }
          return rawRoutes;
        }
      }
    } catch { }

    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('sreenidhi_routes_cache_v1');
        if (raw) return JSON.parse(raw);
      } catch { }
    }

    return INITIAL_BUS_FLEET;
  }

  /* ---------------- Bulk Excel Onboarding ---------------- */
  public async bulkImportStudents(riders: any[]): Promise<{ success: boolean; createdCount: number; skippedExistingCount: number; errors: any[]; credentials: any[] }> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/admin/students/bulk-import`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ riders }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? data : { success: false, createdCount: 0, skippedExistingCount: 0, errors: [{ error: data.error || 'Import failed' }], credentials: [] };
    } catch (err: any) {
      return { success: false, createdCount: 0, skippedExistingCount: 0, errors: [{ error: err?.message || 'Network error' }], credentials: [] };
    }
  }

  /* ---------------- Live SQLite Backup ---------------- */
  public async createDatabaseBackup(): Promise<{ success: boolean; fileName?: string; backupCount?: number }> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/admin/db/backup`, {
        method: 'POST',
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(15000),
      });
      return res.ok ? await res.json() : { success: false };
    } catch {
      return { success: false };
    }
  }

  public async triggerDatabaseBackup(): Promise<{ success: boolean; fileName?: string; backupCount?: number }> {
    return this.createDatabaseBackup();
  }

  /* ---------------- Admin Live Diagnostics ---------------- */
  public async getAdminHealth(): Promise<{
    activeSseClients: number;
    liveRoutes: number;
    staleRoutes: string[];
    walBytes: number;
    lastBackupFile: string | null;
    lastBackupAt: number | null;
    uptimeSec: number;
    memoryMb: number;
  } | null> {
    try {
      const res = await fetch(`${this.serverBaseUrl}/api/admin/health`, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }
}

export const excelService = new ExcelService();
