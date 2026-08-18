import { ipcMain } from 'electron';
import { getBindInfo } from './sync/binding';

const API_URL = 'https://shortcut.326415.xyz/sync/api.php';
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
  ipcMain.handle('fileTransfer:delete', (_event, messageId: string) => withBinding('transfer.delete', { messageId }));
  ipcMain.handle('fileTransfer:shareText', (_event, text: string, code: string, hours: number) => withBinding('transfer.share', { text, code, hours }));
  ipcMain.handle('fileTransfer:claim', (_event, code: string) => request({ action: 'transfer.claim', code }));
}
