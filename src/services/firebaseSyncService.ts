import { initializeApp, getApps, deleteApp, type FirebaseApp } from 'firebase/app';
import { getDatabase, ref, set, type Database } from 'firebase/database';
import type { ApiKeysConfig, BusVehicle } from '../types/transit';

class FirebaseSyncService {
  private app: FirebaseApp | null = null;
  private db: Database | null = null;
  private activeSignature = '';

  public isConfigured(cfg: ApiKeysConfig): boolean {
    return Boolean(
      cfg.firebaseApiKey.trim() &&
        cfg.firebaseDatabaseUrl.trim() &&
        cfg.firebaseProjectId.trim(),
    );
  }

  public async connect(cfg: ApiKeysConfig): Promise<boolean> {
    if (!this.isConfigured(cfg)) {
      this.db = null;
      return false;
    }
    const sig = `${cfg.firebaseProjectId}|${cfg.firebaseDatabaseUrl}|${cfg.firebaseApiKey}`;
    if (this.db && this.activeSignature === sig) {
      return true;
    }

    try {
      for (const existing of getApps()) {
        await deleteApp(existing);
      }
      this.app = initializeApp({
        apiKey: cfg.firebaseApiKey.trim(),
        authDomain: cfg.firebaseAuthDomain.trim() || `${cfg.firebaseProjectId.trim()}.firebaseapp.com`,
        databaseURL: cfg.firebaseDatabaseUrl.trim(),
        projectId: cfg.firebaseProjectId.trim(),
      });
      this.db = getDatabase(this.app);
      this.activeSignature = sig;
      return true;
    } catch {
      this.db = null;
      return false;
    }
  }

  public async pushBusTelemetry(bus: BusVehicle): Promise<void> {
    if (!this.db) return;
    try {
      await set(ref(this.db, `sreenidhi_transit/buses/${bus.routeId}`), {
        routeNumber: bus.routeNumber,
        lat: bus.currentLat,
        lng: bus.currentLng,
        speedKmh: bus.speedKmh,
        status: bus.status,
        telemetrySource: bus.telemetrySource,
        updatedAt: Date.now(),
      });
    } catch {
      // Fail gracefully into local reactive store if Firebase rules reject anonymous write
    }
  }
}

export const firebaseSyncService = new FirebaseSyncService();
