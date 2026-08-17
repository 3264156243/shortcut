// 语音输入模块：Alt+H 全局语音输入
// 识别：阿里云百炼 qwen-audio-3.0-asr-flash-streaming 流式 WebSocket（单流，计费最小）
// 输入：SendInput Unicode 增量追加（与 Win 语音识别一致，不碰剪贴板）
// 控制：空格=暂停/继续，回车=确认识别并关闭；启动前检测焦点是否在可输入控件
// 润色：可插拔 OpenAI 兼容 LLM（enable_thinking:false 关闭思考，流式 SSE）
import { BrowserWindow, app, ipcMain, globalShortcut, screen } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebSocketClient = require('ws');

const ASR_MODEL = 'qwen-audio-3.0-asr-flash-streaming';
const SENTENCE_GAP_MS = 1200; // 停顿超过该时长才把当前句定稿

const POLISH_SCENARIOS: Record<string, { label: string; desc: string; prompt: string }> = {
  general: {
    label: '通用提示词优化',
    desc: '重点：修正口语、补全标点、分点归纳、去重去口头禅，输出可直接交给 AI 的高质量提示词',
    prompt: '你是提示词优化专家。请把用户口语化的语音输入润色成结构清晰、逻辑严谨、信息完整、可直接交给 AI 执行的高质量提示词：修正口语化表达、补全标点、分点归纳、去掉重复与口头禅；不改变原意，不添加原文没有的信息。你输出的是提示词文字本身，不要执行需求、不要生成需求对应的产物。直接输出润色后的提示词文本，不要任何解释。',
  },
  code: {
    label: '代码开发需求',
    desc: '重点：整理为可编码实现的需求——目标、输入输出、边界条件、技术约束，分点列出',
    prompt: '你是资深软件开发助手。请把用户口语化的开发需求整理成可直接编码实现的需求描述：明确目标、输入输出、边界条件、技术约束，分点列出；不改变原意，不添加原文没有的需求。你输出的是提示词文字本身，不要写代码、不要生成需求对应的实现。直接输出整理后的需求文本，不要任何解释。',
  },
  writing: {
    label: '写作润色',
    desc: '重点：口语转通顺连贯的书面文字，适当分段，保持原意与风格',
    prompt: '你是中文写作助手。请把口语化内容润色成通顺、连贯、有文采的书面文字，保持原意，适当分段。直接输出润色后的文字，不要任何解释。',
  },
  custom: { label: '自定义提示词', desc: '使用你自己填写的 system 提示词', prompt: '' },
};

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

function writeVoiceConfig(patch: any) {
  try {
    const cfg = readConfigObject();
    const next = { ...cfg, voiceInput: { ...(cfg.voiceInput || {}), ...patch } };
    const tmp = configPath() + '.voice.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmp, configPath());
  } catch {}
}

function bridgeScriptPath(): string {
  return app.isPackaged
    ? path.join((process as any).resourcesPath, 'scripts', 'voice-input-bridge.ps1')
    : path.join(__dirname, '..', 'scripts', 'voice-input-bridge.ps1');
}

let voiceWindow: BrowserWindow | null = null;
let bridgeProcess: ChildProcess | null = null;
let rawStream: any = null;
let sessionRunning = false;
let listening = false;
let polishText = '';
let currentPartial = ''; // 当前句已输入到光标处的文本
let committedText = ''; // 已定稿句子文本
let sessionText = ''; // 累计文本（供润色）
let polishSeq = 0;
let focusOk = false;
let pendingBridgeResolve: ((line: string) => void) | null = null;

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
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    if (bridgeProcess.stdout) {
      bridgeProcess.stdout.setEncoding('utf8');
      let buf = '';
      bridgeProcess.stdout.on('data', (chunk: string) => {
        buf += chunk;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() || '';
        for (const line of lines) {
          const l = line.trim();
          if (l === 'EVENT|SPACE') togglePause();
          else if (l === 'EVENT|ENTER') confirmAndClose();
          else if (l === 'READY|HOOK') sendToWindow('voice:status', { state: 'ready', message: '按键控制已就绪（空格=暂停，回车=确认）' });
          else if (l.startsWith('FOCUS|')) {
            const parts = l.split('|');
            focusOk = parts[1] === '1';
            if (pendingBridgeResolve) {
              const r = pendingBridgeResolve;
              pendingBridgeResolve = null;
              r(l);
            }
          }
        }
      });
    }
    bridgeProcess.on('exit', () => { bridgeProcess = null; });
    bridgeProcess.on('error', () => { bridgeProcess = null; });
  } catch {
    bridgeProcess = null;
  }
}

