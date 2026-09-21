/**
 * 控制（sj 手机控制端）服务管理
 * 启动/停止 resources/sj/server.js：手机浏览器 → 电脑远程输入（打字/触控板/键盘/粘贴板）。
 * sj 模块为纯 Node 实现，通过 ELECTRON_RUN_AS_NODE 用 Electron 二进制拉起，无额外依赖。
 */
const electron = require('electron');
const app = electron.app;
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');
const childProcess = require('child_process');

const BASE_PORT = 9823;
const PORT_TRIES = 8;
const STATUS_TIMEOUT_MS = 1500;

let controlProcess: any = null;
let controlPort = 0;

function getSjServerPath(): string {
  if (app && app.isPackaged) {
    return path.join(process.resourcesPath, 'sj', 'server.js');
  }
  return path.join(__dirname, '..', 'resources', 'sj', 'server.js');
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, '0.0.0.0');
  });
}

async function findFreePort(): Promise<number> {
  for (let i = 0; i < PORT_TRIES; i++) {
    const port = BASE_PORT + i;
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(port)) return port;
  }
  return 0;
}

export function stopControlService(): boolean {
  if (!controlProcess) return false;
  const proc = controlProcess;
  controlProcess = null;
  controlPort = 0;
  try { proc.kill(); } catch { }
  return true;
}

export async function startControlService(): Promise<{ success: boolean; port?: number; error?: string }> {
  if (controlProcess) {
    return { success: true, port: controlPort };
  }
  const serverJs = getSjServerPath();
  if (!fs.existsSync(serverJs)) {
    return { success: false, error: '控制服务组件不存在' };
  }
  const port = await findFreePort();
  if (!port) {
    return { success: false, error: `端口 ${BASE_PORT}-${BASE_PORT + PORT_TRIES - 1} 均被占用` };
  }
  try {
    const proc = childProcess.spawn(
      process.execPath,
      [serverJs],
      {
        cwd: path.dirname(serverJs),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          SJ_AUTH_MODE: 'pair',
          SJ_HOST: '0.0.0.0',
          SJ_PORT: String(port),
          PORT: String(port),
        },
      }
    );
    // 吞掉输出避免管道积压；sj 的 banner/错误仅用于调试
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', () => { });
    proc.stderr.on('data', () => { });
    proc.on('exit', () => {
      if (controlProcess === proc) {
        controlProcess = null;
        controlPort = 0;
      }
    });
    proc.on('error', () => {
      if (controlProcess === proc) {
        controlProcess = null;
        controlPort = 0;
      }
    });
    controlProcess = proc;
    controlPort = port;
    return { success: true, port };
  } catch (error: any) {
    controlProcess = null;
    controlPort = 0;
    return { success: false, error: error?.message || '控制服务启动失败' };
  }
}

export async function restartControlService(): Promise<{ success: boolean; port?: number; error?: string }> {
  stopControlService();
  // 等端口释放
  await new Promise((resolve) => setTimeout(resolve, 400));
  return startControlService();
}

function fetchStatus(port: number): Promise<any> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/api/status', timeout: STATUS_TIMEOUT_MS },
      (res: any) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
  });
}

export async function getControlStatus(): Promise<any> {
  if (!controlProcess) {
    return { running: false, port: 0, injector: false, pairCode: null, urls: [] };
  }
  const status = await fetchStatus(controlPort);
  if (!status) {
    // 进程在但服务未就绪（启动中）或已僵死
    return {
      running: true,
      starting: true,
      port: controlPort,
      injector: false,
      pairCode: null,
      urls: [],
    };
  }
  return {
    running: true,
    starting: false,
    port: controlPort,
    injector: !!status.injector,
    authMode: status.authMode || 'pair',
    pairCode: status.pairCode || null,
    clients: status.clients || 0,
    urls: Array.isArray(status.urls) ? status.urls : [],
  };
}

export async function resetControlCode(): Promise<{ success: boolean; pairCode?: string; error?: string }> {
  if (!controlProcess || !controlPort) {
    return { success: false, error: '控制服务未运行' };
  }
  return new Promise((resolve) => {
    const body = '{}';
    const req = http.request(
      {
        host: '127.0.0.1',
        port: controlPort,
        path: '/api/reset-code',
        method: 'POST',
        timeout: STATUS_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res: any) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            resolve({ success: true, pairCode: data.pairCode });
          } catch {
            resolve({ success: false, error: '响应解析失败' });
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: '请求超时' });
    });
    req.on('error', (err: Error) => resolve({ success: false, error: err.message }));
    req.end(body);
  });
}
