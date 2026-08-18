import { app, ipcMain } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import { getBindInfo } from './sync/binding';

const API_URL = 'https://shortcut.326415.xyz/sync/api.php';
const FILE_URL = 'https://shortcut.326415.xyz/sync/file.php';
let registered = false;

async function request(payload: Record<string, unknown>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) return { success: false, message: '文件快传服务暂时不可用' };
    return data;
  } catch (error: any) {
    return { success: false, message: error?.name === 'AbortError' ? '请求超时，请检查网络' : (error?.message || '网络请求失败') };
  } finally {
    clearTimeout(timer);
  }
}

async function withBinding(action: string, payload: Record<string, unknown> = {}) {
  const binding = await getBindInfo();
  if (!binding?.bindId) return { success: false, message: '联动绑定尚未建立' };
  return request({ action, bindId: binding.bindId, side: 'desktop', ...payload });
}

async function uploadFile(filePath: string) {
  const binding = await getBindInfo();
  if (!binding?.bindId) return { success: false, message: '联动绑定尚未建立' };
  const stat = await fs.stat(filePath);
  const name = path.basename(filePath);
  const chunkSize = 2 * 1024 * 1024;
  const init = await request({ action: 'transfer.fileInit', bindId: binding.bindId, side: 'desktop', name, size: stat.size, mime: 'application/octet-stream', chunkSize });
  if (!init?.success || !init.file) return init;
  const file = init.file;
  const handle = await fs.open(filePath, 'r');
  for (let index = 0; index < file.chunkCount; index += 1) {
    const length = Math.min(chunkSize, stat.size - index * chunkSize);
    const chunk = Buffer.alloc(length);
    await handle.read(chunk, 0, length, index * chunkSize);
    const form = new FormData();
    form.append('action', 'uploadChunk');
    form.append('bindId', binding.bindId);
    form.append('side', 'desktop');
    form.append('fileId', file.id);
    form.append('chunkIndex', String(index));
    form.append('chunk', new Blob([chunk]), name + '.part');
    const response = await fetch(FILE_URL, { method: 'POST', body: form });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) { await handle.close(); return result || { success: false, message: '文件分片上传失败' }; }
  }
  await handle.close();
  return request({ action: 'transfer.fileComplete', bindId: binding.bindId, side: 'desktop', fileId: file.id });
}

async function downloadFile(fileId: string, name: string) {
  const binding = await getBindInfo();
  if (!binding?.bindId) return { success: false, message: '联动绑定尚未建立' };
  const response = await fetch(`${FILE_URL}?action=download&bindId=${encodeURIComponent(binding.bindId)}&side=desktop&fileId=${encodeURIComponent(fileId)}`);
  if (!response.ok || !response.body) return { success: false, message: '文件下载失败' };
  const target = path.join(app.getPath('downloads'), path.basename(name || fileId));
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(target, buffer);
  return { success: true, path: target };
}

export function initFileTransfer() {
  if (registered) return;
  registered = true;
  ipcMain.handle('fileTransfer:getState', async () => {
    const binding = await getBindInfo();
    if (!binding) return { success: false, bound: false, message: '联动绑定尚未建立' };
    const result = await withBinding('transfer.messages');
    return { ...result, bound: true, binding };
  });
  ipcMain.handle('fileTransfer:sendText', (_event, text: string) => withBinding('transfer.sendText', { text }));
  ipcMain.handle('fileTransfer:sendFile', (_event, filePath: string) => uploadFile(filePath));
  ipcMain.handle('fileTransfer:download', (_event, fileId: string, name: string) => downloadFile(fileId, name));
  ipcMain.handle('fileTransfer:delete', (_event, messageId: string) => withBinding('transfer.delete', { messageId }));
  ipcMain.handle('fileTransfer:shareText', (_event, text: string, code: string, hours: number) => withBinding('transfer.share', { text, code, hours }));
  ipcMain.handle('fileTransfer:claim', (_event, code: string) => request({ action: 'transfer.claim', code }));
}
