import { ipcMain, Notification } from 'electron';
import { randomBytes } from 'crypto';
import { configureBinding, getOrCreateBind, getBindInfo, publishBoardNames } from './binding';
import { registerConsumer, pullAllBoards } from './engine';

interface SyncInitOptions {
  readConfigObject: () => any | null;
  updateConfig: (updater: (config: any) => any) => void;
  notifyConfigChanged: () => void;
  taskwallEnabled: () => boolean;
}

let ipcRegistered = false;
let currentOptions: SyncInitOptions | null = null;
let boardPublishTimer: ReturnType<typeof setTimeout> | null = null;

function readBoardNames(options: SyncInitOptions): string[] {
  const boards = options.readConfigObject()?.taskBoards;
  return Array.isArray(boards) ? boards.map((board: any) => String(board?.name || '').trim()).filter(Boolean) : [];
}

export function scheduleBoardListPublish() {
  if (!currentOptions) return;
  if (boardPublishTimer) clearTimeout(boardPublishTimer);
  boardPublishTimer = setTimeout(() => {
    boardPublishTimer = null;
    if (currentOptions) void publishBoardNames(readBoardNames(currentOptions));
  }, 500);
}

function createTaskNote(task: any, zIndex: number) {
  const now = new Date().toISOString();
  const tapes = ['#c0392b', '#e67e22', '#f39c12', '#27ae60', '#2980b9', '#8e44ad', '#e84393'];
  return {
    id: task.id || 'rmt_' + randomBytes(12).toString('hex'),
    text: task.text || '',
    longText: !!task.details || undefined,
    details: task.details || undefined,
    reminderAt: task.reminderAt || undefined,
    done: false,
    x: 4 + Math.random() * 58,
    y: 5 + Math.random() * 52,
    rotation: Math.random() * 3.4 - 1.7,
    tape: tapes[Math.floor(Math.random() * tapes.length)],
    zIndex,
    createdAt: now,
    updatedAt: now,
  };
}

export async function initSync(options: SyncInitOptions) {
  currentOptions = options;
  configureBinding({ readConfigObject: options.readConfigObject, updateConfig: options.updateConfig });

  registerConsumer('taskwall', async (tasks) => {
    if (!tasks.length) return 0;
    let importedCount = 0;
    await Promise.resolve(options.updateConfig((current) => {
      const cfg = current || {};
      const taskBoards = Array.isArray(cfg.taskBoards) ? [...cfg.taskBoards] : [];
      for (const task of tasks) {
        const boardName = String(task.boardName || '').trim() || '默认任务墙';
        let boardIndex = taskBoards.findIndex((board: any) => board?.name === boardName);
        if (boardIndex < 0) {
          const now = new Date().toISOString();
          taskBoards.push({
            id: 'sync_' + randomBytes(8).toString('hex'),
            name: boardName,
            notes: [],
            createdAt: now,
            updatedAt: now,
          });
          boardIndex = taskBoards.length - 1;
        }
        const board = { ...taskBoards[boardIndex] };
        const notes = Array.isArray(board.notes) ? [...board.notes] : [];
        if (notes.some((note: any) => note?.id === task.id)) continue;
        const zIndex = notes.reduce((max: number, note: any) => Math.max(max, note?.zIndex || 0), 0) + 1;
        board.notes = [createTaskNote(task, zIndex), ...notes];
        importedCount += 1;
        board.updatedAt = new Date().toISOString();
        taskBoards[boardIndex] = board;
      }
      return { ...cfg, taskBoards };
    }));
    options.notifyConfigChanged();
    if (importedCount > 0) {
      try {
        new Notification({
          title: '收到手机任务',
          body: '收到 ' + importedCount + ' 条手机任务，已加入任务墙',
        }).show();
      } catch {}
    }
    return importedCount;
  });

  if (!ipcRegistered) {
    ipcRegistered = true;
    ipcMain.handle('sync:getBinding', async () => {
      const info = await getBindInfo();
      if (info) void publishBoardNames(readBoardNames(options));
      return info ? { success: true, ...info } : { success: false, message: '暂时无法获取绑定信息' };
    });
    ipcMain.handle('sync:pullNow', async () => {
      if (!options.taskwallEnabled()) {
        return { success: false, count: 0, results: [], message: '任务墙已禁用，请先在板块管理中启用' };
      }
      const results = await pullAllBoards();
      const failed = results.find((item) => item.error);
      return {
        success: !failed,
        results,
        count: results.reduce((sum, item) => sum + item.count, 0),
        message: failed?.error,
      };
    });
  }

  if (!options.taskwallEnabled()) return [];
  await getOrCreateBind();
  await publishBoardNames(readBoardNames(options));
  return pullAllBoards();
}