function queryFocus(): Promise<boolean> {
  ensureBridge();
  if (!bridgeProcess) return Promise.resolve(true); // 桥不可用时放行
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pendingBridgeResolve = null; resolve(focusOk); }, 1200);
    pendingBridgeResolve = (line: string) => {
      clearTimeout(timer);
      resolve(line.startsWith('FOCUS|1'));
    };
    bridgeWrite('F');
  });
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

function createAsrStream(apiKey: string, workspaceId: string): any {
  let url = '';
  try {
    url = resolveWebSocketUrl(workspaceId);
  } catch (err: any) {
    sendToWindow('voice:status', { state: 'error', message: err?.message || String(err) });
    return { ws: null, taskId: '', connected: false };
  }
  const taskId = require('crypto').randomBytes(16).toString('hex');
  const stream: any = { ws: null, taskId, connected: false };
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
    const runTask = {
      header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
      payload: {
        task_group: 'audio',
        task: 'asr',
        function: 'recognition',
        model: ASR_MODEL,
        parameters: { sample_rate: 16000, format: 'wav' },
        input: {},
      },
    };
    try { ws.send(JSON.stringify(runTask)); } catch {}
  });
  ws.on('message', (data: Buffer) => {
    let msg: any;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    const event = msg?.header?.event;
    if (event === 'task-started') {
      sendToWindow('voice:status', { state: 'listening', message: '识别中…' });
      return;
    }
    if (event === 'result-generated') {
      const sentence = msg?.payload?.output?.sentence;
      if (!sentence || typeof sentence.text !== 'string') return;
      const isPartial = sentence.end_time == null;
      applyRawResult(sentence.text, isPartial);
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
  ws.on('close', () => { stream.connected = false; });
  return stream;
}

// ===== 增量追加式注入：说了什么就往光标处追加什么 =====
function injectDelta(delta: string) {
  if (delta && delta.length > 0) {
    bridgeWrite(`T|${Buffer.from(delta, 'utf8').toString('base64')}`);
  }
}

function updatePartial(newText: string) {
  if (newText.startsWith(currentPartial)) {
    // 正常增长：只追加增量
    const delta = newText.slice(currentPartial.length);
    injectDelta(delta);
    currentPartial = newText;
  } else {
    // 识别修正：删当前句，重新输入
    if (currentPartial.length > 0) bridgeWrite(`B|${currentPartial.length}`);
    injectDelta(newText);
    currentPartial = newText;
  }
}

function applyRawResult(text: string, isPartial: boolean) {
  if (!sessionRunning) return;
  updatePartial(text);
  if (!isPartial) {
    // 句子结束：定稿并入累计，当前句清空
    committedText += text;
    currentPartial = '';
    sessionText = committedText;
    triggerPolish();
  }
}

// ===== LLM 润色（OpenAI 兼容，流式 SSE，关闭思考）=====
function scenarioPrompt(): string {
  const cfg = voiceConfig();
  const scenario = cfg.polishScenario || 'general';
  if (scenario === 'custom') {
    return (cfg.polishCustomPrompt || '').trim() || POLISH_SCENARIOS.general.prompt;
  }
  return (POLISH_SCENARIOS[scenario] || POLISH_SCENARIOS.general).prompt;
}

async function polishWithLlm(text: string) {
  const cfg = voiceConfig();
  const p = cfg.polishProvider || {};
  const base = String(p.baseUrl || '').trim();
  const key = String(p.apiKey || '').trim();
  const model = String(p.model || '').trim() || 'qwen-plus';
  if (!base || !key) {
    sendToWindow('voice:polishError', '未配置润色接口地址/密钥（语音板块→润色模式→LLM润色）');
    return;
  }
  const url = /\/chat\/completions$/i.test(base) ? base : base.replace(/\/+$/, '') + '/chat/completions';
  const seq = ++polishSeq;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        stream: true,
        enable_thinking: false,
        messages: [
          { role: 'system', content: scenarioPrompt() },
          { role: 'user', content: text },
        ],
      }),
    });
    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => '');
      if (seq === polishSeq) sendToWindow('voice:polishError', `润色接口错误 ${res.status}: ${t.slice(0, 200)}`);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const l = line.trim();
        if (!l.startsWith('data:')) continue;
        const data = l.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          const delta = j?.choices?.[0]?.delta?.content;
          const msg = j?.choices?.[0]?.message?.content;
          const piece = delta != null ? delta : (msg != null ? msg : '');
          if (piece) {
            full += piece;
            if (seq === polishSeq) sendToWindow('voice:polish', full);
          }
        } catch {}
      }
    }
    if (!full && seq === polishSeq) {
      sendToWindow('voice:polishError', '润色接口无返回内容');
    }
  } catch (err: any) {
    if (seq === polishSeq) {
      sendToWindow('voice:polishError', `润色失败: ${err?.message || err}`);
    }
  }
}

