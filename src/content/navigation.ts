import { pickAdapter } from '@/adapters';
import type { ExtractResult, SiteAdapter } from '@/adapters/types';

import type { DebugLogStore } from './debugLogs';
import { delay } from './utils';

const CONTENT_SELECTORS =
  '[data-message-author-role], [data-role="user"], [data-role="assistant"], ' +
  '.ds-markdown, .ds-message, [class*="user-message"], [class*="assistant-message"], ' +
  '#chat-container, .chat-box, [class*="message-item"], [class*="MessageItem"], [class*="segment"], ' +
  '[class*="markdown" i], [class*="conversation" i], [class*="bubble" i], article, [role="listitem"]';

export function extractChatId(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'chatglm.cn' && /^\/main\/alltoolsdetail\/?$/i.test(parsed.pathname)) {
      const cid = parsed.searchParams.get('cid')?.trim();
      if (cid) return `cid:${cid}`;

      const t = parsed.searchParams.get('t')?.trim();
      if (t) return `glm-t:${t}`;
    }

    const path = parsed.pathname;
    const match = path.match(/\/chat\/(?:s\/)?([^/]+)\/?$/);
    return match ? match[1] : path;
  } catch {
    return url;
  }
}

function extractGlmCid(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'chatglm.cn') return null;
    if (!/^\/main\/alltoolsdetail\/?$/i.test(parsed.pathname)) return null;
    return parsed.searchParams.get('cid')?.trim() || null;
  } catch {
    return null;
  }
}

function extractGlmTitle(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'chatglm.cn') return null;
    if (!/^\/main\/alltoolsdetail\/?$/i.test(parsed.pathname)) return null;
    return parsed.searchParams.get('chatstash_title')?.trim() || null;
  } catch {
    return null;
  }
}

function normalizeTitle(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function getSelectedGlmSidebarTitle(): string | null {
  const selectedTitle = document.querySelector<HTMLElement>(
    '#aside-history-list .history-item.selected .title',
  );
  const text = normalizeTitle(selectedTitle?.innerText || selectedTitle?.textContent || '');
  return text || null;
}

export function waitForConversationContent(expectedUrl: string, timeout = 4000): Promise<void> {
  return new Promise<void>((resolve) => {
    const expectedId = extractChatId(expectedUrl);
    const expectedGlmTitle = extractGlmTitle(expectedUrl);
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
      const selectedGlmTitle = getSelectedGlmSidebarTitle();
      const glmTitleMatches =
        !!expectedGlmTitle &&
        !!selectedGlmTitle &&
        normalizeTitle(expectedGlmTitle) === normalizeTitle(selectedGlmTitle);
      const urlMatches = glmTitleMatches || (currentId !== '' && currentId === expectedId);
      const hasContent = !!document.querySelector(CONTENT_SELECTORS);
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
    check();
  });
}

async function extractWithRetry(adapter: SiteAdapter, expectedUrl: string): Promise<ExtractResult> {
  const first = await adapter.extract();
  if (first.ok) return first;

  const shouldRetry =
    (adapter.id === 'deepseek' || adapter.id === 'glm') &&
    /未能识别到足够的消息节点/.test(first.reason);
  if (!shouldRetry) return first;

  await waitForConversationContent(expectedUrl, adapter.id === 'glm' ? 7000 : 6000);
  await delay(adapter.id === 'glm' ? 900 : 450);

  const second = await adapter.extract();
  if (second.ok || adapter.id !== 'glm') return second;

  await delay(1200);
  return adapter.extract();
}

function clickSidebarLink(targetUrl: string): 'already' | 'clicked' | 'not_found' {
  const targetId = extractChatId(targetUrl);
  if (!targetId) return 'not_found';

  if (extractChatId(location.href) === targetId) return 'already';

  const glmCid = extractGlmCid(targetUrl);
  if (glmCid) {
    const glmCandidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        `a[href*="${glmCid}"], [data-cid="${glmCid}"], [data-conversation-id="${glmCid}"], [data-session-id="${glmCid}"], [data-id="${glmCid}"]`,
      ),
    );

    const glmMatch =
      glmCandidates.find((el) => !el.closest('#chatstash-root')) ||
      Array.from(document.querySelectorAll<HTMLElement>('li, div, button, [role="button"]')).find((el) => {
        if (el.closest('#chatstash-root')) return false;
        return Array.from(el.attributes).some((attr) => attr.value.includes(glmCid));
      });

    if (glmMatch) {
      glmMatch.click();
      return 'clicked';
    }
  }

  const glmTitle = extractGlmTitle(targetUrl);
  if (glmTitle) {
    const normalizedTarget = normalizeTitle(glmTitle);
    const historyItems = Array.from(
      document.querySelectorAll<HTMLElement>('#aside-history-list .list .history-item'),
    );

    const titleMatch = historyItems.find((item) => {
      if (item.closest('#chatstash-root')) return false;
      const titleEl = item.querySelector<HTMLElement>('.title');
      const text = normalizeTitle(titleEl?.innerText || titleEl?.textContent || '');
      return text === normalizedTarget;
    });

    if (titleMatch) {
      titleMatch.click();
      return 'clicked';
    }
  }

  const allAnchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
  const match = allAnchors.find((anchor) => {
    try {
      return extractChatId(anchor.href) === targetId;
    } catch {
      return false;
    }
  });

  if (!match) return 'not_found';
  match.click();
  return 'clicked';
}

export async function extractConversationByUrl(
  url: string,
  debugLogs: DebugLogStore,
): Promise<ExtractResult> {
  const adapter = pickAdapter(new URL(url));
  if (!adapter) return { ok: false, reason: '不支持的站点' };

  const navResult = clickSidebarLink(url);
  debugLogs.push('info', 'extractConversationByUrl.navResult', { targetUrl: url, navResult });

  if (navResult === 'already') {
    await waitForConversationContent(url, 5000);
    if (adapter.id === 'glm') {
      await delay(600);
    }
    return extractWithRetry(adapter, url);
  }

  if (navResult === 'not_found') {
    return { ok: false, reason: '侧栏中未找到该对话链接，请确保该对话在侧栏中可见' };
  }

  await waitForConversationContent(url, 5000);
  if (adapter.id === 'glm') {
    await delay(900);
  }
  return extractWithRetry(adapter, url);
}
