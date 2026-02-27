type ChromeStorageArea = chrome.storage.StorageArea;

function storageGet(area: ChromeStorageArea, keys: string | string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    area.get(keys as never, (items) => {
      const err = chrome.runtime?.lastError;
      if (err) reject(new Error(err.message));
      else resolve(items as Record<string, unknown>);
    });
  });
}

function storageSet(area: ChromeStorageArea, items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    area.set(items as never, () => {
      const err = chrome.runtime?.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

function storageRemove(area: ChromeStorageArea, keys: string | string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    area.remove(keys as never, () => {
      const err = chrome.runtime?.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

function getArea(): ChromeStorageArea {
  // Use local storage for cross-context compatibility:
  // content script writes -> extension page reads.
  return chrome.storage.local;
}

const PREFIX = 'chatstash:export:';

export async function putExportBundle<T extends object>(
  bundle: T,
): Promise<{ key: string }> {
  const uuid = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const key = PREFIX + uuid;
  const area = getArea();
  await storageSet(area, { [key]: { bundle, createdAt: Date.now() } });
  return { key };
}

export async function getExportBundle<T extends object>(key: string): Promise<T | null> {
  const area = getArea();
  const items = await storageGet(area, key);
  const entry = items[key] as { bundle?: T; createdAt?: number } | undefined;
  if (!entry?.bundle) return null;
  return entry.bundle;
}

export async function deleteExportBundle(key: string): Promise<void> {
  const area = getArea();
  await storageRemove(area, key);
}
