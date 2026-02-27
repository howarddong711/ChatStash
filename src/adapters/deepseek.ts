import type { SiteAdapter, ExtractResult } from './types';
import { buildTurnsFromMessageElements, summarizeDebugCounts } from './heuristics';
import type { ChatTurn, Conversation, ConversationSummary } from '@/shared/types';

let deepSeekApiUsername: string | null = null;
let deepSeekUsernameRefreshTask: Promise<void> | null = null;

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}

function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name || name.length < 2 || name.length > 60) return null;
  return name;
}

function pickAppVersion(): string {
  const keys = ['x-app-version', 'appVersion', 'APP_VERSION'];
  for (const key of keys) {
    const val = localStorage.getItem(key)?.trim();
    if (val) return val;
  }
  return '20241129.1';
}

function pickUsernameFromUnknown(payload: unknown): string | null {
  const rec = asRecord(payload);
  if (!rec) return null;

  const keys = [
    'nickname',
    'nick_name',
    'display_name',
    'displayName',
    'name',
    'username',
    'user_name',
  ];
  for (const k of keys) {
    const name = normalizeUsername(rec[k]);
    if (name) return name;
  }

  const nestedKeys = ['data', 'user', 'profile', 'result'];
  for (const k of nestedKeys) {
    const name = pickUsernameFromUnknown(rec[k]);
    if (name) return name;
  }

  return null;
}

function normalizeToken(raw: string): string | null {
  const trimmed = raw.trim().replace(/^Bearer\s+/i, '');
  return trimmed.length > 0 ? trimmed : null;
}

function extractDeepSeekTokenFromStorage(): string | null {
  const localStorageKeys = [
    'userToken',
    'token',
    'accessToken',
    'deepseekToken',
    'authToken',
  ];

  for (const key of localStorageKeys) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;

    const direct = normalizeToken(raw);
    if (direct && !/^[\[{]/.test(raw.trim())) return direct;

    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'string') {
        const token = normalizeToken(parsed);
        if (token) return token;
      }

      const rec = asRecord(parsed);
      if (!rec) continue;
      const tokenKeys = ['value', 'token', 'accessToken', 'access_token'];
      for (const tk of tokenKeys) {
        const token = normalizeToken(typeof rec[tk] === 'string' ? (rec[tk] as string) : '');
        if (token) return token;
      }
    } catch {
      // ignore invalid JSON and continue searching
    }
  }

  return null;
}

async function fetchDeepSeekUsernameByApi(): Promise<string | null> {
  const token = extractDeepSeekTokenFromStorage();
  const appVersion = pickAppVersion();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1800);

  try {
    const endpoints = ['/api/v0/users/current', '/api/v0/user/current'];

    for (const endpoint of endpoints) {
      // Try cookie-auth request first (works on many web sessions)
      const byCookie = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'x-app-version': appVersion,
        },
        credentials: 'include',
        signal: controller.signal,
      });

      if (byCookie.ok) {
        const data: unknown = await byCookie.json();
        const name = pickUsernameFromUnknown(data);
        if (name) return name;
      }

      if (!token) continue;

      // Fallback to token-auth request
      const byToken = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'x-app-version': appVersion,
        },
        credentials: 'include',
        signal: controller.signal,
      });

      if (!byToken.ok) continue;
      const data: unknown = await byToken.json();
      const name = pickUsernameFromUnknown(data);
      if (name) return name;
    }

    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function refreshDeepSeekUsernameByApi(): Promise<void> {
  if (deepSeekApiUsername) return;
  if (deepSeekUsernameRefreshTask) return deepSeekUsernameRefreshTask;

  deepSeekUsernameRefreshTask = (async () => {
    const name = await fetchDeepSeekUsernameByApi();
    if (name) deepSeekApiUsername = name;
  })().finally(() => {
    deepSeekUsernameRefreshTask = null;
  });

  return deepSeekUsernameRefreshTask;
}

function pickTitle(): string {
  const title = document.title?.trim();
  if (title && !/^deepseek/i.test(title)) return title;
  return 'DeepSeek Chat';
}

/**
 * Collect individual message elements from the DeepSeek chat page.
 *
 * DeepSeek's DOM structure (as of early 2026):
 * - Each message bubble (user OR assistant) is wrapped in `.ds-message`
 * - User messages carry a `[data-um-id]` attribute on an ancestor
 * - Assistant messages contain `.ds-markdown` for the response text
 * - The scroll container is `.ds-scroll-area` or `.ds-chat-messages`
 *
 * Strategy:
 * 1. `.ds-message` — the stable, documented class used by multiple open-source
 *    DeepSeek exporters (ypyf/deepseek-chat-exporter, nicepkg/ctxport, etc.)
 * 2. `[data-um-id]` — marks user message containers, used as a secondary signal
 * 3. Fall back to children of `.ds-scroll-area` or `.ds-chat-messages`
 * 4. Last resort: generic ARIA / semantic selectors
 */
