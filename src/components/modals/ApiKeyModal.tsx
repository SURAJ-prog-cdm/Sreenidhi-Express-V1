import React, { useState } from 'react';
import {
  CheckCircle2,
  Database,
  KeyRound,
  Map as MapIcon,
  MessageSquare,
  RotateCcw,
  ShieldAlert,
  X,
} from 'lucide-react';
import { getConfigSources } from '../../config/apiConfig';
import { useCommuteSimulation } from '../../context/useCommuteSimulation';
import type { ApiKeysConfig } from '../../types/transit';

const ApiKeyModalInner: React.FC = () => {
  const {
    setIsApiKeyModalOpen,
    apiConfig,
    apiStatus,
    verifyAndHotSwapKeys,
    resetApiConfigToEnv,
  } = useCommuteSimulation();

  const [draft, setDraft] = useState<ApiKeysConfig>(apiConfig);
  const [testing, setTesting] = useState(false);

  const sources = getConfigSources();

  const handleVerifyAndSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setTesting(true);
    try {
      await verifyAndHotSwapKeys(draft);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="api-modal-title"
    >
      <div className="glass-panel max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h2 id="api-modal-title" className="font-display text-base font-bold text-slate-900 dark:text-white">
                API Key Integration & Hot-Swap Manager
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Reads <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">.env</code> first, with live browser <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">localStorage</code> overrides (no restart required).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsApiKeyModalOpen(false)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleVerifyAndSave} className="space-y-5 p-6">
          {/* Live Status Summary */}
          <div className="grid gap-2.5 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <MapIcon className="h-3.5 w-3.5" /> Maps Engine
              </div>
              <div className="mt-1 text-xs font-bold text-slate-900 dark:text-white">
                {apiStatus.googleMapsMode === 'LIVE_GOOGLE_MAPS'
                  ? 'Live Google Maps'
                  : 'Leaflet / OSM Fallback'}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <Database className="h-3.5 w-3.5" /> State Sync
              </div>
              <div className="mt-1 text-xs font-bold text-slate-900 dark:text-white">
                {apiStatus.firebaseMode === 'LIVE_FIREBASE_RTDB'
                  ? 'Firebase RTDB Connected'
                  : 'Local Reactive Store'}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <MessageSquare className="h-3.5 w-3.5" /> SMS / WhatsApp
              </div>
              <div className="mt-1 text-xs font-bold text-slate-900 dark:text-white">
                {apiStatus.notificationMode === 'CONNECTED_WEBHOOK'
                  ? 'Live Webhook Connected'
                  : 'Sandbox Audit Log'}
              </div>
            </div>
          </div>

          {apiStatus.googleMapsError && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{apiStatus.googleMapsError}</span>
            </div>
          )}

          {/* Google Maps Section */}
          <div className="space-y-2 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                1. Google Maps Platform Key (`VITE_GOOGLE_MAPS_API_KEY`)
              </label>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                Source: {sources.googleMapsApiKey}
              </span>
            </div>
            <input
              type="password"
              value={draft.googleMapsApiKey}
              onChange={(e) => setDraft((d) => ({ ...d, googleMapsApiKey: e.target.value }))}
              placeholder="AIzaSy... (leave blank for zero-key OpenStreetMap/Leaflet simulator)"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Powers live Google Maps JS rendering, Hyderabad traffic overlay, Distance Matrix ETA, and area-skipping Directions API reroutes.
            </p>
          </div>

          {/* Firebase RTDB Section */}
          <div className="space-y-2.5 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                2. Firebase Realtime Database (`VITE_FIREBASE_*`)
              </span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                Source: {sources.firebaseProjectId}
              </span>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <input
                type="password"
                value={draft.firebaseApiKey}
                onChange={(e) => setDraft((d) => ({ ...d, firebaseApiKey: e.target.value }))}
                placeholder="VITE_FIREBASE_API_KEY"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
              <input
                type="text"
                value={draft.firebaseProjectId}
                onChange={(e) => setDraft((d) => ({ ...d, firebaseProjectId: e.target.value }))}
                placeholder="VITE_FIREBASE_PROJECT_ID"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
              <input
                type="text"
                value={draft.firebaseAuthDomain}
                onChange={(e) => setDraft((d) => ({ ...d, firebaseAuthDomain: e.target.value }))}
                placeholder="VITE_FIREBASE_AUTH_DOMAIN"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
              <input
                type="url"
                value={draft.firebaseDatabaseUrl}
                onChange={(e) => setDraft((d) => ({ ...d, firebaseDatabaseUrl: e.target.value }))}
                placeholder="VITE_FIREBASE_DATABASE_URL (https://...-rtdb.firebaseio.com)"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>
          </div>

          {/* Parent SMS / External Dispatch Security Notice */}
          <div className="space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-50/50 p-4 dark:border-emerald-500/20 dark:bg-emerald-950/20">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                3. Parent SMS & External Notifications (Server-Side)
              </span>
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">
                HARDENED & SECURE
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              External SMS gateways (Twilio / Fast2SMS) and notification secrets are stored strictly on the server in <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[11px] dark:bg-white/10">.env</code> (<code className="font-mono text-[11px]">NOTIFICATION_API_KEY</code>, <code className="font-mono text-[11px]">NOTIFICATION_WEBHOOK_URL</code>). Client credentials have been purged from browser storage.
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <button
              type="button"
              onClick={() => void resetApiConfigToEnv()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset to .env Defaults
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsApiKeyModalOpen(false)}
                className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={testing}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60 cursor-pointer"
              >
                <CheckCircle2 className="h-4 w-4" />
                {testing ? 'Verifying Keys...' : 'Verify & Hot-Swap API Keys'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export const ApiKeyModal: React.FC = () => {
  const { isApiKeyModalOpen } = useCommuteSimulation();
  if (!isApiKeyModalOpen) return null;
  return <ApiKeyModalInner />;
};
