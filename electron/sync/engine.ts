import { getStoredBindId } from './binding';

const SYNC_API_URL = 'https://shortcut.326415.xyz/sync/api.php';

// 消费者注册表：board => (tasks) => 实际新增数量
const consumers = new Map<string, (tasks: any[]) => number | Promise<number>>();

export interface SyncPullResult {
  board: string;
  count: number;
  error?: string;
}

/**
 * 注册某个 board 的消费回调。
 * 当 pullBoard(board) 拉取到任务时，将任务列表交给注册的 consumer 处理。
 */
export function registerConsumer(board: string, consumer: (tasks: any[]) => number | Promise<number>) {
  consumers.set(board, consumer);
}

export function unregisterConsumer(board: string) {
  consumers.delete(board);
}

/**
 * 拉取指定 board 的云端队列，分发给已注册的 consumer，然后返回拉取到的任务数。
 */
export async function pullBoard(board: string): Promise<SyncPullResult> {
  const bindId = getStoredBindId();
  if (!bindId) return { board, count: 0, error: '尚未建立联动绑定' };

  try {
    const res = await fetch(SYNC_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pull', board, bindId }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { board, count: 0, error: '同步服务暂时不可用' };
    const data = await res.json();
    if (!data.success) return { board, count: 0, error: data.message || '拉取任务失败' };

    const tasks: any[] = Array.isArray(data.tasks)
      ? data.tasks.slice(0, 500).filter((task: any) => typeof task?.text === 'string' && task.text.trim())
      : [];
    if (tasks.length === 0) return { board, count: 0 };

    // 分发
    const consumer = consumers.get(board);
    if (!consumer) return { board, count: 0, error: '任务墙同步模块尚未就绪' };
    let importedCount = 0;
    try {
      importedCount = await consumer(tasks);
    } catch {
      return { board, count: 0, error: '任务写入本地任务墙失败，云端任务已保留' };
    }

    const taskIds = tasks.map((task: any) => task.id).filter((id: unknown) => typeof id === 'string');
    try {
      const ackRes = await fetch(SYNC_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ack', board, bindId, taskIds }),
        signal: AbortSignal.timeout(10000),
      });
      const ackData = ackRes.ok ? await ackRes.json() : null;
      if (!ackData?.success) {
        return { board, count: importedCount, error: '任务已写入本地，但云端确认失败，下次将自动去重' };
      }
    } catch {
      return { board, count: importedCount, error: '任务已写入本地，但云端确认失败，下次将自动去重' };
    }

    return { board, count: importedCount };
  } catch (error: any) {
    return { board, count: 0, error: error?.name === 'TimeoutError' ? '同步请求超时' : '无法连接同步服务' };
  }
}

/**
 * 拉取所有已注册 board 的云端队列，返回 { board, count } 列表。
 */
export async function pullAllBoards(): Promise<SyncPullResult[]> {
  const results: SyncPullResult[] = [];
  for (const board of consumers.keys()) {
    results.push(await pullBoard(board));
  }
  return results;
}
