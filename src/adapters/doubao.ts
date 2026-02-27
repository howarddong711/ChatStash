import type { SiteAdapter, ExtractResult } from './types';
import { buildTurnsFromMessageElements, summarizeDebugCounts } from './heuristics';
import type { ChatTurn, Conversation, ConversationSummary } from '@/shared/types';

function pickTitle(): string {
  const title = document.title?.trim();
  if (title && !/^doubao/i.test(title)) return title;
  return 'Doubao Chat';
}

/**
 * Collect individual message-bubble elements from the Doubao chat page.
 *
 * Strategy (ordered by specificity):
 *
 * 1. Preferred: data attribute selectors that directly encode author role.
 *    These match exactly one element per message and carry role information.
 *
 * 2. Structural: Doubao renders its conversation as a list of sibling divs
 *    inside a scroll container. We look for the most common structural signals
 *    in this order:
 *      a) Elements with [data-testid] that include "message" — common in React apps
 *      b) Direct children of a [role="list"] or [role="feed"] container
 *      c) Direct children of a known chat-scroll container (class contains
 *         "conversation", "thread", or "session")
 *
 * 3. Last resort: generic class heuristics — but we apply ancestor-dedup in
 *    heuristics.ts so wrapper containers do not swallow all content.
 *
 * IMPORTANT: We deliberately do NOT use `div[class*="message" i]` at the top
 * level because Doubao has a wrapper div whose class contains "message" that
 * wraps the ENTIRE conversation — this was Bug #1.
 */
/**
 * Hide the Doubao chat input area (textarea/input with placeholder).
 * Prevents the input UI from being captured in exports.
 */
function hideInputArea(): void {
  // Priority selectors targeting Doubao's input area
  const inputSelectors = [
    // Exact placeholder match (most reliable)
    'textarea[placeholder*="发消息"]',
    'input[type="text"][placeholder*="发消息"]',
    'input[placeholder*="选择技能"]',
    // Contenteditable variant
    '[contenteditable="true"][data-placeholder*="发消息"]',
    // Data attributes
    '[data-testid*="chat_input" i]',
    '[data-testid*="message_input" i]',
    '[aria-label*="发消息"]',
    '[aria-placeholder*="发消息"]',
    // Common class patterns
    '.msg-input-container',
    '.send-msg-input-container',
    '[class*="msg-input" i]',
    '[class*="chat-input" i]',
    '[class*="input-wrapper" i]',
  ];

  for (const sel of inputSelectors) {
    const elements = document.querySelectorAll<HTMLElement>(sel);
    elements.forEach((el) => {
      el.style.display = 'none';
      // Also try to hide the immediate parent if it's an input container
      const parent = el.closest('[class*="input" i], [class*="send" i], [role="region"]');
      if (parent && parent !== el && parent !== el.parentElement) {
        parent.style.display = 'none';
      }
    });
  }
}


function isSuggestion(el: Element): boolean {
  const text = el.textContent?.trim() ?? '';
  const isShortText = text.length < 120 && text.length > 0;
  const hasClickableUi = el.querySelector('button, [role="button"], a') !== null;
  const hasArrow = text.includes('→') || text.includes('›');
  const isQuestion = /[?？]\s*(?:→|›)?\s*$/.test(text);
  
  const isSuggestionContainer = 
    el.classList.contains('suggestion') ||
    el.classList.contains('suggestions') ||
    el.classList.contains('recommendation') ||
    el.classList.contains('recommendations') ||
    el.classList.contains('quick-reply') ||
    el.classList.contains('follow-up') ||
    el.getAttribute('data-testid')?.includes('suggestion') ||
    el.getAttribute('data-testid')?.includes('recommendation') ||
    el.querySelector('[class*="recommend" i], [class*="suggestion" i]') !== null;
  
  // Doubao specific: suggestions often end with an arrow and are short questions.
  if (isShortText && (hasArrow || isQuestion) && (hasClickableUi || el.closest('[class*="suggestion" i], [class*="recommend" i]'))) {
    return true;
  }
  
  // If it's a short item with clickable UI, likely a suggestion
  return isSuggestionContainer || (isShortText && hasClickableUi);
}

