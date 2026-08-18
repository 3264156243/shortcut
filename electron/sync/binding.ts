const SYNC_API_URL = 'https://shortcut.326415.xyz/sync/api.php';

export interface SyncBinding {
  bindId: string;
  code: string;
  bindUrl: string;
}

export interface SyncConfigAccess {
  readConfigObject: () => any | null;
  updateConfig: (updater: (config: any) => any) => void;
}

let configAccess: SyncConfigAccess | null = null;

export function configureBinding(access: SyncConfigAccess) {
  configAccess = access;
}

function readConfig(): any {
  return configAccess?.readConfigObject() || {};
}

function storeBinding(binding: SyncBinding) {
  if (!configAccess) throw new Error('Sync binding config access is not initialized');
  const current = getStoredBinding();
  if (current && current.bindId === binding.bindId && current.code === binding.code && current.bindUrl === binding.bindUrl) {
    return;
  }
  configAccess.updateConfig((cfg) => ({
    ...cfg,
    sync: {
      ...(cfg?.sync || {}),
      bindId: binding.bindId,
      bindCode: binding.code,
      bindUrl: binding.bindUrl,
    },
  }));
}

export function getStoredBindId(): string | null {
  return readConfig()?.sync?.bindId || null;
}

function getStoredBinding(): SyncBinding | null {
  const sync = readConfig()?.sync || {};
  if (!sync.bindId) return null;
  return {
    bindId: sync.bindId,
    code: sync.bindCode || '',
    bindUrl: sync.bindUrl || ('https://shortcut.326415.xyz/taskwall/?bind=' + encodeURIComponent(sync.bindId)),
  };
}

async function request(payload: Record<string, unknown>): Promise<any | null> {
  try {
    const res = await fetch(SYNC_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function createBinding(): Promise<SyncBinding | null> {
  const data = await request({ action: 'bind.create' });
  if (!data?.success || !data.bindId) return null;
  const binding = {
    bindId: data.bindId,
    code: data.code || '',
    bindUrl: data.bindUrl || ('https://shortcut.326415.xyz/taskwall/?bind=' + encodeURIComponent(data.bindId)),
  };
  storeBinding(binding);
  return binding;
}

export async function getOrCreateBind(): Promise<SyncBinding | null> {
  const stored = getStoredBinding();
  if (!stored) return createBinding();

  const data = await request({ action: 'bind.info', bindId: stored.bindId });
  if (data?.success && data.valid) {
    const binding = {
      bindId: data.bindId || stored.bindId,
      code: data.code || '',
      bindUrl: data.bindUrl || stored.bindUrl,
    };
    storeBinding(binding);
    return binding;
  }
  if (data?.success && data.valid === false) return createBinding();
  return stored;
}

export async function getBindInfo(): Promise<SyncBinding | null> {
  const stored = getStoredBinding();
  if (!stored) return createBinding();

  const data = await request({ action: 'bind.info', bindId: stored.bindId });
  if (data?.success && data.valid) {
    const binding = {
      bindId: data.bindId || stored.bindId,
      code: data.code || stored.code,
      bindUrl: data.bindUrl || stored.bindUrl,
    };
    storeBinding(binding);
    return binding;
  }
  if (data?.success && data.valid === false) return createBinding();
  return stored;
}

export async function publishBoardNames(boardNames: string[]): Promise<boolean> {
  const bindId = getStoredBindId();
  if (!bindId) return false;
  const boards = Array.from(new Set(boardNames.map((name) => String(name || '').trim()).filter(Boolean))).slice(0, 50);
  const data = await request({ action: 'bind.boards.update', bindId, boards });
  return data?.success === true;
}
