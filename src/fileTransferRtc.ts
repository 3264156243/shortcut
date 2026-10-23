type Signal = { sessionId: string; type: 'offer' | 'answer' | 'candidate' | 'cancel'; payload: any };
type FileInfo = { success: boolean; name: string; size: number; mime: string; message?: string };

const peers = new Map<string, RTCPeerConnection>();
let running = false;
let timer: number | null = null;
let polling = false;
let mobileOnline = false;

const api = () => window.electronAPI;
const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const sessionId = () => `rtc_${Date.now().toString(36)}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

function bytesToBase64(bytes: Uint8Array) {
  let text = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) text += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(text);
}

function base64ToBytes(value: string) {
  const raw = atob(value);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function waitIceComplete(peer: RTCPeerConnection, timeout = 2200) {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => { peer.removeEventListener('icegatheringstatechange', change); resolve(); };
    const change = () => { if (peer.iceGatheringState === 'complete') done(); };
    peer.addEventListener('icegatheringstatechange', change);
    window.setTimeout(done, timeout);
  });
}

function waitOpen(channel: RTCDataChannel, timeout = 4500) {
  if (channel.readyState === 'open') return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      window.clearTimeout(deadline);
      channel.removeEventListener('open', opened);
      channel.removeEventListener('error', failed);
      error ? reject(error) : resolve();
    };
    const opened = () => finish();
    const failed = () => finish(new Error('局域网连接失败'));
    const deadline = window.setTimeout(() => finish(new Error('局域网连接超时')), timeout);
    channel.addEventListener('open', opened, { once: true });
    channel.addEventListener('error', failed, { once: true });
  });
}

function waitControl(channel: RTCDataChannel, accepted: string[], timeout = 8000): Promise<any> {
  return new Promise((resolve, reject) => {
    const finish = (value?: any, error?: Error) => {
      window.clearTimeout(deadline);
      channel.removeEventListener('message', message);
      error ? reject(error) : resolve(value);
    };
    const message = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      try {
        const value = JSON.parse(event.data);
        if (value.t === 'error') finish(undefined, new Error(value.message || '直传失败'));
        else if (accepted.includes(value.t)) finish(value);
      } catch { /* ignore unrelated frames */ }
    };
    const deadline = window.setTimeout(() => finish(undefined, new Error('等待接收端响应超时')), timeout);
    channel.addEventListener('message', message);
  });
}

async function sendSignal(to: 'mobile' | 'desktop', id: string, type: string, payload: any) {
  const result = await api()?.fileTransferRtcSignal?.(to, id, type, payload);
  if (!result?.success) throw new Error(result?.message || '直传信令发送失败');
}

async function acceptOffer(signal: Signal) {
  if (!globalThis.RTCPeerConnection || peers.has(signal.sessionId)) return;
  const peer = new RTCPeerConnection({ iceServers: [] });
  peers.set(signal.sessionId, peer);
  peer.ondatachannel = (event) => receiveChannel(signal.sessionId, peer, event.channel);
  peer.onconnectionstatechange = () => {
    if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) {
      peers.delete(signal.sessionId);
      peer.close();
    }
  };
  try {
    await peer.setRemoteDescription(signal.payload);
    await peer.setLocalDescription(await peer.createAnswer());
    await waitIceComplete(peer);
    await sendSignal('mobile', signal.sessionId, 'answer', peer.localDescription?.toJSON() || {});
  } catch {
    peers.delete(signal.sessionId);
    peer.close();
  }
}

function receiveChannel(id: string, peer: RTCPeerConnection, channel: RTCDataChannel) {
  channel.binaryType = 'arraybuffer';
  let taskId = '';
  let name = 'file';
  let size = 0;
  let offset = 0;
  let chain = Promise.resolve();
  const fail = (error: unknown) => {
    if (channel.readyState === 'open') channel.send(JSON.stringify({ t: 'error', message: error instanceof Error ? error.message : '接收失败' }));
    peer.close();
    peers.delete(id);
  };
  channel.onmessage = (event) => {
    chain = chain.then(async () => {
      if (typeof event.data === 'string') {
        const message = JSON.parse(event.data);
        if (message.t === 'meta') {
          taskId = String(message.taskId || id);
          name = String(message.name || 'file');
          size = Number(message.size || 0);
          const result = await api()?.fileTransferRtcReceiveInit?.(taskId, name, size);
          if (!result?.success) throw new Error(result?.message || '无法创建接收文件');
          offset = Number(result.offset || 0);
          channel.send(JSON.stringify({ t: 'ready', offset }));
        } else if (message.t === 'eof') {
          const result = await api()?.fileTransferRtcReceiveComplete?.(taskId, String(message.sha256 || ''));
          if (!result?.success) throw new Error(result?.message || '文件保存失败');
          channel.send(JSON.stringify({ t: 'complete', path: result.path }));
          window.setTimeout(() => { peer.close(); peers.delete(id); }, 250);
        }
        return;
      }
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      const result = await api()?.fileTransferRtcReceiveChunk?.(taskId, offset, bytesToBase64(bytes));
      if (!result?.success) throw new Error(result?.message || '文件写入失败');
      offset = Number(result.offset);
      channel.send(JSON.stringify({ t: 'ack', offset }));
    }).catch(fail);
  };
}

async function handleSignals(signals: Signal[]) {
  for (const signal of signals) {
    if (signal.type === 'offer') await acceptOffer(signal);
    else if (signal.type === 'answer') {
      const peer = peers.get(signal.sessionId);
      if (peer && !peer.remoteDescription) await peer.setRemoteDescription(signal.payload).catch(() => undefined);
    } else if (signal.type === 'cancel') {
      peers.get(signal.sessionId)?.close();
      peers.delete(signal.sessionId);
    }
  }
}

async function poll() {
  if (!running || polling) return;
  polling = true;
  try {
    const result = await api()?.fileTransferRtcPoll?.();
    if (result?.success) {
      mobileOnline = !!result.online?.mobile;
      await handleSignals(Array.isArray(result.signals) ? result.signals : []);
    } else mobileOnline = false;
  } catch { mobileOnline = false; }
  finally { polling = false; }
}

export function startFileTransferRtc() {
  if (running) return stopFileTransferRtc;
  running = true;
  void poll();
  timer = window.setInterval(() => void poll(), 1200);
  return stopFileTransferRtc;
}

export function stopFileTransferRtc() {
  running = false;
  mobileOnline = false;
  if (timer !== null) window.clearInterval(timer);
  timer = null;
  peers.forEach((peer) => peer.close());
  peers.clear();
}

export async function tryRtcSendPath(taskId: string, path: string): Promise<{ success: boolean; cancelled?: boolean; message?: string }> {
  if (!running || !globalThis.RTCPeerConnection) return { success: false, message: '当前环境不支持局域网直传' };
  await poll();
  if (!mobileOnline) return { success: false, message: '手机端不在线' };
  const info = await api()?.fileTransferRtcFileInfo?.(path) as FileInfo | undefined;
  if (!info?.success) return { success: false, message: info?.message || '文件不可读取' };

  const id = sessionId();
  const peer = new RTCPeerConnection({ iceServers: [] });
  const channel = peer.createDataChannel('shortcut-file', { ordered: true });
  channel.binaryType = 'arraybuffer';
  peers.set(id, peer);
  let offset = 0;
  try {
    const preparing = await api()?.fileTransferRtcProgress?.(taskId, 'upload', info.name, info.size, 0, 'preparing');
    if (preparing?.cancelled) return { success: false, cancelled: true, message: '传输已取消' };
    await peer.setLocalDescription(await peer.createOffer());
    await waitIceComplete(peer);
    await sendSignal('mobile', id, 'offer', peer.localDescription?.toJSON() || {});
    await waitOpen(channel);
    channel.send(JSON.stringify({ t: 'meta', taskId, name: info.name, size: info.size, mime: info.mime }));
    const ready = await waitControl(channel, ['ready']);
    offset = Math.max(0, Math.min(info.size, Number(ready.offset || 0)));
    await api()?.fileTransferRtcProgress?.(taskId, 'upload', info.name, info.size, offset, 'running');
    while (offset < info.size) {
      if (channel.bufferedAmount > 1024 * 1024) await delay(20);
      const chunk = await api()?.fileTransferRtcReadChunk?.(path, offset, 32 * 1024);
      if (!chunk?.success) throw new Error(chunk?.message || '文件读取失败');
      const ackPromise = waitControl(channel, ['ack']);
      channel.send(base64ToBytes(chunk.data));
      const ack = await ackPromise;
      const next = Number(ack.offset || 0);
      if (next <= offset || next > info.size) throw new Error('接收端进度异常');
      offset = next;
      const progress = await api()?.fileTransferRtcProgress?.(taskId, 'upload', info.name, info.size, offset, 'running');
      if (progress?.cancelled) throw Object.assign(new Error('传输已取消'), { cancelled: true });
    }
    const completed = waitControl(channel, ['complete'], 15000);
    channel.send(JSON.stringify({ t: 'eof' }));
    await completed;
    await api()?.fileTransferRtcSent?.(taskId, path);
    await api()?.fileTransferDirectRecord?.(info.name, info.size, info.mime);
    return { success: true };
  } catch (error) {
    await sendSignal('mobile', id, 'cancel', {}).catch(() => undefined);
    const cancelled = !!(error as { cancelled?: boolean })?.cancelled || !!(await api()?.fileTransferRtcProgress?.(taskId, 'upload', info.name, info.size, offset, 'preparing'))?.cancelled;
    return { success: false, cancelled, message: cancelled ? '传输已取消' : error instanceof Error ? error.message : '局域网直传失败' };
  } finally {
    channel.close();
    peer.close();
    peers.delete(id);
  }
}