function collectMessageElements(): Element[] {
  const main = document.querySelector('main');
  const root = main || document;

  let candidates: Element[] = [];

  // Strategy 1: structured data attributes (best case)
  // We scope to main to avoid sidebar hits
  const byDataAttr = Array.from(
    root.querySelectorAll<Element>('[data-message-author-role], [data-role="user"], [data-role="assistant"]'),
  ).filter(el => !el.closest('nav')); // Extra safety against sidebar

  if (byDataAttr.length > 0) {
    candidates = byDataAttr;
  } else {
    // Strategy 2a: data-testid containing "message"
    const byTestId = Array.from(
      root.querySelectorAll<Element>('[data-testid*="message" i]'),
    ).filter(el => !el.closest('nav'));
    
    if (byTestId.length > 0) {
      candidates = byTestId;
    } else {
      // Strategy 2b: direct children of a list/feed ARIA container
      const listContainer = root.querySelector<Element>('[role="list"], [role="feed"]');
      if (listContainer && !listContainer.closest('nav')) {
        candidates = Array.from(listContainer.children);
      } else {
        // Strategy 2c: direct children of a semantic conversation container.
        const conversationSelectors = [
          '[data-testid="flow_chat_guidance_page"]',
          '[class*="chat-scroll" i]',
          '[class*="chatScroll" i]',
          '[class*="conversation" i]',
          '[class*="thread" i]',
          '[class*="message-list" i]',
          '[class*="messageList" i]',
        ];
        for (const sel of conversationSelectors) {
          const containers = Array.from(root.querySelectorAll<Element>(sel)).filter(el => !el.closest('nav'));
          for (const container of containers) {
            candidates = Array.from(container.children);
            if (candidates.length > 0) break;
          }
          if (candidates.length > 0) break;
        }
      }
    }
  }

  // Last-resort Strategy 3: article/listitem
  if (candidates.length === 0) {
    root.querySelectorAll('article, [role="listitem"]').forEach((el) => {
      if (!el.closest('nav')) candidates.push(el);
    });
  }

  // FILTER OUT suggestion chips and UI noise from final candidates
  return candidates.filter(el => !isSuggestion(el));
}
/**
 * Try to detect the logged-in user's display name from the Doubao page DOM.
 */
function detectDoubaoUsername(): string | null {
  // Try 0: Doubao confirmed DOM structure (2026-02):
  // Avatar img has data-testid="chat_header_avatar_button",
  // the username text is in the immediately following sibling div.
  const avatarBtn = document.querySelector<HTMLImageElement>(
    '[data-testid="chat_header_avatar_button"]',
  );
  if (avatarBtn) {
    const sibling = avatarBtn.nextElementSibling;
    const name = sibling?.textContent?.trim();
    if (name && name.length > 0 && name.length < 60) return name;
    // Also try parent's next sibling
    const parentSibling = avatarBtn.parentElement?.nextElementSibling;
    const name2 = parentSibling?.textContent?.trim();
    if (name2 && name2.length > 0 && name2.length < 60) return name2;
  }

  // Try 1: Doubao username div — class contains 'text-dbx-text-primary' next to avatar
  const dbxPrimary = document.querySelector<HTMLElement>('[class*="text-dbx-text-primary"]');
  if (dbxPrimary) {
    const name = dbxPrimary.textContent?.trim();
    if (name && name.length > 0 && name.length < 60 && !/豆包|doubao/i.test(name)) return name;
  }

  // Try 2: data attributes on profile/avatar elements
  const profileSelectors = ['[data-user-name]', '[data-username]', '[data-nickname]'];
  for (const sel of profileSelectors) {
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

  // Try 3: aria-label or title on elements that look like avatar/profile buttons
  const avatarSelectors = [
    '[aria-label*="头像" i]',
    '[aria-label*="profile" i]',
    '[aria-label*="avatar" i]',
    '[title*="头像" i]',
  ];
  for (const sel of avatarSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const label = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? '';
      const match = label.match(/^(.+?)的?头像$/);
      if (match?.[1]) return match[1].trim();
      const clean = label.replace(/头像|profile|avatar/gi, '').trim();
      if (clean.length > 0 && clean.length < 60) return clean;
    }
  }

  // Try 4: img alt text of an avatar image inside a header/nav
  const avatarImgs = document.querySelectorAll<HTMLImageElement>(
    'header img[alt], nav img[alt], [class*="avatar" i] img[alt], [class*="header" i] img[alt]',
  );
  for (const img of avatarImgs) {
    const alt = img.alt?.trim();
    if (alt && alt.length > 0 && alt.length < 60 && !/logo|icon|doubao/i.test(alt)) {
      return alt;
    }
  }

  // Try 5: text content of a profile name span/div in a nav or header
  const nameSelectors = [
    'header [class*="username" i]',
    'header [class*="nickname" i]',
    'nav [class*="username" i]',
    'nav [class*="nickname" i]',
    '[class*="user-name" i]',
    '[class*="userName" i]',
  ];
  for (const sel of nameSelectors) {
    const el = document.querySelector(sel);
    const text = el?.textContent?.trim();
    if (text && text.length > 0 && text.length < 60) return text;
  }
  return null;
}

