// 语音输入模块：右 Alt 全局语音输入
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

// ===== 调用统计：按天记录打开次数与转写字数 =====
type DayStat = { calls: number; chars: number };
type StatMap = Record<string, DayStat>;

function todayKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function readVoiceStats(): StatMap {
  const cfg = voiceConfig();
  const s = cfg.stats;
  return s && typeof s === 'object' ? s : {};
}

function recordVoiceStat(kind: 'call' | 'chars', amount = 0) {
  try {
    const key = todayKey();
    const stats = readVoiceStats();
    const day: DayStat = { calls: stats[key]?.calls || 0, chars: stats[key]?.chars || 0 };
    if (kind === 'call') day.calls += 1;
    else if (amount > 0) day.chars += amount;
    stats[key] = day;
    writeVoiceConfig({ stats });
  } catch {}
}

function getVoiceStats() {
  const stats = readVoiceStats();
  const key = todayKey();
  const today: DayStat = { calls: stats[key]?.calls || 0, chars: stats[key]?.chars || 0 };
  let calls = 0;
  let chars = 0;
  for (const k of Object.keys(stats)) {
    calls += stats[k]?.calls || 0;
    chars += stats[k]?.chars || 0;
  }
  return { today, total: { calls, chars } };
}

let voiceWindow: BrowserWindow | null = null;
let bridgeProcess: ChildProcess | null = null;
let rawStream: any = null;
let sessionRunning = false;
let listening = false;
// committedText = 已定稿（end_time）句子的拼接，只追加不重复
let committedText = '';
// currentPartial = 当前进行中句子的最新文本（覆盖式更新，不追加）
let currentPartial = '';
// 显示/确认用：committedText + currentPartial
let sessionText = '';
// 识别结果去重：避免同一结果重复推送
let lastRaw = '';
// 上一句已定稿文本（去标点），用于 final 级去重
let lastFinalNorm = '';
let polishSeq = 0;
// 结构处理中标记
let processing = false;
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
          else if (l === 'EVENT|ENTER') confirmAndType();
          else if (l === 'EVENT|ESC') cancelSession();
          else if (l === 'READY|HOOK') sendToWindow('voice:status', { state: 'ready', message: '按键控制已就绪（空格=暂停，回车=确认）' });
          else if (l.startsWith('ERR|')) sendToWindow('voice:status', { state: 'error', message: `按键控制异常: ${l.slice(4)}` });
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

// ===== 识别文本暂存：只说不动，文字进胶囊，勾选后才处理 =====
// 模型：已定稿句子(committedText) 只追加一次；进行中句子(currentPartial) 覆盖式更新。
// 去重：同一结果、同一句 final（去标点比较）都只保留一份，杜绝识别重复污染。
function normalizeForDedup(s: string): string {
  return s.replace(/[。．.!！?？,，、;；:：\s]/g, '');
}

function applyRawResult(text: string, isPartial: boolean) {
  if (!sessionRunning) return;
  const t = (text || '').trim();
  if (!t) return;

  // 完全重复的结果 → 忽略
  if (t === lastRaw) return;
  lastRaw = t;

  if (isPartial) {
    // ===== 进行中句子：覆盖式更新（绝不动 committedText）=====
    // 若 partial 恰好是 committedText 的延续（个别 ASR 会整段累计），只取新增部分
    if (committedText && t.startsWith(committedText)) {
      currentPartial = t.slice(committedText.length);
    } else {
      currentPartial = t;
    }
  } else {
    // ===== 句子定稿 =====
    const norm = normalizeForDedup(t);
    // final 去重：与上一句定稿去标点后相同 → 忽略（ASR 重复推送同句）
    if (lastFinalNorm && norm && norm === lastFinalNorm) {
      return;
    }
    // 该句与当前 partial 相同内容（partial 已展示过）→ 只需并入 committed 一次
    committedText = committedText ? committedText + t : t;
    lastFinalNorm = norm;
    currentPartial = '';
  }

  sessionText = committedText + currentPartial;
  sendToWindow('voice:session', sessionText);
}

// ===== 结构整理（勾选后调用）：合并重复 + 变通顺 + 修正错别字，仅在明确列举时结构化 =====
// 编号由程序依据原文是否“明确列举”决定，模型不自行编号。
function structurePrompt(): string {
  return '你是一个语音转文字整理助手。用户给你一段语音识别出的文字（可能含重复、口语化、错别字）。请把它整理成通顺、自然的文本：\n1) 合并完全重复的内容，只保留一处；\n2) 修正确定无疑的错别字；\n3) 让语句通顺自然，去掉口语口头禅（如"诶""嗯""然后"等），补全缺失的标点，但**保持原文的完整信息与自然表达，不要缩减、不要提炼、不要改写原意**；\n4) **不要添加任何编号、序号、数字、点号前缀**，也不要自己换行拆分；\n5) 直接输出整理后的整段文字。\n**只输出最终结果**，不要任何解释、前言、引号、markdown 代码块。';
}

