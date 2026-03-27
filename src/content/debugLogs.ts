import { downloadTextFile } from '@/shared/download';
import { getSettings } from '@/shared/settings';

import type { UIControls } from './ui';
import { dateStamp, nowStamp } from './utils';

export type DebugLogLevel = 'info' | 'warn' | 'error';

export type DebugLogEntry = {
  time: string;
  level: DebugLogLevel;
  event: string;
  url: string;
  details?: Record<string, unknown>;
};

export interface DebugLogStore {
  setEnabled(enabled: boolean): void;
  push(level: DebugLogLevel, event: string, details?: Record<string, unknown>): void;
  exportLogs(controls: UIControls): Promise<void>;
}

export function createDebugLogStore(): DebugLogStore {
  let enabled = false;
  const entries: DebugLogEntry[] = [];

  return {
    setEnabled(nextEnabled) {
      enabled = nextEnabled;
    },

    push(level, event, details) {
      if (!enabled) return;
      entries.push({
        time: new Date().toISOString(),
        level,
        event,
        url: location.href,
        details,
      });
    },

    async exportLogs(controls) {
      const settings = await getSettings();
      enabled = settings.enableDebugLogs;

      if (!enabled) {
        controls.setError('调试日志未开启。请在设置页启用“导出调试日志”后再尝试。');
        return;
      }

      const payload = {
        generatedAt: new Date().toISOString(),
        page: location.href,
        entries,
      };

      const filename = `ChatStash_DebugLog_${dateStamp()}_${nowStamp()}.json`;
      downloadTextFile(filename, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
      controls.setStatus(`✓ 已导出日志：${filename}`);
      setTimeout(() => controls.setStatus(null), 5000);
    },
  };
}
