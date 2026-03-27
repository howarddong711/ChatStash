import type { ChatTurn, Conversation, ConversationSummary } from '@/shared/types';

import { buildTurnsFromMessageElements, summarizeDebugCounts } from './heuristics';
import type { ExtractResult, SiteAdapter } from './types';

const KIMI_HOSTS = new Set(['www.kimi.com', 'kimi.moonshot.cn']);

type KimiListChatsResponse = {
  chats?: Array<{
    id?: string;
    name?: string;
    title?: string;
    updateTime?: string;
    createTime?: string;
  }>;
  nextPageToken?: string;
};

function pickTitle(): string {
  const title = document.title?.trim();
  if (title && !/^kimi/i.test(title)) return title;
  return 'Kimi Chat';
}

function getKimiToken(): string | null {
  const token = localStorage.getItem('access_token') || localStorage.getItem('refresh_token');
  return token?.trim() || null;
}

async function requestKimiApi<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
  const token = getKimiToken();
  if (!token) return null;

  try {
    const response = await fetch(new URL(path, location.origin).toString(), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/plain, */*',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function buildKimiConversationUrl(id: string): string {
  const url = new URL(location.origin);
  url.pathname = `/chat/${id}`;
  url.searchParams.set('chat_enter_method', 'history');
  return url.toString();
}

async function listKimiConversationsByApi(): Promise<ConversationSummary[]> {
  const results: ConversationSummary[] = [];
  const seen = new Set<string>();
  let nextPageToken = '';

  for (let round = 0; round < 40; round += 1) {
    const json = await requestKimiApi<KimiListChatsResponse>(
      '/apiv2/kimi.chat.v1.ChatService/ListChats',
      {
        project_id: '',
        page_size: 50,
        query: '',
        ...(nextPageToken ? { page_token: nextPageToken } : {}),
      },
    );

    const chats = Array.isArray(json?.chats) ? json.chats : [];
    if (chats.length === 0) break;

    for (const chat of chats) {
      const id = String(chat.id ?? '').trim();
      const title = String(chat.name ?? chat.title ?? '').trim();
      if (!id || !title || seen.has(id)) continue;

      seen.add(id);
      results.push({
        id,
        title: title.slice(0, 200),
        url: buildKimiConversationUrl(id),
        updatedAt: String(chat.updateTime ?? chat.createTime ?? '').trim() || undefined,
      });
    }

    nextPageToken = String(json?.nextPageToken ?? '').trim();
    if (!nextPageToken) break;
  }

  return results;
}

function listKimiConversationsFromDom(): ConversationSummary[] {
  const results: ConversationSummary[] = [];
  const seen = new Set<string>();
  const selectors = [
    'a[href*="/chat/"]',
    '[class*="history" i] a[href]',
    'aside a[href]',
    'nav a[href]',
    'main a[href*="/chat/"]',
  ];

  for (const selector of selectors) {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(selector));
    for (const link of links) {
      try {
        const url = new URL(link.href, location.origin);
        if (!KIMI_HOSTS.has(url.hostname)) continue;
        if (url.pathname === '/chat/history') continue;

        const match = url.pathname.match(/\/chat\/([^/?]+)/i);
        const id = match?.[1]?.trim();
        const title = (link.textContent?.trim() || link.getAttribute('title') || '').trim();
        if (!id || !title || seen.has(id)) continue;

        seen.add(id);
        results.push({ id, title: title.slice(0, 200), url: url.toString() });
      } catch {
        // ignore malformed hrefs
      }
    }

    if (results.length > 0) break;
  }

  return results;
}

function notSidebarNoise(el: Element): boolean {
  return !el.closest('nav, aside, footer, #chatstash-root');
}

function isKimiUiNoiseText(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return true;
  if (/^Edit$/i.test(normalized)) return true;
  if (/^\d+\/\d+$/.test(normalized)) return true;
  if (/^当前模型仅对图片中的文字进行识别/u.test(normalized)) return true;
  if (/^切换\s*K1\.5\s*获取更好的视觉理解能力/u.test(normalized)) return true;
  if (/^Capacity is busy/i.test(normalized)) return true;
  if (/^System is currently busy/i.test(normalized)) return true;
  return false;
}

function isLikelyMessageNode(el: Element): boolean {
  const text = el.textContent?.trim() ?? '';
  if (isKimiUiNoiseText(text)) return false;
  if (el.matches('button, input, textarea, label')) return false;

  const className = el instanceof HTMLElement ? el.className : '';
  const classText = typeof className === 'string' ? className : '';
  if (/(toolbar|action|footer|header|input|editor|placeholder)/i.test(classText)) return false;

  return true;
}

function collectMessageElements(): Element[] {
  const root = document.querySelector('main') || document;

  const structured = Array.from(
    root.querySelectorAll<Element>('[data-message-author-role], [data-role="user"], [data-role="assistant"]'),
  ).filter(notSidebarNoise);
  if (structured.length > 0) return structured;

  const containerSelectors = [
    '#chat-container',
    '#page-layout-container',
    '.layout-content-main',
    '[role="feed"]',
    '[role="list"]',
    '[class*="conversation" i]',
    '[class*="message-list" i]',
    '[class*="chat-content" i]',
  ];

  for (const selector of containerSelectors) {
    const containers = Array.from(root.querySelectorAll<Element>(selector)).filter(notSidebarNoise);
    for (const container of containers) {
      const children = Array.from(container.children).filter(
        (child) => notSidebarNoise(child) && isLikelyMessageNode(child),
      );
      if (children.length >= 2) return children;
    }
  }

  const directSelectors = [
    '[class*="chat-message" i]',
    '[class*="MessageItem" i]',
    '[class*="message-item" i]',
    '[class*="ChatItem" i]',
    '[class*="segment" i]',
    '[class*="bubble" i]',
    '[data-testid*="message" i]',
  ];

  for (const selector of directSelectors) {
    const wrappers = new Set<Element>();
    const matches = Array.from(root.querySelectorAll<Element>(selector)).filter(
      (el) => notSidebarNoise(el) && isLikelyMessageNode(el),
    );

    for (const match of matches) {
      const wrapper =
        match.closest(
          '[class*="chat-message" i], [class*="MessageItem" i], [class*="message-item" i], [class*="ChatItem" i], article, [role="listitem"]',
        ) || match;

      if (notSidebarNoise(wrapper) && isLikelyMessageNode(wrapper)) {
        wrappers.add(wrapper);
      }
    }

    const candidates = Array.from(wrappers);
    if (candidates.length >= 2) return candidates;
  }

  return Array.from(root.querySelectorAll('[role="listitem"], article')).filter(notSidebarNoise);
}

export const kimiAdapter: SiteAdapter = {
  id: 'kimi',
  label: 'Kimi',
  matches(url: URL) {
    return KIMI_HOSTS.has(url.hostname) && url.pathname.startsWith('/chat');
  },

  detectUsername(): string | null {
    return null;
  },

  async listConversations(): Promise<ConversationSummary[]> {
    const domItems = listKimiConversationsFromDom();
    if (domItems.length > 0) return domItems;

    const apiItems = await listKimiConversationsByApi();
    if (apiItems.length > 0) return apiItems;

    return [];
  },

  async extract(): Promise<ExtractResult> {
    const els = collectMessageElements();
    const turns: ChatTurn[] = buildTurnsFromMessageElements(els);

    if (turns.length < 2) {
      return {
        ok: false,
        reason: '未能识别到足够的消息节点（可能是页面结构更新、未进入具体会话，或内容尚未加载完成）。',
        debug: { counts: summarizeDebugCounts(), url: location.href, foundElements: els.length },
      };
    }

    const conversation: Conversation = {
      title: pickTitle(),
      url: location.href,
      platform: 'kimi',
      exportedAt: new Date().toISOString(),
      turns,
    };

    return { ok: true, conversation, turns };
  },
};