async function structureWithLlm(text: string): Promise<string> {
  const cfg = voiceConfig();
  const p = cfg.polishProvider || {};
  const base = String(p.baseUrl || '').trim();
  const key = String(p.apiKey || '').trim();
  const model = String(p.model || '').trim() || 'qwen-plus';
  if (!base || !key) {
    sendToWindow('voice:polishError', '未配置润色接口地址/密钥（语音板块→润色模式→LLM润色）');
    return text;
  }
  const url = /\/chat\/completions$/i.test(base) ? base : base.replace(/\/+$/, '') + '/chat/completions';
  const seq = ++polishSeq;
  let full = '';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        stream: true,
        enable_thinking: false,
        messages: [
          { role: 'system', content: structurePrompt() },
          { role: 'user', content: text },
        ],
      }),
    });
    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => '');
      if (seq === polishSeq) sendToWindow('voice:polishError', `结构处理接口错误 ${res.status}: ${t.slice(0, 200)}`);
      return text;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
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
          if (piece) full += piece;
        } catch {}
      }
    }
    if (!full && seq === polishSeq) {
      sendToWindow('voice:polishError', '结构处理接口无返回内容');
      return formatStructuredResult(text, shouldStructure(text) || hasMultipleLines(text));
    }
    return formatStructuredResult(full, shouldStructure(text) || hasMultipleLines(full));
  } catch (err: any) {
    if (seq === polishSeq) {
      sendToWindow('voice:polishError', `结构处理失败: ${err?.message || err}`);
    }
    return formatStructuredResult(text, shouldStructure(text) || hasMultipleLines(text));
  }
}

// 模型输出是否已是多行（多要点/列表形态）→ 视为需要结构化编号
function hasMultipleLines(s: string): boolean {
  const lines = String(s || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  return lines.length >= 2;
}

// ===== 是否结构化：依据原文是否“明确列举/要点化” =====
// 只认强列举信号（第几点/几个任务/三点/第一是…），避免普通口语被误拆。
function shouldStructure(original: string): boolean {
  const s = original || '';
  return /第[一二三四五六七八九十百\d]+[点项条个]|几点|[一二三四五六七八九十百]+点|[一二三四五六七八九十百]+个(任务|要点|需求|事项)|第一个是|第二个是|第三个是|第一点|第二点|第三点|1\.\s*[^0-9]|2\.\s*[^0-9]/.test(s);
}

// ===== 结构结果强制清洗 =====
// shouldStructure=true：剥离乱码前缀并重排 1. 2. 3.
// shouldStructure=false：只做清洗，合并为通顺段落，绝不编号。
function formatStructuredResult(raw: string, structure: boolean): string {
  let s = (raw || '').trim();
  // 去掉 markdown 代码块包裹
  s = s.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '');
  // 去掉首尾引号（中文/英文）
  s = s.replace(/^["'“”`]+/, '').replace(/["'“”`]+$/, '');
  // 拆行
  let lines = s.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  // 去重相邻相同行
  lines = lines.filter((l, i) => lines[i - 1] !== l);

  if (!structure) {
    // 不做编号：合并为一段通顺文字（保序，段落内用全角逗号衔接，结尾仅一个句号）
    const parts: string[] = [];
    for (const l of lines) {
      const clean = l.replace(/^[^\u4e00-\u9fffA-Za-z0-9]{1,6}\s*[.、．)）]?/, '').trim();
      if (clean) parts.push(clean.replace(/[。．.!！?？、；;：:]+$/, ''));
    }
    if (parts.length === 0) return '';
    return parts.join('，') + '。';
  }

  // ===== 结构化编号 =====
  const stripPrefix = (l: string) => {
    let t = l.replace(/^[^\u4e00-\u9fffA-Za-z0-9]{1,4}\s*/u, (mt) => (mt.trim().length === 0 ? mt : ''));
    t = t.replace(/^(?:\d+\s*[.、．)）]|[^0-9\u4e00-\u9fff]{1,6}\s*[.、．)）]|\d+\s*$)/, '');
    t = t.replace(/^[^\u4e00-\u9fff]{1,10}\.\s*/, '');
    return t.replace(/^\s+/, '').replace(/[。．.!！?？、；;：:]+$/, '');
  };

  if (lines.length > 1) {
    const cleaned = lines.map(stripPrefix).filter((l) => l.length > 0);
    if (cleaned.length === 0) return raw.trim();
    const head = cleaned.length > 1 && cleaned[0].length <= 24 ? cleaned[0].replace(/[。．,!！?？、：:\s]+$/, '') : null;
    const items = head ? cleaned.slice(1) : cleaned;
    if (items.length > 0) {
      const numbered = items.map((it, i) => `${i + 1}. ${it}`);
      return head ? head + '：\n' + numbered.join('\n') : numbered.join('\n');
    }
  }

  return lines.join('').replace(/[。．,!！?？、]+$/, '');
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
  lastRaw = '';
  lastFinalNorm = '';
  processing = false;
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

