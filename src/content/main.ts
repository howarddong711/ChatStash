import { pickAdapter } from '@/adapters';
import { conversationToJson } from '@/exporters/json';
import { conversationToMarkdown } from '@/exporters/markdown';
import { conversationToPdfBlob } from '@/exporters/pdf';
import {
  buildCategorizedFilename,
  buildFilePath,
  downloadTextFile,
  downloadZip,
  safeFilename,
  type ZipEntry,
} from '@/shared/download';
import { getSettings } from '@/shared/settings';
import type { ConversationSummary } from '@/shared/types';

import { mountUI } from './ui';
import type { ExportChoice } from './ui';

type DebugLogLevel = 'info' | 'warn' | 'error';

type DebugLogEntry = {
  time: string;
  level: DebugLogLevel;
  event: string;
  url: string;
  details?: Record<string, unknown>;
};

let debugLogsEnabled = false;
const debugLogs: DebugLogEntry[] = [];

function pushDebugLog(
  level: DebugLogLevel,
  event: string,
  details?: Record<string, unknown>,
): void {
  if (!debugLogsEnabled) return;
  debugLogs.push({
    time: new Date().toISOString(),
    level,
    event,
    url: location.href,
    details,
  });
}

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  // Format: YYYY-MM-DD_HHmm (includes minutes for unique filenames)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function dateStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Extract the chat ID from a URL path.
 * Handles all variants:
 *   - Doubao:  /chat/3366766533906
 *   - DeepSeek: /a/chat/s/{uuid}  OR  /a/chat/{uuid}  OR  /chat/{uuid}
 * Returns the last non-empty segment after /chat/ (strips the optional /s/).
 */
function extractChatId(url: string): string {
  try {
    const path = new URL(url).pathname;
    const m = path.match(/\/chat\/(?:s\/)?([^/]+)\/?$/);
    return m ? m[1] : path;
  } catch {
    return url;
  }
}

/**
 * Wait for React Router to finish rendering the target conversation.
 *
 * Resolves when:
 *   - The current URL's chat ID matches the expected chat ID  AND
 *   - Known message elements are present in the DOM
 *
 * Falls back to a hard timeout so we never stall forever.
 * Using MutationObserver instead of setInterval polling.
 */
function waitForConversationContent(expectedUrl: string, timeout = 4000): Promise<void> {
  return new Promise<void>((resolve) => {
    const SELECTORS =
      '[data-message-author-role], [data-role="user"], [data-role="assistant"], ' +
      '.ds-markdown, .ds-message, [class*="user-message"], [class*="assistant-message"]';

    const expectedId = extractChatId(expectedUrl);
    let resolved = false;
    let matchedAt = 0;
    const minStableMs = 280;

    const done = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      observer.disconnect();
      resolve();
    };

    const check = () => {
      const currentId = extractChatId(location.href);
      const urlMatches = currentId !== '' && currentId === expectedId;
      const hasContent = !!document.querySelector(SELECTORS);
      if (!urlMatches || !hasContent) {
        matchedAt = 0;
        return;
      }

      if (!matchedAt) {
        matchedAt = Date.now();
        return;
      }

      if (Date.now() - matchedAt >= minStableMs) done();
    };

    const timer = setTimeout(done, timeout);
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });

    // Check immediately in case content is already present
    check();
  });
}

async function extractWithRetry(
  adapter: import('@/adapters/types').SiteAdapter,
  expectedUrl: string,
): Promise<import('@/adapters/types').ExtractResult> {
  const first = await adapter.extract();
  if (first.ok) return first;

  const shouldRetry =
    adapter.id === 'deepseek' &&
    /未能识别到足够的消息节点/.test(first.reason);
  if (!shouldRetry) return first;

  await waitForConversationContent(expectedUrl, 6000);
  await new Promise((r) => setTimeout(r, 450));
  return adapter.extract();
}

/**
 * Navigate to a conversation by clicking its sidebar <a> element.
 *
 * Returns:
 *   'already'   – already on the target conversation (no navigation needed)
 *   'clicked'   – found the sidebar link and clicked it
 *   'not_found' – no matching sidebar link found
 */
