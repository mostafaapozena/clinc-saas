import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Router } from 'express';

// Process metrics for load tests (docs/operations/LOAD_TESTING.md): event-loop delay, memory and CPU
// of THIS replica. Only mounted when OPS_METRICS=true, which env validation refuses in production
// (an external monitoring service is decision E7). Each read returns the window since the last
// read and resets it, so a sampler sees one window per call.

let histogram: ReturnType<typeof monitorEventLoopDelay> | null = null;
let lastCpu = process.cpuUsage();
let lastAt = process.hrtime.bigint();

export function createMetricsRouter() {
  histogram ??= monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  const router = Router();
  router.get('/', (_req, res) => {
    const h = histogram!;
    const now = process.hrtime.bigint();
    const cpu = process.cpuUsage(lastCpu);
    const elapsedMicros = Number(now - lastAt) / 1000;
    lastCpu = process.cpuUsage();
    lastAt = now;
    const ms = (ns: number) => Math.round((ns / 1e6) * 100) / 100;
    const body = {
      pid: process.pid,
      eventLoopDelayMs: { p50: ms(h.percentile(50)), p99: ms(h.percentile(99)), max: ms(h.max) },
      cpuPercent: Math.round(((cpu.user + cpu.system) / elapsedMicros) * 1000) / 10,
      memoryMb: Object.fromEntries(Object.entries(process.memoryUsage()).map(([k, v]) => [k, Math.round(v / 1048576)])),
      uptimeSeconds: Math.round(process.uptime()),
    };
    h.reset();
    res.set('Cache-Control', 'no-store').json(body);
  });
  return router;
}