// ===== 勾选确认：结构处理 → 光标打入 → 关闭 =====
function confirmAndType() {
  if (!sessionRunning) return;
  const text = sessionText.trim();
  // 立即结束识别
  sessionRunning = false;
  listening = false;
  closeStream();
  bridgeWrite('D');
  if (!text) {
    if (voiceWindow && !voiceWindow.isDestroyed()) voiceWindow.close();
    return;
  }
  if (processing) return;
  processing = true;
  sendToWindow('voice:status', { state: 'processing', message: '整理中…' });
  void (async () => {
    let out = text;
    const cfg = voiceConfig();
    const mode = cfg.polishMode || 'llm';
    if (mode !== 'off') {
      out = await structureWithLlm(text);
    }
    processing = false;
    // 先隐藏胶囊（归还焦点给目标窗口），再打字，确保文字进入目标输入框
    if (voiceWindow && !voiceWindow.isDestroyed()) {
      voiceWindow.hide();
      await new Promise((r) => setTimeout(r, 120));
    }
    if (out && out.trim()) {
      bridgeWrite(`T|${Buffer.from(out.trim(), 'utf8').toString('base64')}`);
      recordVoiceStat('chars', out.trim().length);
    }
    if (voiceWindow && !voiceWindow.isDestroyed()) voiceWindow.close();
  })();
}

// ===== ESC 取消：不输入，直接关闭 =====
function cancelSession() {
  endSession();
  if (voiceWindow && !voiceWindow.isDestroyed()) voiceWindow.close();
}

// ===== 窗口 =====
function openVoiceWindow() {
  const cfg = voiceConfig();
  if (voiceWindow && !voiceWindow.isDestroyed()) {
    voiceWindow.show();
    voiceWindow.focus();
    voiceWindow.webContents.send('voice:getConfig', cfg);
    return;
  }
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  const saved = cfg.windowPos;
  const savedSize = cfg.windowSize;
  const width = savedSize && Number.isFinite(savedSize.width) ? Math.max(220, Math.min(600, savedSize.width)) : 320;
  const height = savedSize && Number.isFinite(savedSize.height) ? Math.max(44, Math.min(200, savedSize.height)) : 52;
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
    resizable: true,
    movable: true,
    minWidth: 220,
    minHeight: 44,
    maxWidth: 600,
    maxHeight: 200,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
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
      voiceWindow.show();
      voiceWindow.focus();
      voiceWindow.webContents.send('voice:getConfig', cfg);
    }
  });
  // 统计一次调用（每次真正新建并展示胶囊）
  recordVoiceStat('call');
  voiceWindow.on('moved', () => {
    if (!voiceWindow || voiceWindow.isDestroyed()) return;
    const [wx, wy] = voiceWindow.getPosition();
    writeVoiceConfig({ windowPos: { x: wx, y: wy } });
  });
  voiceWindow.on('resized', () => {
    if (!voiceWindow || voiceWindow.isDestroyed()) return;
    const [ww, wh] = voiceWindow.getSize();
    writeVoiceConfig({ windowSize: { width: ww, height: wh } });
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

// 启动/关闭语音胶囊：Alt+H（globalShortcut 组合键，可靠注册）
const VOICE_HOTKEY = 'Alt+H';

function registerShortcut() {
  const cfg = voiceConfig();
  if (cfg.enabled === false) {
    try { globalShortcut.unregister(VOICE_HOTKEY); } catch {}
    return;
  }
  if (!globalShortcut.register(VOICE_HOTKEY, () => toggleVoiceWindow())) {
    console.error('Failed to register ' + VOICE_HOTKEY);
  }
}

function unregisterShortcut() {
  try { globalShortcut.unregister(VOICE_HOTKEY); } catch {}
}

export function initVoiceInput() {
  registerShortcut();
  ipcMain.handle('voice:open', () => { openVoiceWindow(); return true; });
  ipcMain.handle('voice:stats', () => getVoiceStats());
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
    processing = false;
    committedText = '';
    currentPartial = '';
    sessionText = '';
    lastRaw = '';
    lastFinalNorm = '';
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
  // 勾选：结构处理并打入光标
  ipcMain.handle('voice:confirm', () => {
    confirmAndType();
    return { success: true };
  });
  // 暂停/继续（胶囊聚焦时按空格直达）
  ipcMain.handle('voice:toggle', () => {
    togglePause();
    return { success: true };
  });
  // 取消：不输入，直接关闭
  ipcMain.handle('voice:cancel', () => {
    cancelSession();
    return { success: true };
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