function clickSidebarLink(targetUrl: string): 'already' | 'clicked' | 'not_found' {
  const targetId = extractChatId(targetUrl);
  if (!targetId) return 'not_found';

  // Already on this exact conversation — extract immediately, no click needed
  if (extractChatId(location.href) === targetId) return 'already';

  // Find an <a> element whose href resolves to the same chat ID
  const allAnchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
  const match = allAnchors.find((a) => {
    try {
      return extractChatId(a.href) === targetId;
    } catch {
      return false;
    }
  });

  if (match) {
    match.click(); // React Router intercepts this click and renders the new route
    return 'clicked';
  }

  return 'not_found';
}

/**
 * Navigate to a conversation URL and extract its content.
 *
 * Strategy:
 * 1. Already on target page → extract immediately (no navigation)
 * 2. Find sidebar <a> → click it → wait for React to render → extract
 * 3. No sidebar link → return failure (don't navigate blindly)
 */
async function extractConversationByUrl(
  url: string,
  _controls: ReturnType<typeof mountUI>,
): Promise<import('@/adapters/types').ExtractResult> {
  const adapter = pickAdapter(new URL(url));
  if (!adapter) return { ok: false, reason: '不支持的站点' };

  const navResult = clickSidebarLink(url);
  pushDebugLog('info', 'extractConversationByUrl.navResult', { targetUrl: url, navResult });

  if (navResult === 'already') {
    // Already on this page — but DOM may still be loading (e.g. active conversation).
    // Wait for content to be present before extracting.
    await waitForConversationContent(url, 5000);
    return extractWithRetry(adapter, url);
  }

  if (navResult === 'not_found') {
    return { ok: false, reason: '侧栏中未找到该对话链接，请确保该对话在侧栏中可见' };
  }

  // navResult === 'clicked' — wait for React Router to render the new route
  await waitForConversationContent(url, 5000);
  return extractWithRetry(adapter, url);
}

// ── Batch export overlay ─────────────────────────────────────────────────────
// During batch export, we overlay the page with a semi-transparent mask so the
// user doesn't see the sidebar navigation jumps between conversations.

const OVERLAY_ID = 'chatstash-overlay';

function showOverlay(message: string): void {
  if (document.getElementById(OVERLAY_ID)) return;
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483646',
    'background:rgba(0,0,0,0.55)', 'display:flex',
    'align-items:center', 'justify-content:center',
    'flex-direction:column', 'gap:12px',
    'backdrop-filter:blur(4px)',
    '-webkit-backdrop-filter:blur(4px)',
  ].join(';');

  const spinner = document.createElement('div');
  spinner.style.cssText = [
    'width:36px', 'height:36px',
    'border:3px solid rgba(255,255,255,0.3)',
    'border-top-color:#fff',
    'border-radius:50%',
    'animation:cs-spin 0.8s linear infinite',
  ].join(';');

  // Inject keyframes once
  if (!document.getElementById('chatstash-overlay-style')) {
    const style = document.createElement('style');
    style.id = 'chatstash-overlay-style';
    style.textContent = '@keyframes cs-spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
  }

  const label = document.createElement('div');
  label.id = 'chatstash-overlay-label';
  label.style.cssText = 'color:#fff;font-size:14px;font-family:system-ui,sans-serif;text-align:center;max-width:280px;line-height:1.5';
  label.textContent = message;

  overlay.append(spinner, label);
  document.documentElement.appendChild(overlay);
}

function updateOverlay(message: string): void {
  const label = document.getElementById('chatstash-overlay-label');
  if (label) label.textContent = message;
}

function hideOverlay(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}

/**
 * Send a message to the background service worker to generate a PDF
 * of the current tab using chrome.debugger + Page.printToPDF.
 * The background will attach the debugger, print, detach, and trigger download.
 */


/**
 * Inject CSS to hide sidebar, header, and other UI noise for a clean PDF print.
 */
