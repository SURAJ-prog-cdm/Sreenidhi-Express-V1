import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { LocalNotifications } from '@capacitor/local-notifications';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';

class NativeDeviceService {
  private wakeLockSentinel: any = null;

  public isWakeLockActive(): boolean {
    return Boolean(this.wakeLockSentinel && !this.wakeLockSentinel.released);
  }

  public async acquireWakeLock(): Promise<boolean> {
    try {
      if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
        if (this.wakeLockSentinel && !this.wakeLockSentinel.released) {
          return true;
        }
        this.wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
        this.wakeLockSentinel.addEventListener('release', () => {
          console.log('[NativeDeviceService] Screen wake lock released by OS/browser');
        });
        console.log('[NativeDeviceService] Screen wake lock acquired');
        return true;
      }
    } catch (err) {
      console.warn('[NativeDeviceService] Could not acquire screen wake lock:', err);
    }
    return false;
  }

  public releaseWakeLock(): void {
    try {
      if (this.wakeLockSentinel) {
        this.wakeLockSentinel.release();
        this.wakeLockSentinel = null;
        console.log('[NativeDeviceService] Screen wake lock released');
      }
    } catch {
      // Ignore
    }
  }

  public isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  public getPlatformLabel(): 'android' | 'ios' | 'web' {
    const p = Capacitor.getPlatform();
    if (p === 'android' || p === 'ios') return p;
    return 'web';
  }

  public async initMobileShell(): Promise<void> {
    if (this.isNative()) {
      try {
        await StatusBar.setStyle({ style: Style.Dark });
        await StatusBar.setBackgroundColor({ color: '#181C24' });
      } catch {
        // Ignore on unsupported platform configs
      }
      try {
        await SplashScreen.hide();
      } catch {
        // Ignore
      }
      try {
        await LocalNotifications.requestPermissions();
      } catch {
        // Ignore
      }
    } else if (import.meta.env.DEV && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      // In development mode only, auto-clear stale service workers to prevent cached white-screen lockouts or dev request interception
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of regs) {
          await reg.unregister();
        }
        if (typeof caches !== 'undefined') {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      } catch {
        // Non-fatal
      }
    }
  }

  public async triggerHaptic(level: 'light' | 'medium' | 'heavy' = 'light'): Promise<void> {
    if (this.isNative()) {
      try {
        const style =
          level === 'heavy'
            ? ImpactStyle.Heavy
            : level === 'medium'
              ? ImpactStyle.Medium
              : ImpactStyle.Light;
        await Haptics.impact({ style });
        return;
      } catch {
        // Fallback below
      }
    }
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(level === 'heavy' ? 45 : level === 'medium' ? 25 : 12);
    }
  }

  public async sendMobileNotification(title: string, body: string): Promise<void> {
    if (this.isNative()) {
      try {
        await LocalNotifications.schedule({
          notifications: [
            {
              id: Math.floor(Date.now() % 2147483647),
              title,
              body,
              schedule: { at: new Date(Date.now() + 150) },
            },
          ],
        });
        return;
      } catch {
        // Fallback below
      }
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(title, { body, icon: '/app-icon.svg' });
      } catch {
        // Ignore
      }
    }
  }

  /**
   * Live GPS. Fixes: a stopped bus (speed 0) was reported as 28 km/h because `speed ? … : 28` treats 0 and null alike.
   * Speed now comes from the chip when valid, else from distance/time between fixes, else 0 — never a made-up number.
   * Fixes worse than MAX_ACCURACY_M are dropped (tunnels / flyovers produce 500 m+ jumps).
   * NOTE: watchPosition stops when the app is backgrounded or the screen locks; see PATCHES.md §"Background GPS" for the foreground service.
   */
  public async watchLiveGps(
    onFix: (lat: number, lng: number, speedKmh: number, accuracyM?: number) => void,
    onError?: (msg: string) => void,
  ): Promise<() => void> {
    const MAX_ACCURACY_M = 100;
    let last: { lat: number; lng: number; t: number } | null = null;

    const handle = (c: { latitude: number; longitude: number; speed?: number | null; accuracy?: number | null }, t: number) => {
      if (typeof c.accuracy === 'number' && c.accuracy > MAX_ACCURACY_M) return;
      let kmh = 0;
      if (typeof c.speed === 'number' && Number.isFinite(c.speed) && c.speed >= 0) {
        kmh = c.speed * 3.6;
      } else if (last && t > last.t) {
        const R = 6371, rad = (d: number) => (d * Math.PI) / 180;
        const dLat = rad(c.latitude - last.lat), dLng = rad(c.longitude - last.lng);
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(last.lat)) * Math.cos(rad(c.latitude)) * Math.sin(dLng / 2) ** 2;
        kmh = (2 * R * Math.asin(Math.sqrt(h))) / ((t - last.t) / 3.6e6);
      }
      last = { lat: c.latitude, lng: c.longitude, t };
      onFix(c.latitude, c.longitude, Math.min(140, Math.round(kmh)), c.accuracy ?? undefined);
    };

    if (this.isNative()) {
      try {
        const perm = await Geolocation.requestPermissions();
        if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
          onError?.('Location permission denied. Enable it in Settings to share the bus position.');
          return () => undefined;
        }
        const watchId = await Geolocation.watchPosition(
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 2000 },
          (pos, err) => {
            if (err) { onError?.(err.message); return; }
            if (pos) handle(pos.coords, pos.timestamp);
          },
        );
        return () => { void Geolocation.clearWatch({ id: watchId }); };
      } catch (err) {
        onError?.(err instanceof Error ? err.message : 'Native GPS permission denied');
        return () => undefined;
      }
    }

    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      const id = navigator.geolocation.watchPosition(
        (pos) => handle(pos.coords, pos.timestamp),
        (err) => onError?.(err.message || 'Browser GPS unavailable'),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 2000 },
      );
      return () => navigator.geolocation.clearWatch(id);
    }

    onError?.('Geolocation API unavailable on this device');
    return () => undefined;
  }

  /**
   * Hardware BLE gate scanning helper (zero-hardware prototype mode).
   */
  public async scanGateBeaconToken(_opts: { timeoutMs?: number; minRssi?: number } = {}): Promise<{ detected: boolean; token?: string; rssi?: number; reason: string }> {
    return { detected: false, reason: 'BLE gate beacon scanner is disabled in ₹0 zero-hardware deployment mode.' };
  }

  /**
   * Optional non-blocking Capacitor BLE proximity check-in helper.
   * Only activates on native Capacitor shells where BluetoothLe plugin is installed;
   * web browsers and hardware-free deployments rely on 1-tap "I'm On Board" check-in.
   */
  public async tryProximityBleCheckIn(
    routeId: string,
    onDetected: (method: 'BLE_PROXIMITY' | 'STUDENT_SELF_TAP') => void,
  ): Promise<() => void> {
    if (!this.isNative() || typeof window === 'undefined') {
      return () => undefined;
    }

    const ble = (window as unknown as {
      Capacitor?: {
        Plugins?: {
          BluetoothLe?: {
            initialize?: (opts?: { androidNeverForLocation?: boolean }) => Promise<void>;
            requestLEScan?: (
              opts: { allowDuplicates?: boolean },
              cb: (result: { device?: { name?: string }; localName?: string; rssi?: number }) => void,
            ) => Promise<void>;
            stopLEScan?: () => Promise<void>;
          };
        };
      };
    })?.Capacitor?.Plugins?.BluetoothLe;

    if (!ble || typeof ble.requestLEScan !== 'function') {
      return () => undefined;
    }

    let stopped = false;
    let triggered = false;
    const digits = String(routeId || '').replace(/\D+/g, '');
    const matchPrefixes = ['SREENIDHI-BUS', digits ? `BUS-${digits}` : '', digits ? `ROUTE-${digits}` : ''].filter(Boolean);

    const cleanup = () => {
      if (stopped) return;
      stopped = true;
      try {
        void ble.stopLEScan?.();
      } catch {
        // Ignore scan cleanup errors
      }
    };

    try {
      await ble.initialize?.({ androidNeverForLocation: true });
      await ble.requestLEScan({ allowDuplicates: true }, (result) => {
        if (stopped || triggered) return;
        const name = String(result?.localName || result?.device?.name || '').toUpperCase();
        const rssi = typeof result?.rssi === 'number' ? result.rssi : -999;
        if (rssi >= -72 && matchPrefixes.some((p) => name.includes(p))) {
          triggered = true;
          cleanup();
          onDetected('BLE_PROXIMITY');
        }
      });
      const timer = setTimeout(cleanup, 15000);
      return () => {
        clearTimeout(timer);
        cleanup();
      };
    } catch {
      cleanup();
      return () => undefined;
    }
  }

  /** @deprecated Kept so existing call sites compile. */
  public async scanGateBleBeacon(_expectedBeaconName: string): Promise<{ detected: boolean; rssi?: number; reason: string; token?: string }> {
    return this.scanGateBeaconToken();
  }
}

export const nativeDeviceService = new NativeDeviceService();
