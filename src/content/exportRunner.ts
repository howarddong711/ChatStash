import { pickAdapter } from '@/adapters';
import type { ExtractResult } from '@/adapters/types';
import { conversationToJson } from '@/exporters/json';
import { conversationToMarkdown } from '@/exporters/markdown';
import { conversationToPdfBlob } from '@/exporters/pdf';
import {
  buildCategorizedFilename,
  buildFilePath,
  downloadBlobFile,
  downloadTextFile,
  downloadZip,
  safeFilename,
  type ZipEntry,
} from '@/shared/download';
import { getSettings } from '@/shared/settings';
import type { Conversation, ConversationSummary } from '@/shared/types';

import { createDebugLogStore, type DebugLogStore } from './debugLogs';
import { extractConversationByUrl } from './navigation';
import {
  captureCurrentPagePdfBlob,
  downloadCurrentPagePdf,
  hideOverlay,
  showOverlay,
  updateOverlay,
} from './print';
import type { ExportChoice, UIControls } from './ui';
import { delay, nowStamp } from './utils';

type ControlsGetter = () => UIControls;

type ExportPayload = {
  ext: string;
  mime: string;
  content: string;
};

function buildExportPayload(choice: ExportChoice, conversation: Conversation): ExportPayload {
  if (choice === 'markdown') {
    return {
      ext: 'md',
      mime: 'text/markdown;charset=utf-8',
      content: conversationToMarkdown(conversation),
    };
  }

  return {
    ext: 'json',
    mime: 'application/json;charset=utf-8',
    content: conversationToJson(conversation),
  };
}

function finalizeConversationTitle(
  adapterId: string | undefined,
  conversation: Conversation,
  selectedTitle?: string,
): Conversation {
  if (adapterId !== 'glm') return conversation;

  const title = selectedTitle?.trim();
  if (!title) return conversation;
  if (conversation.title === title) return conversation;

  return {
    ...conversation,
    title,
  };
}