function injectPrintStyles(): void {
  const style = document.createElement('style');
  style.id = 'chatstash-print-styles';
  // Selectors to hide in Doubao and DeepSeek
  const hideSelectors = [
    'nav', 'header', 'footer', 'aside',
    '[class*="sidebar" i]', '[class*="header" i]', '[class*="footer" i]',
    '[class*="input-area" i]', '[class*="feedback" i]', '[class*="action" i]',
    '[class*="chat-input" i]', '[class*="editor-container" i]',
    '.chat-feedback', '.message-actions',
    'textarea[placeholder*="发消息"]', 'input[placeholder*="发消息"]',
    '[contenteditable="true"][data-placeholder*="发消息"]',
    '#chatstash-root', // Hide our own UI
  ];
  
    const forceExpandSelectors = [
      'body', 'html', 'main', '#root', '#app', '[id*="root" i], [id*="app" i]',
      '[class*="main" i]', '[class*="container" i]', '[class*="layout" i]',
      '[class*="content" i]', '[class*="wrapper" i]', '[class*="scroll" i]',
      '[class*="chat" i]', '[class*="thread" i]', '[class*="session" i]',
      '[class*="conversation" i]', '[class*="message-list" i]', '[class*="messageList" i]',
      '[class*="chat-scroll" i]', '[class*="chatScroll" i]', '.ds-scroll-area', '.ds-chat-messages',
      '.doubao-scroll-area', '.conversation-list', '.chat-content', '.message-list-wrapper',
      '#main', '#chat-root', '[data-testid*="scroll" i]', '[role="feed"]', '[role="list"]',
      '[class*="message-scroll" i]', '[class*="messageScroll" i]', '[class*="list-container" i]',
      '[class*="item-container" i]', '[class*="scroll-container" i]',
      '[class*="doubao" i]', '[class*="arco-scroll" i]', '[class*="arco-layout" i]'
    ];

  style.textContent = `
    @media print {
      /* 1. Hide UI Noise */
      ${hideSelectors.join(', ')} { 
        display: none !important; 
        visibility: hidden !important;
        height: 0 !important;
        width: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      /* 2. Force container expansion - The "Shredder" approach */
      ${forceExpandSelectors.join(', ')} {
        height: auto !important;
        min-height: 0 !important;
        max-height: none !important;
        overflow: visible !important;
        display: block !important;
        position: static !important;
        width: 100% !important;
        max-width: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        transform: none !important;
        box-shadow: none !important;
        clip: auto !important;
        clip-path: none !important; /* Doubao may use clip-path to hide content */
      }


      /* 2b. Aggressively target ANY div that might have scrollbars */
      div, section, article, main {
        overflow: visible !important;
        height: auto !important;
      }
      
      /* 2c. Restore standard body scroll behavior */
      body, html {
        overflow: visible !important;
        height: auto !important;
      }

      /* 3. Specific fix for Doubao/DeepSeek message list - avoid hidden parents */
      [class*="scroll" i], [class*="chat" i], [class*="message" i], main {
        overflow: visible !important;
        height: auto !important;
        display: block !important;
      }

      /* 4. Ensure KaTeX/MathJax are visible */
      .katex, .MathJax, .math, [data-latex] {
        overflow: visible !important;
      }

      /* 5. Hide floating buttons and fixed UI */
      [class*="fixed" i]:not([class*="message" i]),
      [class*="sticky" i]:not([class*="message" i]),
      button[aria-label*="copy" i], button[aria-label*="share" i] {
        display: none !important;
      }
    }
  `;

  document.head.appendChild(style);
}

function removePrintStyles(): void {
  document.getElementById('chatstash-print-styles')?.remove();
}

/** Hide the ChatStash floating UI so it doesn't appear in the printed PDF. */
function hideChatstashUI(): void {
  const root = document.getElementById('chatstash-root');
  const overlay = document.getElementById(OVERLAY_ID);
  if (root) root.style.setProperty('display', 'none', 'important');
  if (overlay) overlay.style.setProperty('display', 'none', 'important');
}

/** Restore the ChatStash floating UI after printing. */
function restoreChatstashUI(): void {
  const root = document.getElementById('chatstash-root');
  const overlay = document.getElementById(OVERLAY_ID);
  if (root) root.style.removeProperty('display');
  if (overlay) overlay.style.removeProperty('display');
}

/**
 * Ask the background to generate a PDF of the current page and return its
 * raw base64 data (without downloading). Used by batch export to collect
 * multiple PDFs and pack them into a single ZIP.
 */

// ── Export logic ─────────────────────────────────────────────────────────────