function triggerPolish() {
  const cfg = voiceConfig();
  if ((cfg.polishMode || 'llm') === 'off') return;
  const text = sessionText.trim();
  if (!text) return;
  polishSeq++;
  polishText = '';
  sendToWindow('voice:polish', '');
  void polishWithLlm(text);
}

// ===== 会话控制 =====
function closeStream() {
  if (rawStream?.ws && rawStream.connected) {
    try {
      rawStream.ws.send(JSON.stringify({ header: { action: 'finish-task', task_id: rawStream.taskId }, payload: { input: {} } }));
    } catch {}
    try { rawStream.ws.close(); } catch {}
  }
  rawStream = null;
}

function endSession() {
  if (!sessionRunning) return;
  sessionRunning = false;
  listening = false;
  closeStream();
  bridgeWrite('D');
  committedText = '';
  currentPartial = '';
  sessionText = '';
  polishText = '';
  sendToWindow('voice:status', { state: 'stopped', message: '已结束' });
}

function togglePause() {
  if (!sessionRunning) return;
  if (listening) {
    listening = false;
    sendToWindow('voice:status', { state: 'paused', message: '已暂停（空格继续）' });
  } else {
    listening = true;
    sendToWindow('voice:status', { state: 'listening', message: '识别中…' });
  }
}

function confirmAndClose() {
  if (sessionRunning) bridgeWrite('E');
  endSession();
  if (voiceWindow && !voiceWindow.isDestroyed()) voiceWindow.close();
}

// ===== 窗口 =====
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
  const height = 210;
  const saved = cfg.windowPos;
  let x = Math.round(area.x + (area.width - width) / 2);
  let y = Math.round(area.y + area.height - height - 12);
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    x = Math.max(area.x - 20, Math.min(area.x + area.width - width + 20, Math.round(saved.x)));
    y = Math.max(area.y - 20, Math.min(area.y + area.height - 20, Math.round(saved.y)));
  }
  voiceWindow = new BrowserWindow({
    x, y, width, height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
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
  voiceWindow.on('moved', () => {
    if (!voiceWindow || voiceWindow.isDestroyed()) return;
    const [wx, wy] = voiceWindow.getPosition();
    writeVoiceConfig({ windowPos: { x: wx, y: wy } });
  });
  voiceWindow.on('closed', () => {
    voiceWindow = null;
    endSession();
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
  ipcMain.handle('voice:open', () => { openVoiceWindow(); return true; });
  ipcMain.handle('voice:getConfig', () => {
    registerShortcut();
    return voiceConfig();
  });
  ipcMain.handle('voice:start', async () => {
    const cfg = voiceConfig();
    if (!cfg.apiKey || !cfg.workspaceId) {
      sendToWindow('voice:status', { state: 'error', message: '请在语音板块填写 百炼 API Key 与 Workspace ID' });
      return { success: false, message: '未配置 API Key / Workspace ID' };
    }
    // 焦点检测：光标不在可输入控件时不启动
    ensureBridge();
    const ok = await queryFocus();
    if (!ok) {
      sendToWindow('voice:status', { state: 'error', message: '请先把光标放到要输入的输入框内，再开始语音输入' });
      return { success: false, message: '焦点不在输入框' };
    }
    sessionRunning = true;
    listening = true;
    polishText = '';
    polishSeq = 0;
    currentPartial = '';
    committedText = '';
    sessionText = '';
    rawStream = createAsrStream(cfg.apiKey, cfg.workspaceId);
    bridgeWrite('A');
    return { success: true };
  });
  ipcMain.on('voice:audio', (_e, chunk) => {
    if (!listening) return;
    if (rawStream?.ws && rawStream.connected) {
      try { rawStream.ws.send(Buffer.from(chunk)); } catch {}
    }
  });
  ipcMain.handle('voice:stop', () => {
    endSession();
    if (voiceWindow && !voiceWindow.isDestroyed()) voiceWindow.close();
    return { success: true };
  });
  ipcMain.handle('voice:enter', () => {
    confirmAndClose();
    return { success: true };
  });
  ipcMain.handle('voice:adopt', () => {
    if (!sessionRunning) return { success: false };
    const total = committedText.length + currentPartial.length;
    if (total > 0) bridgeWrite(`B|${total}`);
    if (polishText && polishText.length > 0) {
      bridgeWrite(`T|${Buffer.from(polishText, 'utf8').toString('base64')}`);
    }
    committedText = '';
    currentPartial = '';
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