/**
 * List all conversations from the Doubao sidebar.
 *
 * Doubao conversation IDs are pure digits (/chat/3366766533906).
 * Non-conversation links (/ai-create/, /drive/, etc.) have non-numeric paths
 * and are filtered out by the \d+ regex below.
 */
function listDoubaoConversations(): ConversationSummary[] {
  const results: ConversationSummary[] = [];
  const seen = new Set<string>();

  // Strategy 1: anchor tags pointing to /chat/{numeric-id}
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/chat/"]'));
  for (const link of links) {
    try {
      const href = link.href;
      const url = new URL(href);
      if (url.hostname !== 'www.doubao.com') continue;
      // Only match numeric IDs — filters out AI-create, Cloud Drive, etc.
      const pathMatch = url.pathname.match(/^\/chat\/(\d+)/);
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

  // Strategy 2: clickable sidebar items without direct anchors
  if (results.length === 0) {
    const sidebarSelectors = [
      '[class*="sidebar" i] [class*="item" i]',
      '[class*="history" i] [class*="item" i]',
      '[class*="chat-list" i] > *',
      'nav [class*="item" i]',
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
            const match = new URL(href).pathname.match(/\/chat\/(\d+)/);
            id = match?.[1] ?? '';
          } catch { /* ignore */ }
        }
        // Skip items without a valid numeric chat ID (not a conversation)
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

export const doubaoAdapter: SiteAdapter = {
  id: 'doubao',
  label: 'Doubao',
  matches(url: URL) {
    return url.hostname === 'www.doubao.com' && url.pathname.startsWith('/chat/');
  },

  detectUsername(): string | null {
    return detectDoubaoUsername();
  },

  listConversations(): ConversationSummary[] {
    return listDoubaoConversations();
  },

  async extract(): Promise<ExtractResult> {
    // Hide input area before extraction to prevent UI noise in exports
    hideInputArea();
    
    const els = collectMessageElements();
    const turns: ChatTurn[] = buildTurnsFromMessageElements(els);


    if (turns.length < 2) {
      return {
        ok: false,
        reason: '未能识别到足够的消息节点（可能是页面结构更新或未加载完）。',
        debug: { counts: summarizeDebugCounts(), url: location.href, foundElements: els.length },
      };
    }

    const conversation: Conversation = {
      title: pickTitle(),
      url: location.href,
      platform: 'doubao',
      exportedAt: new Date().toISOString(),
      turns,
    };

    return { ok: true, conversation, turns };
  },
};