async function exportCurrentPage(
  choice: ExportChoice,
  controls: ReturnType<typeof mountUI>,
): Promise<void> {
  const adapter = pickAdapter(new URL(location.href));
  if (!adapter) {
    controls.setError('当前站点暂不支持。');
    return;
  }

  controls.setStatus('正在提取当前对话…');
  const res = await adapter.extract();
  controls.setStatus(null);

  if (!res.ok) {
    const debug = res.debug ? `\n\nDebug: ${JSON.stringify(res.debug, null, 2)}` : '';
    controls.setError(`${res.reason}${debug}`);
    return;
  }

  const settings = await getSettings();
  debugLogsEnabled = settings.enableDebugLogs;
  pushDebugLog('info', 'exportCurrentPage.start', { choice, logsEnabled: debugLogsEnabled });
  const username = adapter.detectUsername();
  const conversation = res.conversation;
  const rootDir = (settings.rootDir ?? '').trim();


  if (choice === 'pdf') {
    try {
      controls.setStatus('正在准备 PDF 导出…');
      const filename = buildCategorizedFilename({
        rootDir: rootDir || 'ChatStash',
        platform: conversation.platform,
        username,
        title: conversation.title,
        timestamp: nowStamp(),
        ext: 'pdf',
      });

      // Use high-quality Page.printToPDF via debugger
      injectPrintStyles();
      hideChatstashUI();

      // Increased delay for Doubao's complex layout and math rendering
      await new Promise(r => setTimeout(r, 1200));

      const response = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'CHATSTASH_PRINT_TO_PDF', filename },
          (resp) => resolve(resp || { ok: false, error: 'Background script disconnected' })
        );
      });

      removePrintStyles();
      restoreChatstashUI();

      if (!response.ok) throw new Error(response.error);

      controls.setStatus('✓ PDF 已生成');
      pushDebugLog('info', 'exportCurrentPage.pdf.done', { filename });
      setTimeout(() => controls.setStatus(null), 4000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushDebugLog('error', 'exportCurrentPage.pdf.failed', { error: msg });
      removePrintStyles();
      restoreChatstashUI();
      controls.setStatus(null);
      controls.setError(`PDF 导出失败：${msg}`);
    }

    return;
  }

  const ext = choice === 'markdown' ? 'md' : 'json';
  const content =
    choice === 'markdown' ? conversationToMarkdown(conversation) : conversationToJson(conversation);

  downloadTextFile(
    buildCategorizedFilename({
      rootDir: rootDir || 'ChatStash',
      platform: conversation.platform,
      username,
      title: conversation.title,
      timestamp: nowStamp(),
      ext,
    }),
    content,
    choice === 'markdown' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8',
  );

  pushDebugLog('info', 'exportCurrentPage.done', {
    choice,
    platform: conversation.platform,
    title: conversation.title,
  });
}

