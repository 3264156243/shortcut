// 语音输入模块：Alt+H 全局语音输入（阿里云百炼 qwen-audio-3.0-asr-flash-streaming 流式识别 + prompt 润色）
import { BrowserWindow, app, ipcMain, globalShortcut, screen } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebSocketClient = require('ws');

const ASR_MODEL = 'qwen-audio-3.0-asr-flash-streaming';
const DEFAULT_POLISH_PROMPT =
  '你是语音听写助手。请把识别到的语音内容润色成通顺、结构清晰的文字：修正口语化表达、补全标点、适当分段；不要改变原意，不要添加原文没有的信息。直接输出润色后的文本，不要任何解释。';

function configPath(): string {
  return path.join(app.getPath('userData'), 'shortcut', 'config.json');
}

function readConfigObject(): any {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

function voiceConfig(cfg?: any): any {
  const c = cfg || readConfigObject();
  return c?.voiceInput || {};
}

function bridgeScriptPath(): string {
  return app.isPackaged
    ? path.join((process as any).resourcesPath, 'scripts', 'voice-input-bridge.ps1')
    : path.join(__dirname, '..', 'scripts', 'voice-input-bridge.ps1');
}

let voiceWindow: BrowserWindow | null = null;
let bridgeProcess: ChildProcess | null = null;
let rawStream: any = null; // { ws, taskId, pendingLen }
let polishStream: any = null;
let listening = false;
let committedChars = 0; // 已提交句子的字符数（含当前 partial）
let pendingLen = 0; // 当前 partial 已注入的字符数
let polishText = '';
let sessionRunning = false;

function sendToWindow(channel: string, payload: unknown) {
  if (voiceWindow && !voiceWindow.isDestroyed()) {
    voiceWindow.webContents.send(channel, payload);
  }
}

function bridgeWrite(line: string) {
  if (!bridgeProcess || !bridgeProcess.stdin || bridgeProcess.stdin.destroyed) return;
  try {
    bridgeProcess.stdin.write(line + '\n');
  } catch {}
}

function ensureBridge() {
  if (bridgeProcess && !bridgeProcess.killed) return;
  const script = bridgeScriptPath();
  if (!fs.existsSync(script)) {
    sendToWindow('voice:status', { state: 'error', message: '输入桥脚本缺失' });
    return;
  }
  try {
    bridgeProcess = spawn('powershell.exe', [
      '-NoProfile', '-STA', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
    ], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    bridgeProcess.on('exit', () => { bridgeProcess = null; });
    bridgeProcess.on('error', () => { bridgeProcess = null; });
  } catch {
    bridgeProcess = null;
  }
}

function resolveWebSocketUrl(workspaceValue: string): string {
  const value = String(workspaceValue || '').trim();
  if (!value) throw new Error('Workspace ID 为空');
  if (/\{\s*workspaceid\s*\}/i.test(value)) {
    throw new Error('Workspace ID 不能填写 {WorkspaceId} 模板，请填写实际 llm-xxxxxx ID');
  }
  if (/^wss?:\/\//i.test(value)) {
    const parsed = new URL(value);
    if (!/^[^.]+\.cn-beijing\.maas\.aliyuncs\.com$/i.test(parsed.hostname)) {
      throw new Error('WebSocket 地址不是百炼北京区工作区专属地址');
    }
    parsed.protocol = 'wss:';
    parsed.pathname = '/api-ws/v1/inference';
    return parsed.toString();
  }
  const matched = value.match(/llm-[a-z0-9]+/i);
  const workspaceId = matched ? matched[0] : value;
  if (!/^llm-[a-z0-9]+$/i.test(workspaceId)) {
    throw new Error('Workspace ID 格式错误，应类似 llm-xxxxxxxx');
  }
  return `wss://${workspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`;
}

function createAsrStream(kind: 'raw' | 'polish', apiKey: string, workspaceId: string): any {
  let url = '';
  try {
    url = resolveWebSocketUrl(workspaceId);
  } catch (err: any) {
    sendToWindow('voice:status', { state: 'error', message: err?.message || String(err) });
    return { ws: null, taskId: '', kind, connected: false };
  }
  const taskId = require('crypto').randomBytes(16).toString('hex');
  const stream: any = { ws: null, taskId, kind, connected: false };
  let ws: any;
  try {
    ws = new WebSocketClient(url, { headers: { Authorization: `bearer ${apiKey}` } });
  } catch (err: any) {
    sendToWindow('voice:status', { state: 'error', message: `连接失败: ${err?.message || err}` });
    return stream;
  }
  stream.ws = ws;
  ws.on('open', () => {
    stream.connected = true;
    const input: any = {};
    if (kind === 'polish') {
      input.raw_input = {
        context: [
          { role: 'user', content: [{ type: 'input_text', text: DEFAULT_POLISH_PROMPT }] },
        ],
      };
    }
    const runTask = {
      header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
      payload: {
        task_group: 'audio',
        task: 'asr',
        function: 'recognition',
        model: ASR_MODEL,
        parameters: { sample_rate: 16000, format: 'wav' },
        input,
      },
    };
    try { ws.send(JSON.stringify(runTask)); } catch {}
  });
  ws.on('message', (data: Buffer) => {
    let msg: any;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    const event = msg?.header?.event;
    if (event === 'task-started') {
      if (kind === 'raw') {
        sendToWindow('voice:status', { state: 'listening', message: '识别中…' });
      }
      return;
    }
    if (event === 'result-generated') {
      const sentence = msg?.payload?.output?.sentence;
      if (!sentence || typeof sentence.text !== 'string') return;
      const isPartial = sentence.end_time == null;
      if (kind === 'raw') {
        applyRawResult(sentence.text, isPartial);
      } else {
        polishText = sentence.text;
        sendToWindow('voice:polish', polishText);
      }
      return;
    }
    if (event === 'task-failed') {
      sendToWindow('voice:status', { state: 'error', message: msg?.header?.error_message || '识别失败' });
      return;
    }
    if (event === 'task-finished') {
      try { ws.close(); } catch {}
    }
  });
  ws.on('error', (err: Error) => {
    sendToWindow('voice:status', { state: 'error', message: `连接错误: ${err?.message || err}` });
  });
  ws.on('close', () => {
    stream.connected = false;
  });
  return stream;
}

function applyRawResult(text: string, isPartial: boolean) {
  if (!sessionRunning) return;
  if (isPartial) {
    // 删除上一段 partial，注入新 partial
    if (pendingLen > 0) bridgeWrite(`B|${pendingLen}`);
    if (text.length > 0) bridgeWrite(`T|${Buffer.from(text, 'utf8').toString('base64')}`);
    pendingLen = text.length;
  } else {
    // 句子结束：替换 partial 为完整句
    if (pendingLen > 0) bridgeWrite(`B|${pendingLen}`);
    if (text.length > 0) bridgeWrite(`T|${Buffer.from(text, 'utf8').toString('base64')}`);
    committedChars += text.length;
    pendingLen = 0;
  }
  sendToWindow('voice:raw', text);
}

function closeStreams() {
  for (const stream of [rawStream, polishStream]) {
    if (stream?.ws && stream.connected) {
      try {
        stream.ws.send(JSON.stringify({ header: { action: 'finish-task', task_id: stream.taskId }, payload: { input: {} } }));
      } catch {}
      try { stream.ws.close(); } catch {}
    }
  }
  rawStream = null;
  polishStream = null;
}

function endSession(keepText: boolean) {
  if (!sessionRunning) return;
  sessionRunning = false;
  listening = false;
  closeStreams();
  if (keepText) {
    // 保留已输入内容：先清理未完成的 partial 残留
    if (pendingLen > 0) {
      bridgeWrite(`B|${pendingLen}`);
      pendingLen = 0;
    }
  }
  bridgeWrite('R'); // 恢复剪贴板
  committedChars = 0;
  pendingLen = 0;
  polishText = '';
  sendToWindow('voice:status', { state: 'stopped', message: '已结束' });
}

function openVoiceWindow() {
  const cfg = voiceConfig();
  if (voiceWindow && !voiceWindow.isDestroyed()) {
    voiceWindow.showInactive();
    voiceWindow.webContents.send('voice:getConfig', cfg);
    return;
  }
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  const width = 360;
  const height = 230;
  voiceWindow = new BrowserWindow({
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + area.height - height - 12),
    width,
    height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false, // 不抢焦点，保证文字注入到当前输入框
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  voiceWindow.setAlwaysOnTop(true, 'screen-saver');
  if (process.env.VITE_DEV_SERVER_URL) {
    voiceWindow.loadURL(process.env.VITE_DEV_SERVER_URL + '/voiceinput.html');
  } else {
    voiceWindow.loadFile(path.join(__dirname, '../dist/voiceinput.html'));
  }
  voiceWindow.once('ready-to-show', () => {
    if (voiceWindow && !voiceWindow.isDestroyed()) {
      voiceWindow.showInactive();
      voiceWindow.webContents.send('voice:getConfig', cfg);
    }
  });
  voiceWindow.on('closed', () => {
    voiceWindow = null;
    endSession(true);
  });
}

function toggleVoiceWindow() {
  if (voiceWindow && !voiceWindow.isDestroyed()) {
    voiceWindow.close();
    return;
  }
  openVoiceWindow();
}

function registerShortcut() {
  const cfg = voiceConfig();
  if (cfg.enabled === false) {
    try { globalShortcut.unregister('Alt+H'); } catch {}
    return;
  }
  if (!globalShortcut.register('Alt+H', () => toggleVoiceWindow())) {
    console.error('Failed to register Alt+H');
  }
}

function unregisterShortcut() {
  try { globalShortcut.unregister('Alt+H'); } catch {}
}

export function initVoiceInput() {
  registerShortcut();
  ipcMain.handle('voice:open', () => {
    openVoiceWindow();
    return true;
  });
  // 配置变更时重注册快捷键（设置面板保存配置后广播 config:changed）
  ipcMain.handle('voice:getConfig', () => {
    registerShortcut();
    return voiceConfig();
  });
  ipcMain.handle('voice:start', () => {
    const cfg = voiceConfig();
    if (!cfg.apiKey || !cfg.workspaceId) {
      sendToWindow('voice:status', { state: 'error', message: '请在设置中填写 百炼 API Key 与 Workspace ID' });
      return { success: false, message: '未配置 API Key / Workspace ID' };
    }
    ensureBridge();
    sessionRunning = true;
    listening = true;
    polishText = '';
    committedChars = 0;
    pendingLen = 0;
    rawStream = createAsrStream('raw', cfg.apiKey, cfg.workspaceId);
    const polishOn = cfg.polishMode !== 'off';
    polishStream = polishOn ? createAsrStream('polish', cfg.apiKey, cfg.workspaceId) : null;
    return { success: true };
  });
  ipcMain.on('voice:audio', (_e, chunk) => {
    if (!listening) return;
    for (const stream of [rawStream, polishStream]) {
      if (stream?.ws && stream.connected) {
        try { stream.ws.send(Buffer.from(chunk)); } catch {}
      }
    }
  });
  ipcMain.handle('voice:stop', () => { endSession(true); return { success: true }; });
  ipcMain.handle('voice:enter', () => {
    if (sessionRunning) bridgeWrite('E');
    endSession(true);
    return { success: true };
  });
  ipcMain.handle('voice:adopt', () => {
    if (!sessionRunning) return { success: false };
    const total = committedChars + pendingLen;
    if (total > 0) bridgeWrite(`B|${total}`);
    if (polishText && polishText.length > 0) {
      bridgeWrite(`T|${Buffer.from(polishText, 'utf8').toString('base64')}`);
    }
    committedChars = 0;
    pendingLen = 0;
    return { success: true, text: polishText };
  });
  app.on('will-quit', () => {
    unregisterShortcut();
    if (bridgeProcess && bridgeProcess.stdin) {
      try { bridgeProcess.stdin.write('Q\n'); } catch {}
      setTimeout(() => { try { bridgeProcess?.kill(); } catch {} }, 300);
    }
  });
}

export function openVoiceWindowFromMain() {
  openVoiceWindow();
}