function collectMessageElements(): Element[] {
  // Strategy 1: .ds-message — the canonical DeepSeek message class
  const byDsMessage = Array.from(document.querySelectorAll<Element>('.ds-message'));
  if (byDsMessage.length > 0) return byDsMessage;

  // Strategy 2: data-message-author-role (ChatGPT-style attr, some DS versions)
  const byDataRole = Array.from(
    document.querySelectorAll<Element>('[data-message-author-role]'),
  );
  if (byDataRole.length > 0) return byDataRole;

  // Strategy 3: children of the DeepSeek scroll container
  const scrollSelectors = [
    '.ds-scroll-area',
    '.ds-chat-messages',
    '[class*="chat-area" i]',
    '[class*="chatArea" i]',
    '[class*="message-list" i]',
  ];
  for (const sel of scrollSelectors) {
    const container = document.querySelector<Element>(sel);
    if (!container) continue;
    const children = Array.from(container.children).filter(
      (c) => (c.textContent?.trim().length ?? 0) > 0,
    );
    if (children.length >= 2) return children;
  }

  // Strategy 4: user message containers via data-um-id
  const byUmId = Array.from(document.querySelectorAll<Element>('[data-um-id]'));
  if (byUmId.length > 0) return byUmId;

  // Strategy 5: last-resort ARIA / generic
  return Array.from(
    document.querySelectorAll('[role="listitem"], article, [class*="message" i]'),
  );
}

/**
 * Detect the logged-in DeepSeek user's display name from the page DOM.
 */
function detectDeepSeekUsernameFromDom(): string | null {
  const hasChatAnchorAncestor = (el: Element): boolean => !!el.closest('a[href*="/chat/"]');

  const hasAvatarHint = (el: Element): boolean => {
    if (el.querySelector('img, svg, [class*="avatar" i]')) return true;
    const p = el.parentElement;
    if (!p) return false;
    return !!p.querySelector('img, svg, [class*="avatar" i]');
  };

  const cleanName = (raw: string): string => raw.replace(/\s+/g, ' ').trim();

  const isValidName = (text: string): boolean => {
    if (text.length < 2 || text.length > 24) return false;
    if (/^\d+$/.test(text)) return false;
    if (/^\d{4}-\d{2}$/.test(text)) return false;
    if (/^\d{1,2}:\d{2}$/.test(text)) return false;
    return true;
  };

  const uiNoise =
    /new chat|search|settings|deepseek|deepthink|logout|sign|menu|upgrade|pro|plus|history|today|yesterday|chat/i;

  // Try 0: Heuristic sidebar scan
  // Look for short text elements in the sidebar area (left edge of page)
  const sidebarTexts: Array<{ text: string; score: number }> = [];
  const allElements = document.querySelectorAll('*');
  const minTop = Math.floor(window.innerHeight * 0.58);

  for (const el of allElements) {
    if (!(el instanceof HTMLElement)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.left < -10 || rect.left >= 360 || rect.width <= 20 || rect.width > 280) continue;
    if (rect.top < minTop) continue;
    if (rect.height <= 0 || rect.height > 80) continue;
    if (hasChatAnchorAncestor(el)) continue;
    if (el.closest('main')) continue;

    const text = cleanName(el.textContent ?? '');
    if (!isValidName(text)) continue;

    const childCount = el.children.length;
    if (childCount > 4) continue;

    if (uiNoise.test(text)) continue;

    let score = rect.bottom;
    if (el.tagName === 'BUTTON' || !!el.closest('button')) score += 200;
    if (hasAvatarHint(el)) score += 300;
    if (text.length <= 8) score += 30;

    sidebarTexts.push({ text, score });
  }

  sidebarTexts.sort((a, b) => b.score - a.score);
  if (sidebarTexts.length > 0) {
    return sidebarTexts[0].text;
  }

  // Try 1: data attributes
  const dataSelectors = ['[data-user-name]', '[data-username]', '[data-nickname]'];
  for (const sel of dataSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const val =
        el.getAttribute('data-user-name') ??
        el.getAttribute('data-username') ??
        el.getAttribute('data-nickname');
      const name = val?.trim();
      if (name && name.length > 0 && name.length < 60) return name;
    }
  }

  // Try 2: avatar img alt
  const avatarImgs = document.querySelectorAll<HTMLImageElement>(
    'header img[alt], nav img[alt], [class*="avatar" i] img[alt], [class*="sidebar" i] img[alt]',
  );
  for (const img of avatarImgs) {
    const alt = img.alt?.trim();
    if (alt && alt.length > 0 && alt.length < 60 && !/logo|icon|deepseek/i.test(alt)) {
      return alt;
    }
  }

  // Try 3: profile name elements
  const nameSelectors = [
    'header [class*="username" i]',
    'header [class*="nickname" i]',
    'nav [class*="username" i]',
    '[class*="user-name" i]',
    '[class*="userName" i]',
    '[class*="sidebar" i] [class*="username" i]',
    '[class*="sidebar" i] [class*="nickname" i]',
  ];
  for (const sel of nameSelectors) {
    const el = document.querySelector(sel);
    const text = el?.textContent?.trim();
    if (text && text.length > 0 && text.length < 60) return text;
  }

  return null;
}