async function exportDebugLogs(controls: ReturnType<typeof mountUI>): Promise<void> {
  const settings = await getSettings();
  debugLogsEnabled = settings.enableDebugLogs;

  if (!debugLogsEnabled) {
    controls.setError('调试日志未开启。请在设置页启用“导出调试日志”后再尝试。');
    return;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    page: location.href,
    entries: debugLogs,
  };

  const filename = `ChatStash_DebugLog_${dateStamp()}_${nowStamp()}.json`;
  downloadTextFile(filename, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  controls.setStatus(`✓ 已导出日志：${filename}`);
  setTimeout(() => controls.setStatus(null), 5000);
}

function buildExportPayload(
  choice: ExportChoice,
  conversation: import('@/shared/types').Conversation,
): { ext: string; mime: string; content: string } {
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

async function runExport(
  choice: ExportChoice,
  selected: ConversationSummary[],
  controls: ReturnType<typeof mountUI>,
): Promise<void> {
  controls.setError(null);

  try {
    const adapter = pickAdapter(new URL(location.href));
    if (!adapter) {
      controls.setError('当前站点暂不支持。');
      return;
    }

    const settings = await getSettings();
    debugLogsEnabled = settings.enableDebugLogs;
    pushDebugLog('info', 'runExport.start', {
      choice,
      selectedCount: selected.length,
      logsEnabled: debugLogsEnabled,
    });
    const rootDir = (settings.rootDir ?? '').trim();

    // ── Single conversation (current or sidebar) ──────────────────────────────
    if (selected.length === 0 || selected.length === 1) {
      const conv = selected[0];
      let res: import('@/adapters/types').ExtractResult;

      if (selected.length === 0) {
        res = await adapter.extract();
      } else {
        controls.setStatus(`正在导出：${conv.title}…`);
        res = await extractConversationByUrl(conv.url, controls);
      }

      controls.setStatus(null);

      if (!res.ok) {
        pushDebugLog('warn', 'runExport.single.failed', { reason: res.reason, title: conv?.title });
        controls.setError(`导出失败：${res.reason}`);
        return;
      }

      const username = adapter.detectUsername();
      const conversation = res.conversation;

      if (choice === 'pdf') {
        try {
          controls.setStatus('正在准备 PDF 导出…');
          const filename = buildCategorizedFilename({
            rootDir: rootDir || 'ChatStash',
            platform: conversation.platform,
            username,
            title: conversation.title,
            timestamp: nowStamp(),
            ext: 'pdf',
          });

          injectPrintStyles();
          hideChatstashUI();

          const response = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
            chrome.runtime.sendMessage(
              { type: 'CHATSTASH_PRINT_TO_PDF', filename },
              (resp) => resolve(resp || { ok: false, error: 'Background script disconnected' })
            );
          });

          removePrintStyles();
          restoreChatstashUI();

          if (!response.ok) throw new Error(response.error);

          controls.setStatus('✓ PDF 已生成');
          pushDebugLog('info', 'runExport.single.pdf.done', { title: conversation.title, filename });
          setTimeout(() => controls.setStatus(null), 4000);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          removePrintStyles();
          restoreChatstashUI();
          controls.setError(`PDF 导出失败：${msg}`);
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
      pushDebugLog('info', 'runExport.single.done', { title: conversation.title, ext: payload.ext });
      setTimeout(() => controls.setStatus(null), 4000);
      return;
    }

    // ── Batch PDF ─────────────────────────────────────────────────────────────
    if (choice === 'pdf') {
      showOverlay(`批量PDF导出中，请勿操作…\n（0/${selected.length}）`);
      const pdfEntries: ZipEntry[] = [];
      let pdfFailCount = 0;
      const platformLabel = safeFilename(adapter.label ?? 'chat');

      try {
        for (let i = 0; i < selected.length; i++) {
          const conv = selected[i];
          updateOverlay(`批量PDF导出中，请勿操作…\n（${i + 1}/${selected.length}）${conv.title}`);
          controls.setStatus(`正在导出 PDF ${i + 1}/${selected.length}：${conv.title}…`);

          const res = await extractConversationByUrl(conv.url, controls);
          if (!res.ok) {
            pdfFailCount++;
            pushDebugLog('warn', 'runExport.batchPdf.extractFailed', { index: i + 1, title: conv.title, reason: res.reason });
            continue;
          }

          try {
            const username = adapter.detectUsername();
            const filePath = buildFilePath({
              platform: adapter.label ?? 'chat',
              username,
              title: conv.title,
              timestamp: nowStamp(),
              ext: 'pdf',
            });

            injectPrintStyles();
            hideChatstashUI();

            // Increased delay for Doubao's complex layout and math rendering (now 1200ms)
            await new Promise(r => setTimeout(r, 1200));

            const response = await new Promise<{ ok: boolean; data?: string; error?: string }>((resolve) => {
              chrome.runtime.sendMessage(
                { type: 'CHATSTASH_GENERATE_PDF' },
                (resp) => resolve(resp || { ok: false, error: 'Background script disconnected' })
              );
            });

            removePrintStyles();
            restoreChatstashUI();

            if (!response.ok || !response.data) throw new Error(response.error || 'No PDF data received');

            const binary = atob(response.data);
            const bytes = new Uint8Array(binary.length);
            for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
            const blob = new Blob([bytes], { type: 'application/pdf' });

            pdfEntries.push({ path: filePath, content: blob });
            pushDebugLog('info', 'runExport.batchPdf.itemDone', { index: i + 1, title: conv.title });
          } catch (e) {
            pdfFailCount++;
            const msg = e instanceof Error ? e.message : String(e);
            removePrintStyles();
            restoreChatstashUI();
            pushDebugLog('warn', 'runExport.batchPdf.itemFailed', { index: i + 1, title: conv.title, error: msg });
          }
        }
      } finally {
        hideOverlay();
      }

      controls.setStatus(null);

      if (pdfEntries.length === 0) {
        controls.setError('所有对话 PDF 导出失败，请确保对话在侧栏中可见后重试。');
      } else {
        controls.setStatus('正在打包 PDF…');
        const finalUsername = safeFilename(adapter.detectUsername() ?? 'default');
        const zipName = `ChatStash_${platformLabel}_PDF_${finalUsername}_${pdfEntries.length}items_${nowStamp()}.zip`;

        await downloadZip(pdfEntries, zipName);
        pushDebugLog('info', 'runExport.batchPdf.done', { successCount: pdfEntries.length, failCount: pdfFailCount });
        if (pdfFailCount > 0) {
          controls.setError(`完成：成功 ${pdfEntries.length} 个，失败 ${pdfFailCount} 个。\n失败的对话可能不在侧栏中，请单独打开后重试。`);
        } else {
          controls.setStatus(`✓ 已打包导出 ${pdfEntries.length} 个 PDF → ${zipName}`);
          setTimeout(() => controls.setStatus(null), 5000);
        }
      }
      return;
    }

    // ── Batch MD/JSON ─────────────────────────────────────────────────────────
    showOverlay(`批量导出中，请勿操作…\n（0/${selected.length}）`);
    const entries: ZipEntry[] = [];
    let failCount = 0;
    const platformLabel = safeFilename(adapter.label ?? 'chat');

    try {
      for (let i = 0; i < selected.length; i++) {
        const conv = selected[i];
        updateOverlay(`批量导出中，请勿操作…\n（${i + 1}/${selected.length}）${conv.title}`);
        controls.setStatus(`正在提取 ${i + 1}/${selected.length}：${conv.title}…`);

        const res = await extractConversationByUrl(conv.url, controls);
        if (!res.ok) {
          failCount++;
          pushDebugLog('warn', 'runExport.batch.itemFailed', { index: i + 1, title: conv.title, reason: res.reason });
          continue;
        }

        const username = adapter.detectUsername();
        const payload = buildExportPayload(choice, res.conversation);
        entries.push({
          path: buildFilePath({
            platform: res.conversation.platform,
            username,
            title: res.conversation.title,
            timestamp: nowStamp(),
            ext: payload.ext,
          }),
          content: payload.content,
        });

        pushDebugLog('info', 'runExport.batch.itemDone', { index: i + 1, title: conv.title, ext: payload.ext });
        if (i < selected.length - 1) {
          await new Promise((r) => setTimeout(r, 300));
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
    const successCount = entries.length;
    const formatLabel = choice === 'markdown' ? 'MD' : 'JSON';
    const zipName = `ChatStash_${platformLabel}_${formatLabel}_${finalUsername}_${successCount}items_${nowStamp()}.zip`;

    await downloadZip(entries, zipName);

    pushDebugLog('info', 'runExport.batch.zipDone', { zipName, successCount, failCount });
    controls.setStatus(null);

    if (failCount > 0) {
      controls.setError(`完成：成功 ${successCount} 个，失败 ${failCount} 个。\n失败的对话可能不在侧栏中，请单独打开后重试。`);
    } else {
      controls.setStatus(`✓ 已打包导出 ${successCount} 个对话 → ${zipName}`);
      setTimeout(() => controls.setStatus(null), 5000);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    pushDebugLog('error', 'runExport.crash', { choice, error: msg });
    controls.setStatus(null);
    controls.setError(`导出失败：${msg}`);
  }
}

function main() {
  const adapter = pickAdapter(new URL(location.href));

  const controls = mountUI({
    onLoadConversations() {
      if (!adapter) return [];
      return adapter.listConversations();
    },
    onExport(choice, selected) {
      void runExport(choice, selected, controls);
    },
    onExportLogs() {
      void exportDebugLogs(controls);
    },
    onOpenSettings() {
      chrome.runtime.sendMessage({ type: 'CHATSTASH_OPEN_OPTIONS' }, (resp?: { ok?: boolean; error?: string }) => {
        const err = chrome.runtime?.lastError;
        if (err || !resp?.ok) {
          controls.setError(`打开设置失败：${err?.message ?? resp?.error ?? '未知错误'}`);
        }
      });
    },
  });
}

main();
