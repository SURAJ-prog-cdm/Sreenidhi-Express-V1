// src/services/eventQueue.ts — durable, idempotent offline queue (IndexedDB).
// Fixes: 200-item drop-oldest loss, flush/record race + duplicates, replay-time timestamps, 2.5 s timeouts, no backoff, 401 stranding.

export type QueuedEvent = {
  eventId: string;            // sent to the server → idempotent replay
  sheetName: string;
  data: Record<string, unknown>;
  clientTime: string;         // ISO time the event HAPPENED (server validates + stores it, not the replay time)
  priority: 0 | 1;            // 0 = attendance/safety (never evicted first), 1 = telemetry-like
  owner: string;              // token `sub` that created it: the server stamps identity from the token, so never replay under another user
  attempts: number;
};

const DB_NAME = 'transitpulse-queue', STORE = 'events', MAX_EVENTS = 5000, BATCH = 50;
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'eventId' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => { dbp = null; reject(r.error); };
  }));
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req ? (req as IDBRequest<T>).result : undefined);
    t.onerror = t.onabort = () => reject(t.error);
  });
}
const all = async () => ((await tx<QueuedEvent[]>('readonly', (s) => s.getAll())) ?? []) as QueuedEvent[];

export const newEventId = () => `EVT-${crypto.randomUUID()}`;

/** Decode (NOT verify) the JWT subject — only used to match queued events to the logged-in user; the server does real verification. */
export function subOf(token: string | null): string {
  try { return JSON.parse(atob(token!.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub ?? ''; } catch { return ''; }
}

export async function enqueue(sheetName: string, data: Record<string, unknown>, owner: string, priority: 0 | 1 = 0): Promise<string> {
  const ev: QueuedEvent = { eventId: newEventId(), sheetName, data, clientTime: new Date().toISOString(), priority, owner, attempts: 0 };
  await tx('readwrite', (s) => s.put(ev));
  void evictIfNeeded();
  return ev.eventId;
}
export const pendingCount = async () => ((await tx<number>('readonly', (s) => s.count())) ?? 0);

async function evictIfNeeded() {
  const events = await all();
  if (events.length <= MAX_EVENTS) return;
  // drop the oldest LOW-priority events first; attendance/safety events are the last thing to go
  events.sort((a, b) => b.priority - a.priority || a.clientTime.localeCompare(b.clientTime));
  const drop = events.slice(0, events.length - MAX_EVENTS);
  await tx('readwrite', (s) => { drop.forEach((e) => s.delete(e.eventId)); });
}

export type FlushOptions = { baseUrl: string; getToken: () => string | null; onAuthExpired?: () => void };
let failures = 0, timer: number | undefined;

/** Send everything queued, in batches, priority 0 first. Safe to call from anywhere, any number of times. */
export async function flush(opts: FlushOptions): Promise<void> {
  // navigator.locks = exactly one flusher across tabs/webview instances (no more concurrent double-posts)
  const run = async () => {
    for (;;) {
      const token = opts.getToken();
      if (!token) return;
      const me = subOf(token);
      const batch = (await all()).filter((e) => e.owner === me).sort((a, b) => a.priority - b.priority || a.clientTime.localeCompare(b.clientTime)).slice(0, BATCH);
      if (!batch.length) { failures = 0; return; }
      let res: Response;
      try {
        res = await fetch(`${opts.baseUrl}/api/events/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ events: batch.map(({ eventId, sheetName, data, clientTime }) => ({ eventId, sheetName, data, clientTime })) }),
          signal: AbortSignal.timeout(15_000), // generous: the old 2.5 s abort caused "sent but looked failed" duplicates
        });
      } catch { return schedule(opts); }                       // offline / timeout → keep everything, back off
      if (res.status === 401) { opts.onAuthExpired?.(); return; } // keep the queue; resume after re-login
      if (!res.ok) return schedule(opts);
      const { results } = (await res.json()) as { results: { eventId: string; ok: boolean; status?: number }[] };
      // delete accepted/duplicate events AND permanently-rejected ones (4xx) so one bad row never blocks the rest
      const done = results.filter((r) => r.ok || (r.status && r.status < 500 && r.status !== 401 && r.status !== 429)).map((r) => r.eventId);
      await tx('readwrite', (s) => { done.forEach((id) => s.delete(id)); });
      failures = 0;
    }
  };
  if ('locks' in navigator) await navigator.locks.request('transitpulse-flush', { ifAvailable: true }, async (l) => { if (l) await run(); });
  else await run();
}

function schedule(opts: FlushOptions) {
  failures++;
  const delay = Math.min(5_000 * 2 ** Math.min(failures, 6), 300_000) * (0.7 + Math.random() * 0.6); // exp backoff + jitter, max ~5 min
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void flush(opts), delay);
}

/** Call once at startup. navigator.onLine is only a hint (true on captive portals), so we also retry on a timer with backoff protection. */
export function startAutoFlush(opts: FlushOptions) {
  const go = () => {
    // If consecutive errors are occurring, let exponential backoff timer handle it rather than rapid hammering
    if (failures >= 3) return;
    void flush(opts);
  };
  window.addEventListener('online', () => { failures = 0; void flush(opts); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && failures < 3) void flush(opts); });
  window.setInterval(go, 30_000);
  go();
}