export function createExportRunner(getControls: ControlsGetter, sharedDebugLogs?: DebugLogStore) {
  const debugLogs = sharedDebugLogs ?? createDebugLogStore();

  async function loadSettings() {
    const settings = await getSettings();
    debugLogs.setEnabled(settings.enableDebugLogs);
    return settings;
  }

  async function resolveSingleConversation(
    selected: ConversationSummary[],
  ): Promise<ExtractResult> {
    const adapter = pickAdapter(new URL(location.href));
    if (!adapter) {
      return { ok: false, reason: '当前站点暂不支持。' };
    }

    if (selected.length === 0) {
      return adapter.extract();
    }

    const controls = getControls();
    controls.setStatus(`正在导出：${selected[0].title}…`);
    return extractConversationByUrl(selected[0].url, debugLogs);
  }

  async function exportSinglePdf(
    conversation: Conversation,
    username: string | null,
    rootDir: string,
    opts: { waitMs?: number; printProfile?: 'generic' | 'kimi' | 'none' } = {},
  ): Promise<string> {
    const filename = buildCategorizedFilename({
      rootDir: rootDir || 'ChatStash',
      platform: conversation.platform,
      username,
      title: conversation.title,
      timestamp: nowStamp(),
      ext: 'pdf',
    });

    await downloadCurrentPagePdf(filename, opts);
    return filename;
  }

  async function exportBatchPdf(
    selected: ConversationSummary[],
    adapterLabel: string,
  ): Promise<void> {
    const controls = getControls();
    const adapter = pickAdapter(new URL(location.href));
    if (!adapter) {
      controls.setError('当前站点暂不支持。');
      return;
    }

    showOverlay(`批量PDF导出中，请勿操作…\n（0/${selected.length}）`);
    const pdfEntries: ZipEntry[] = [];
    let failCount = 0;
    const platformLabel = safeFilename(adapterLabel || 'chat');

    try {
      for (let i = 0; i < selected.length; i++) {
        const conv = selected[i];
        updateOverlay(`批量PDF导出中，请勿操作…\n（${i + 1}/${selected.length}）${conv.title}`);
        controls.setStatus(`正在导出 PDF ${i + 1}/${selected.length}：${conv.title}…`);

        const res = await extractConversationByUrl(conv.url, debugLogs);
        if (!res.ok) {
          failCount++;
          debugLogs.push('warn', 'runExport.batchPdf.extractFailed', {
            index: i + 1,
            title: conv.title,
            reason: res.reason,
          });
          continue;
        }

        try {
          const username = adapter.detectUsername();
          const conversation = finalizeConversationTitle(adapter.id, res.conversation, conv.title);
          const filePath = buildFilePath({
            platform: conversation.platform,
            username,
            title: conversation.title,
            timestamp: nowStamp(),
            ext: 'pdf',
          });

          const pdfBlob =
            adapter.id === 'glm'
              ? await conversationToPdfBlob(conversation)
              : await captureCurrentPagePdfBlob({
                  waitMs: adapter.id === 'kimi' ? 1600 : 1200,
                  printProfile: adapter.id === 'kimi' ? 'kimi' : 'generic',
                });

          pdfEntries.push({ path: filePath, content: pdfBlob });
          debugLogs.push('info', 'runExport.batchPdf.itemDone', {
            index: i + 1,
            title: conversation.title,
          });
        } catch (error) {
          failCount++;
          const message = error instanceof Error ? error.message : String(error);
          debugLogs.push('warn', 'runExport.batchPdf.itemFailed', {
            index: i + 1,
            title: conv.title,
            error: message,
          });
        }
      }
    } finally {
      hideOverlay();
    }

    controls.setStatus(null);

    if (pdfEntries.length === 0) {
      controls.setError('所有对话 PDF 导出失败，请确保对话在侧栏中可见后重试。');
      return;
    }

    controls.setStatus('正在打包 PDF…');
    const finalUsername = safeFilename(adapter.detectUsername() ?? 'default');
    const zipName = `ChatStash_${platformLabel}_PDF_${finalUsername}_${pdfEntries.length}items_${nowStamp()}.zip`;
    await downloadZip(pdfEntries, zipName);

    debugLogs.push('info', 'runExport.batchPdf.done', {
      successCount: pdfEntries.length,
      failCount,
    });

    if (failCount > 0) {
      controls.setError(`完成：成功 ${pdfEntries.length} 个，失败 ${failCount} 个。\n失败的对话可能不在侧栏中，请单独打开后重试。`);
      return;
    }

    controls.setStatus(`✓ 已打包导出 ${pdfEntries.length} 个 PDF → ${zipName}`);
    setTimeout(() => controls.setStatus(null), 5000);
  }

  async function exportBatchText(
    choice: Extract<ExportChoice, 'markdown' | 'json'>,
    selected: ConversationSummary[],
    adapterLabel: string,
  ): Promise<void> {
    const controls = getControls();
    const adapter = pickAdapter(new URL(location.href));
    if (!adapter) {
      controls.setError('当前站点暂不支持。');
      return;
    }

    showOverlay(`批量导出中，请勿操作…\n（0/${selected.length}）`);
    const entries: ZipEntry[] = [];
    let failCount = 0;
    const platformLabel = safeFilename(adapterLabel || 'chat');

    try {
      for (let i = 0; i < selected.length; i++) {
        const conv = selected[i];
        updateOverlay(`批量导出中，请勿操作…\n（${i + 1}/${selected.length}）${conv.title}`);
        controls.setStatus(`正在提取 ${i + 1}/${selected.length}：${conv.title}…`);

        const res = await extractConversationByUrl(conv.url, debugLogs);
        if (!res.ok) {
          failCount++;
          debugLogs.push('warn', 'runExport.batch.itemFailed', {
            index: i + 1,
            title: conv.title,
            reason: res.reason,
          });
          continue;
        }

        const username = adapter.detectUsername();
        const conversation = finalizeConversationTitle(adapter.id, res.conversation, conv.title);
        const payload = buildExportPayload(choice, conversation);
        entries.push({
          path: buildFilePath({
            platform: conversation.platform,
            username,
            title: conversation.title,
            timestamp: nowStamp(),
            ext: payload.ext,
          }),
          content: payload.content,
        });

        debugLogs.push('info', 'runExport.batch.itemDone', {
          index: i + 1,
          title: conversation.title,
          ext: payload.ext,
        });

        if (i < selected.length - 1) {
          await delay(300);
        }
      }
    } finally {
      hideOverlay();
    }

    if (entries.length === 0) {
      controls.setStatus(null);
      controls.setError('所有对话提取失败，请确保对话在侧栏中可见后重试。');
      return;
    }

    controls.setStatus('正在打包并下载…');
    const finalUsername = safeFilename(adapter.detectUsername() ?? 'default');
    const formatLabel = choice === 'markdown' ? 'MD' : 'JSON';
    const zipName = `ChatStash_${platformLabel}_${formatLabel}_${finalUsername}_${entries.length}items_${nowStamp()}.zip`;
    await downloadZip(entries, zipName);

    debugLogs.push('info', 'runExport.batch.zipDone', {
      zipName,
      successCount: entries.length,
      failCount,
    });

    controls.setStatus(null);
    if (failCount > 0) {
      controls.setError(`完成：成功 ${entries.length} 个，失败 ${failCount} 个。\n失败的对话可能不在侧栏中，请单独打开后重试。`);
      return;
    }

    controls.setStatus(`✓ 已打包导出 ${entries.length} 个对话 → ${zipName}`);
    setTimeout(() => controls.setStatus(null), 5000);
  }

  return {
    async runExport(choice: ExportChoice, selected: ConversationSummary[]): Promise<void> {
      const controls = getControls();
      controls.setError(null);

      try {
        const adapter = pickAdapter(new URL(location.href));
        if (!adapter) {
          controls.setError('当前站点暂不支持。');
          return;
        }

        const settings = await loadSettings();
        const rootDir = (settings.rootDir ?? '').trim();
        debugLogs.push('info', 'runExport.start', {
          choice,
          selectedCount: selected.length,
          logsEnabled: settings.enableDebugLogs,
        });

        if (selected.length <= 1) {
          const conv = selected[0];
          const res = await resolveSingleConversation(selected);
          controls.setStatus(null);

          if (!res.ok) {
            debugLogs.push('warn', 'runExport.single.failed', {
              reason: res.reason,
              title: conv?.title,
            });
            controls.setError(`导出失败：${res.reason}`);
            return;
          }

          const username = adapter.detectUsername();
          const conversation = finalizeConversationTitle(adapter.id, res.conversation, conv?.title);

          if (choice === 'pdf') {
            try {
              controls.setStatus('正在准备 PDF 导出…');
              let filename: string;

              if (adapter.id === 'glm') {
                filename = buildCategorizedFilename({
                  rootDir: rootDir || 'ChatStash',
                  platform: conversation.platform,
                  username,
                  title: conversation.title,
                  timestamp: nowStamp(),
                  ext: 'pdf',
                });
                const blob = await conversationToPdfBlob(conversation);
                downloadBlobFile(filename, blob);
              } else {
                filename = await exportSinglePdf(conversation, username, rootDir, {
                  waitMs: adapter.id === 'kimi' ? 1600 : 0,
                  printProfile: adapter.id === 'kimi' ? 'kimi' : 'generic',
                });
              }

              controls.setStatus('✓ PDF 已生成');
              debugLogs.push('info', 'runExport.single.pdf.done', {
                title: conversation.title,
                filename,
              });
              setTimeout(() => controls.setStatus(null), 4000);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              debugLogs.push('error', 'runExport.single.pdf.failed', {
                title: conversation.title,
                error: message,
              });
              controls.setError(`PDF 导出失败：${message}`);
            }
            return;
          }

          const payload = buildExportPayload(choice, conversation);
          const filename = buildCategorizedFilename({
            rootDir: rootDir || 'ChatStash',
            platform: conversation.platform,
            username,
            title: conversation.title,
            timestamp: nowStamp(),
            ext: payload.ext,
          });

          downloadTextFile(filename, payload.content, payload.mime);
          controls.setStatus(`✓ 已成功导出 1 个对话 (${payload.ext.toUpperCase()})`);
          debugLogs.push('info', 'runExport.single.done', {
            title: conversation.title,
            ext: payload.ext,
          });
          setTimeout(() => controls.setStatus(null), 4000);
          return;
        }

        if (choice === 'pdf') {
          await exportBatchPdf(selected, adapter.label);
          return;
        }

        await exportBatchText(choice, selected, adapter.label);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        debugLogs.push('error', 'runExport.crash', { choice, error: message });
        controls.setStatus(null);
        controls.setError(`导出失败：${message}`);
      }
    },

    async exportDebugLogs(): Promise<void> {
      await debugLogs.exportLogs(getControls());
    },
  };
}
