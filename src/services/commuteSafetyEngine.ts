// Sreenidhi TransitPulse - Real GPS Oversleep & Early-Exit Watchdog Engine (₹0 Cost)
import { nativeDeviceService } from './nativeDeviceService';
import { audioSpeechService } from './audioSpeechService';
import { firebaseService } from './firebaseService';
import { excelService } from './excelService';
import type { RouteStop, StudentRecord } from '../types/transit';

export interface WatchdogCallbacks {
  onWakeUpAlert: (stopName: string, distanceMeters: number) => void;
  onOversleepAlert: (stopName: string, speedKmh: number) => void;
  onEarlyExitAlert: (stopName: string) => void;
  getBusLocation?: () => { lat: number; lng: number } | null;
}

class CommuteSafetyEngine {
  private activeWatchStop: (() => void) | null = null;
  private hasFired1KmWakeUp = false;
  private hasEnteredDropGeofence = false;
  private minDistanceToDropMeters = Infinity;
  private prevDistanceToDropMeters: number | null = null;
  private lowSpeedStartTime: number | null = null;

  public startStudentSafetyWatch(
    student: StudentRecord,
    targetDropStop: RouteStop,
    allRouteStops: RouteStop[],
    callbacks: WatchdogCallbacks
  ): void {
    // Reset trip state flags
    this.stopSafetyWatch();
    this.hasFired1KmWakeUp = false;
    this.hasEnteredDropGeofence = false;
    this.minDistanceToDropMeters = Infinity;
    this.prevDistanceToDropMeters = null;
    this.lowSpeedStartTime = null;

    console.log(`[SafetyEngine] Activated watchdog for ${student.name} -> Target Stop: ${targetDropStop.name}`);

    // Watch student's live phone GPS coordinates
    void nativeDeviceService.watchLiveGps((lat, lng, speedKmh) => {
      // 1. Distance to assigned drop stop
      const distToDropMeters = this.distanceMeters(
        lat,
        lng,
        targetDropStop.lat,
        targetDropStop.lng
      );

      if (distToDropMeters < this.minDistanceToDropMeters) {
        this.minDistanceToDropMeters = distToDropMeters;
      }

      // Check if student entered the drop stop vicinity (<= 150m)
      if (distToDropMeters <= 150) {
        this.hasEnteredDropGeofence = true;
      }

      // A) 1 km Pre-Stop Wake-Up Alarm
      if (
        student.wakeUpAlarmEnabled &&
        !this.hasFired1KmWakeUp &&
        distToDropMeters <= 1000 &&
        distToDropMeters > 200
      ) {
        this.hasFired1KmWakeUp = true;
        audioSpeechService.playWakeUpChime();
        void nativeDeviceService.sendMobileNotification(
          '🔔 Wake-Up Alarm: Approaching Your Stop!',
          `You are within 1 km of ${targetDropStop.name}. Prepare to alight.`
        );
        void nativeDeviceService.triggerHaptic('heavy');
        callbacks.onWakeUpAlert(targetDropStop.name, Math.round(distToDropMeters));
      }

      // B) Oversleep Detection:
      // If student was within 150m of their stop, and is now moving >250m away from it at speed >18 km/h
      if (
        this.hasEnteredDropGeofence &&
        distToDropMeters > 250 &&
        speedKmh > 18
      ) {
        console.warn(`[SafetyEngine] OVERSLEEP DETECTED for ${student.name} past ${targetDropStop.name}`);
        callbacks.onOversleepAlert(targetDropStop.name, speedKmh);

        // Authoritative parent alert via server & Telegram
        void excelService.notifyParentTelegram({
          category: 'OVERSLEEP_MISSED_STOP',
          studentRoll: student.rollNumber,
          note: `Missed assigned stop at ${targetDropStop.name}; continuing on bus.`
        });

        // Mirror to Firebase RTDB for real-time dashboards
        void firebaseService.recordParentAlertLog({
          recipientPhone: student.parentPhoneMasked,
          recipientName: student.parentName,
          category: 'OVERSLEEP_EMERGENCY',
          title: 'Student Missed Assigned Stop',
          message: `Alert: ${student.name} missed stop at ${targetDropStop.name} and is continuing on Route ${student.routeId}. Driver notified.`,
          deliveryStatus: 'DELIVERED_LIVE',
        });

        // Clear flag so it doesn't repeatedly fire in a loop
        this.hasEnteredDropGeofence = false;
      }

      // C) Early Exit Detection (Traffic-Differentiated):
      // Differentiate traffic jams from actual alighting:
      // 1. Must be near an earlier stop (< 100m)
      // 2. Must be moving at pedestrian speed (< 4 km/h) for >= 90 seconds
      // 3. Must be separated from the bus (distStudentToBus >= 60m) - if distStudentToBus < 50m, student is still inside the bus in traffic!
      // 4. Distance to target drop stop must not be decreasing (bus not continuing together with student)
      const earlierStop = allRouteStops.find((s) => {
        if (s.id === targetDropStop.id || s.sequence >= targetDropStop.sequence) return false;
        return this.distanceMeters(lat, lng, s.lat, s.lng) <= 100;
      });

      const busLoc = callbacks.getBusLocation ? callbacks.getBusLocation() : null;
      const isSeparatedFromBus = busLoc ? this.distanceMeters(lat, lng, busLoc.lat, busLoc.lng) >= 60 : true;

      const isDistanceStagnantOrIncreasing =
        this.prevDistanceToDropMeters !== null &&
        distToDropMeters >= this.prevDistanceToDropMeters - 15;

      if (earlierStop && speedKmh < 4 && isSeparatedFromBus && isDistanceStagnantOrIncreasing) {
        if (!this.lowSpeedStartTime) {
          this.lowSpeedStartTime = Date.now();
        } else if (Date.now() - this.lowSpeedStartTime > 90000) {
          // 90 seconds of pedestrian speed at an earlier stop with non-progressing distance
          callbacks.onEarlyExitAlert(earlierStop.name);
          void excelService.notifyParentTelegram({
            category: 'EARLY_EXIT',
            studentRoll: student.rollNumber,
            note: `Student alighted early at ${earlierStop.name} instead of assigned terminus ${targetDropStop.name}.`
          });
          void firebaseService.recordParentAlertLog({
            recipientPhone: student.parentPhoneMasked,
            recipientName: student.parentName,
            category: 'EARLY_EXIT_ALERT',
            title: 'Unscheduled Early Stop Alight',
            message: `${student.name} alighted early at ${earlierStop.name} instead of default stop ${targetDropStop.name}.`,
            deliveryStatus: 'DELIVERED_LIVE',
          });
          this.stopSafetyWatch();
        }
      } else {
        this.lowSpeedStartTime = null;
      }
      this.prevDistanceToDropMeters = distToDropMeters;
    }).then((stop) => {
      this.activeWatchStop = stop;
    });
  }

  public stopSafetyWatch(): void {
    if (this.activeWatchStop) {
      this.activeWatchStop();
      this.activeWatchStop = null;
    }
  }

  private distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // Earth radius in meters
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

export const commuteSafetyEngine = new CommuteSafetyEngine();
