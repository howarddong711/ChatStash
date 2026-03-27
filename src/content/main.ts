import { pickAdapter } from '@/adapters';
import { getSettings } from '@/shared/settings';
import type { ConversationSummary } from '@/shared/types';

import type { DebugLogStore } from './debugLogs';
import { createDebugLogStore } from './debugLogs';
import { createExportRunner } from './exportRunner';
import { mountUI, type UIControls } from './ui';

function openOptionsPage(controls: UIControls): void {
  chrome.runtime.sendMessage(
    { type: 'CHATSTASH_OPEN_OPTIONS' },
    (resp?: { ok?: boolean; error?: string }) => {
      const err = chrome.runtime?.lastError;
      if (err || !resp?.ok) {
        controls.setError(`打开设置失败：${err?.message ?? resp?.error ?? '未知错误'}`);
      }
    },
  );
}

function normalizeTitle(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function collectGlmSidebarDiagnostics(): Record<string, unknown> {
  const items = Array.from(
    document.querySelectorAll<HTMLElement>('#aside-history-list .list .history-item'),
  );
  const titles = items
    .map((item) => {
      const titleEl = item.querySelector<HTMLElement>('.title');
      return normalizeTitle(titleEl?.innerText || titleEl?.textContent || '');
    })
    .filter(Boolean)
    .slice(0, 10);

  return {
    historyItemCount: items.length,
    titleCount: titles.length,
    titles,
    hasHistoryList: !!document.querySelector('#aside-history-list'),
    hasHistoryContainer: !!document.querySelector('#aside-history-list .list'),
  };
}

async function syncDebugLogEnabled(debugLogs: DebugLogStore): Promise<void> {
  const settings = await getSettings();
  debugLogs.setEnabled(settings.enableDebugLogs);
}

function main(): void {
  let controls!: UIControls;
  const debugLogs = createDebugLogStore();
  void syncDebugLogEnabled(debugLogs);

  const exportRunner = createExportRunner(() => controls, debugLogs);

  controls = mountUI({
    async onLoadConversations() {
      await syncDebugLogEnabled(debugLogs);

      const adapter = pickAdapter(new URL(location.href));
      if (!adapter) {
        debugLogs.push('warn', 'sidebar.load.unsupported', { url: location.href });
        return [];
      }

      debugLogs.push('info', 'sidebar.load.start', {
        adapterId: adapter.id,
        pageTitle: document.title,
        url: location.href,
        ...(adapter.id === 'glm' ? collectGlmSidebarDiagnostics() : {}),
      });

      const items = await adapter.listConversations();
      debugLogs.push('info', 'sidebar.load.done', {
        adapterId: adapter.id,
        count: items.length,
        sampleTitles: items.slice(0, 10).map((item: ConversationSummary) => item.title),
        sampleUrls: items.slice(0, 5).map((item: ConversationSummary) => item.url),
      });

      return items;
    },
    onExport(choice, selected) {
      void exportRunner.runExport(choice, selected);
    },
    onExportLogs() {
      void exportRunner.exportDebugLogs();
    },
    onOpenSettings() {
      openOptionsPage(controls);
    },
  });
}

main();
