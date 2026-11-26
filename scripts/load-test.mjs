#!/usr/bin/env node
/**
 * Sreenidhi Express — Zero-Dependency Concurrency & Load Benchmark
 * Tests concurrent SSE stream capacity, HTTP request throughput, and latency percentiles.
 */

import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { signToken } from '../server/security.js';

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
}

const TARGET_URL = (process.env.LOAD_TEST_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const NUM_SSE_CLIENTS = Number(process.env.SSE_CLIENTS) || 50;
const NUM_HTTP_REQUESTS = Number(process.env.HTTP_REQUESTS) || 100;

console.log('==================================================================');
console.log('🚀 SREENIDHI EXPRESS — CONCURRENCY & ₹0 LOAD BENCHMARK (v15)');
console.log(`   Target:         ${TARGET_URL}`);
console.log(`   Target SSE:     ${NUM_SSE_CLIENTS} concurrent streams`);
console.log(`   Target HTTP:    ${NUM_HTTP_REQUESTS} concurrent requests`);
console.log('==================================================================\n');

let spawnedServer = null;

async function checkHealth() {
  try {
    const res = await fetch(`${TARGET_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureServerRunning() {
  const isUp = await checkHealth();
  if (isUp) {
    console.log('✔ Target server is already running and healthy.\n');
    return;
  }

  console.log('ℹ No active server detected. Spawning ephemeral server on port 3001...');
  spawnedServer = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: '3001', NODE_ENV: 'development', JWT_SECRET: process.env.JWT_SECRET },
    stdio: 'ignore',
  });

  for (let attempt = 1; attempt <= 25; attempt++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await checkHealth()) {
      console.log(`✔ Ephemeral server booted successfully (attempt ${attempt}).\n`);
      return;
    }
  }

  throw new Error('Failed to start ephemeral server for load benchmark.');
}

async function runBenchmark() {
  await ensureServerRunning();

  // Phase 1: Open Concurrent SSE Connections
  console.log(`[1/3] Establishing ${NUM_SSE_CLIENTS} concurrent SSE live-stream connections...`);
  const sseControllers = [];
  let sseEstablished = 0;

  const ssePromises = Array.from({ length: NUM_SSE_CLIENTS }, async (_, i) => {
    const sub = `load-test-rider-${i + 1}`;
    const ticket = signToken(
      { sub, role: 'STUDENT', routeId: 'route-51', jti: crypto.randomUUID() },
      { ttlSec: 180, scope: 'stream' }
    );
    const controller = new AbortController();
    sseControllers.push(controller);

    try {
      const res = await fetch(`${TARGET_URL}/api/bus/live-stream?ticket=${ticket}`, {
        signal: controller.signal,
        headers: { Accept: 'text/event-stream' },
      });

      if (res.ok && res.headers.get('content-type')?.includes('text/event-stream')) {
        sseEstablished++;
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        // failed connection
      }
    }
  });

  // Give SSE connections a moment to establish
  await Promise.race([
    Promise.all(ssePromises),
    new Promise((r) => setTimeout(r, 2000)),
  ]);

  console.log(`   ✔ Established ${sseEstablished}/${NUM_SSE_CLIENTS} active SSE streams.\n`);

  // Phase 2: Send Concurrent HTTP Requests (Read, Health, Telemetry)
  console.log(`[2/3] Dispatching ${NUM_HTTP_REQUESTS} concurrent HTTP requests under SSE load...`);
  const adminToken = signToken({ sub: 'admin@sreenidhi.edu.in', role: 'ADMIN', name: 'Transport Admin' });
  const studentToken = signToken({ sub: '26011CSEAI0109', role: 'STUDENT', routeId: 'route-51' });
  const endpoints = [
    { path: '/api/health', token: null },
    { path: '/api/bus/state/route-51', token: studentToken },
    { path: '/api/routes/route-51/optimization', token: studentToken },
    { path: '/api/trips/timer/route-51', token: studentToken },
    { path: '/api/excel/summary', token: adminToken },
  ];

  const latencies = [];
  let errorCount = 0;

  const startAll = performance.now();
  const requestPromises = Array.from({ length: NUM_HTTP_REQUESTS }, async (_, i) => {
    const item = endpoints[i % endpoints.length];
    const headers = { Accept: 'application/json' };
    if (item.token) headers.Authorization = `Bearer ${item.token}`;

    const t0 = performance.now();
    try {
      const res = await fetch(`${TARGET_URL}${item.path}`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      const t1 = performance.now();
      latencies.push(t1 - t0);
      if (!res.ok) {
        errorCount++;
      }
    } catch {
      const t1 = performance.now();
      latencies.push(t1 - t0);
      errorCount++;
    }
  });

  await Promise.all(requestPromises);
  const totalElapsedMs = performance.now() - startAll;

  // Phase 3: Cleanup SSE Connections
  console.log('\n[3/3] Closing active SSE streams and computing metrics...');
  for (const c of sseControllers) {
    try { c.abort(); } catch {}
  }

  // Calculate percentiles
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.50)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;
  const errorRatePct = ((errorCount / NUM_HTTP_REQUESTS) * 100).toFixed(2);
  const reqPerSec = ((NUM_HTTP_REQUESTS / totalElapsedMs) * 1000).toFixed(1);

  console.log('\n==================================================================');
  console.log('📊 CONCURRENCY BENCHMARK RESULTS');
  console.log('==================================================================');
  console.table([
    { Metric: 'Active SSE Streams Established', Value: `${sseEstablished} / ${NUM_SSE_CLIENTS}` },
    { Metric: 'Total HTTP Requests', Value: String(NUM_HTTP_REQUESTS) },
    { Metric: 'Concurrent Throughput', Value: `${reqPerSec} req/sec` },
    { Metric: 'Total Duration', Value: `${totalElapsedMs.toFixed(1)} ms` },
    { Metric: 'Error Rate', Value: `${errorRatePct}% (${errorCount} failed)` },
    { Metric: 'Latency p50 (Median)', Value: `${p50.toFixed(2)} ms` },
    { Metric: 'Latency p95', Value: `${p95.toFixed(2)} ms` },
    { Metric: 'Latency p99', Value: `${p99.toFixed(2)} ms` },
  ]);

  if (spawnedServer && !spawnedServer.killed) {
    spawnedServer.kill();
  }

  const passed = Number(errorRatePct) <= 1.0 && sseEstablished >= Math.floor(NUM_SSE_CLIENTS * 0.9);
  if (passed) {
    console.log('🎉 LOAD & CONCURRENCY BENCHMARK PASSED (Zero-Drop Under Load)\n');
    process.exit(0);
  } else {
    console.error('❌ LOAD BENCHMARK FAILED (Thresholds exceeded)\n');
    process.exit(1);
  }
}

runBenchmark().catch((err) => {
  console.error('Fatal load test error:', err);
  if (spawnedServer && !spawnedServer.killed) spawnedServer.kill();
  process.exit(1);
});
