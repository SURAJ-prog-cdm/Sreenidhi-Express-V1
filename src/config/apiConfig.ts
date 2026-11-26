import type { ApiKeysConfig } from '../types/transit';

const STORAGE_KEY = 'sreenidhi_transitpulse_api_config_v1';

export function loadEnvDefaults(): ApiKeysConfig {
  return {
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() || '',
    firebaseApiKey: import.meta.env.VITE_FIREBASE_API_KEY?.trim() || '',
    firebaseAuthDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim() || '',
    firebaseDatabaseUrl: import.meta.env.VITE_FIREBASE_DATABASE_URL?.trim() || '',
    firebaseProjectId: import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim() || '',
  };
}

export function loadLocalOverrides(): Partial<ApiKeysConfig> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<ApiKeysConfig>;
  } catch {
    return {};
  }
}

export function loadEffectiveApiConfig(): ApiKeysConfig {
  const envDefaults = loadEnvDefaults();
  const overrides = loadLocalOverrides();
  return {
    googleMapsApiKey: overrides.googleMapsApiKey || envDefaults.googleMapsApiKey,
    firebaseApiKey: overrides.firebaseApiKey || envDefaults.firebaseApiKey,
    firebaseAuthDomain: overrides.firebaseAuthDomain || envDefaults.firebaseAuthDomain,
    firebaseDatabaseUrl: overrides.firebaseDatabaseUrl || envDefaults.firebaseDatabaseUrl,
    firebaseProjectId: overrides.firebaseProjectId || envDefaults.firebaseProjectId,
  };
}

export function saveApiOverrides(config: ApiKeysConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage quota errors in private mode
  }
}

export function clearApiOverrides(): ApiKeysConfig {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
  return loadEnvDefaults();
}

export function getConfigSources(): Record<keyof ApiKeysConfig, 'ENV' | 'LOCAL_STORAGE' | 'UNSET'> {
  const env = loadEnvDefaults();
  const local = loadLocalOverrides();
  const keys = Object.keys(env) as (keyof ApiKeysConfig)[];
  const result = {} as Record<keyof ApiKeysConfig, 'ENV' | 'LOCAL_STORAGE' | 'UNSET'>;
  for (const k of keys) {
    if (local[k]) result[k] = 'LOCAL_STORAGE';
    else if (env[k]) result[k] = 'ENV';
    else result[k] = 'UNSET';
  }
  return result;
}