/**
 * List all conversations from the DeepSeek sidebar.
 *
 * DeepSeek sidebar links use the path `/a/chat/s/{id}` or `/a/chat/{id}`.
 * IDs are alphanumeric (UUID-like), not pure digits.
 */
function listDeepSeekConversations(): ConversationSummary[] {
  const results: ConversationSummary[] = [];
  const seen = new Set<string>();

  // Strategy 1: anchor tags pointing to /a/chat/ paths (primary DeepSeek URL format)
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a[href*="/a/chat/"], a[href*="/chat/"]'),
  );
  for (const link of links) {
    try {
      const href = link.href;
      const url = new URL(href);
      if (url.hostname !== 'chat.deepseek.com') continue;
      // Match /a/chat/s/{id} or /a/chat/{id} or /chat/{id}
      const pathMatch = url.pathname.match(/\/(?:a\/)?chat\/(?:s\/)?([a-zA-Z0-9_-]{8,})/);
      if (!pathMatch) continue;
      const id = pathMatch[1];
      if (seen.has(id)) continue;
      seen.add(id);

      const textContent = link.textContent?.trim() ?? '';
      const title = textContent || (link.getAttribute('title') ?? id);
      results.push({ id, title: title.slice(0, 200), url: href });
    } catch {
      // skip malformed URLs
    }
  }

  // Strategy 2: sidebar items without direct anchors
  if (results.length === 0) {
    const sidebarSelectors = [
      '[class*="sidebar" i] [class*="item" i]',
      '[class*="history" i] [class*="item" i]',
      'nav [class*="item" i]',
      '[class*="conversation-list" i] > *',
    ];
    for (const sel of sidebarSelectors) {
      const items = Array.from(document.querySelectorAll(sel));
      if (items.length === 0) continue;
      for (const item of items) {
        const text = item.textContent?.trim() ?? '';
        if (!text || text.length > 300) continue;
        const anchor = item.querySelector<HTMLAnchorElement>('a[href]');
        const href = anchor?.href ?? '';
        let id = '';
        if (href) {
          try {
            const match = new URL(href).pathname.match(
              /\/(?:a\/)?chat\/(?:s\/)?([a-zA-Z0-9_-]{8,})/,
            );
            id = match?.[1] ?? '';
          } catch { /* ignore */ }
        }
        if (!id) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        results.push({ id, title: text.slice(0, 200), url: href });
      }
      if (results.length > 0) break;
    }
  }

  return results;
}

export const deepseekAdapter: SiteAdapter = {
  id: 'deepseek',
  label: 'DeepSeek',
  matches(url: URL) {
    return url.hostname === 'chat.deepseek.com';
  },

  detectUsername(): string | null {
    if (deepSeekApiUsername) return deepSeekApiUsername;
    void refreshDeepSeekUsernameByApi();
    return detectDeepSeekUsernameFromDom();
  },

  listConversations(): ConversationSummary[] {
    return listDeepSeekConversations();
  },

  async extract(): Promise<ExtractResult> {
    await refreshDeepSeekUsernameByApi();

    const els = collectMessageElements();
    const turns: ChatTurn[] = buildTurnsFromMessageElements(els);

    if (turns.length < 2) {
      return {
        ok: false,
        reason: '未能识别到足够的消息节点（可能需要滚动加载或页面结构更新）。',
        debug: { counts: summarizeDebugCounts(), url: location.href, foundElements: els.length },
      };
    }

    const conversation: Conversation = {
      title: pickTitle(),
      url: location.href,
      platform: 'deepseek',
      exportedAt: new Date().toISOString(),
      turns,
    };

    return { ok: true, conversation, turns };
  },
};
