/**
 * 内存采样监控（阶段 1 基线数据采集，ROADMAP §三）
 * - 主进程每 30s 调 app.getAppMetrics() 按进程类型聚合（working set KB）
 * - 同时向所有存活 WebContents 取 performance.memory（各窗口 JS heap bytes）
 * - JSONL 追加写 userData/logs/memory.log，超 5MB 轮转为 .old
 * 用途：24h 稳态曲线定位泄漏大头 + 迁移 Tauri 2 前后同口径对比。
 */
import { app, webContents } from 'electron';
import fs from 'fs';
import path from 'path';

const SAMPLE_INTERVAL_MS = 30000;
const MAX_LOG_BYTES = 5 * 1024 * 1024;

let timer: any = null;
let sampling = false;

function logFile(): string {
  const dir = path.join(app.getPath('userData'), 'logs');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { }
  return path.join(dir, 'memory.log');
}

function rotateIfNeeded(file: string): void {
  try {
    const st = fs.statSync(file);
    if (st.size > MAX_LOG_BYTES) {
      const old = `${file}.old`;
      try { fs.unlinkSync(old); } catch { }
      fs.renameSync(file, old);
    }
  } catch { /* 首次不存在 */ }
}

interface ProcAgg { count: number; workingSetKB: number; peakWorkingSetKB: number; }

async function sampleOnce(): Promise<void> {
  const file = logFile();
  rotateIfNeeded(file);

  // 1) 进程级指标聚合
  const proc: Record<string, ProcAgg> = {};
  try {
    for (const m of app.getAppMetrics() as any[]) {
      const type = String(m.type || 'unknown');
      if (!proc[type]) proc[type] = { count: 0, workingSetKB: 0, peakWorkingSetKB: 0 };
      proc[type].count += 1;
      proc[type].workingSetKB += Number(m.memory?.workingSetSize) || 0;
      proc[type].peakWorkingSetKB += Number(m.memory?.peakWorkingSetSize) || 0;
    }
  } catch { }

  // 2) 各窗口渲染层 JS heap（2s 超时防挂死）
  const jsHeaps: Array<{ id: number; url: string; usedMB: number; totalMB: number }> = [];
  try {
    for (const wc of webContents.getAllWebContents()) {
      try {
        if (wc.isDestroyed()) continue;
        const raw = await Promise.race([
          wc.executeJavaScript('JSON.stringify({u: (performance.memory&&performance.memory.usedJSHeapSize)||0, t: (performance.memory&&performance.memory.totalJSHeapSize)||0})', true),
          new Promise((_r, rej) => setTimeout(() => rej(new Error('heap timeout')), 2000)),
        ]);
        const h = JSON.parse(String(raw));
        jsHeaps.push({
          id: wc.id,
          url: String(wc.getURL?.() || '').slice(0, 80),
          usedMB: Math.round(((Number(h.u) || 0) / 1048576) * 10) / 10,
          totalMB: Math.round(((Number(h.t) || 0) / 1048576) * 10) / 10,
        });
      } catch { /* 窗口忙/已销毁：跳过 */ }
    }
  } catch { }

  const totalWorkingSetKB = Object.values(proc).reduce((s, p) => s + p.workingSetKB, 0);
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    totalMB: Math.round((totalWorkingSetKB / 1024) * 10) / 10,
    proc,
    jsHeaps,
  });
  fs.appendFileSync(file, line + '\n');
}

export function startMemoryMonitor(): void {
  if (timer) return;
  timer = setInterval(() => {
    if (sampling) return; // 上一轮未完成则跳过，防堆积
    sampling = true;
    sampleOnce().catch(() => { }).finally(() => { sampling = false; });
  }, SAMPLE_INTERVAL_MS);
  (timer as any).unref?.();
}

export function stopMemoryMonitor(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
