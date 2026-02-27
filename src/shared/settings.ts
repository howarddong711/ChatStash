import type { UserSettings } from './types';

const SETTINGS_KEY = 'chatstash:settings';

const DEFAULT_SETTINGS: UserSettings = {
  rootDir: '',
  enableDebugLogs: false,
};

export async function getSettings(): Promise<UserSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(SETTINGS_KEY, (items) => {
      const stored = items[SETTINGS_KEY] as Partial<UserSettings> | undefined;
      resolve({ ...DEFAULT_SETTINGS, ...stored });
    });
  });
}

export async function saveSettings(settings: Partial<UserSettings>): Promise<void> {
  const current = await getSettings();
  const merged = { ...current, ...settings };
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [SETTINGS_KEY]: merged }, () => {
      const err = chrome.runtime?.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}
