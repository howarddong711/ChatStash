import type { ChatTurn, Conversation, ConversationSummary } from '@/shared/types';

import {
  buildTurnsFromMessageElements,
  elementToMarkdown,
  summarizeDebugCounts,
} from './heuristics';
import type { ExtractResult, SiteAdapter } from './types';

const GLM_HOSTS = new Set(['chatglm.cn']);
const GLM_CID_REGEX = /\b[a-f0-9]{24}\b/i;
const GLM_SIDEBAR_NOISE_REGEX =
  /^(?:新对话|最近对话|历史记录|全部工具|全部智能体|学习搭子|AI画图|AI阅读|AI生视频|云知识库|下载手机应用|GLM-Claw|Beta|搜索|升级)$/u;
const GLM_GENERIC_TITLE_REGEX = /^(?:智谱清言|chatglm)$/i;
const GLM_UI_NOISE_REGEX =
  /^(?:复制|分享|重新生成|继续追问|赞|踩|点赞|点踩|收藏|展开|收起|Agent|思考|联网|和我聊聊天吧|AI编辑|收藏至知识库|下载手机应用)$/u;
const GLM_PROMO_LINE_REGEX =
  /^(?:GLM-5|旧时光旅客|定时任务|分享链接|下载名片|扫描二维码，体验智能体|升级|AI阅读|复制入框)$/u;
const GLM_FOOTER_START_REGEX =
  /^(?:以上内容(?:均由AI生成|为\s*AI\s*生成)|2026\s+ChatGLM5|用户协议|隐私政策|开源模型|请勿删除或修改本标记)/u;
const GLM_USERNAME_LINE_REGEX = /^(?:用户[_\\-]?[A-Za-z0-9]+|user[_\\-]?[A-Za-z0-9]+)$/i;
const GLM_TOOLBAR_LINE_REGEX = /^(?:ChatGLM.*语音|语音|梦幻杰)$/u;
const GLM_PAGE_COUNTER_REGEX = /^\d+\/\d+$/;
const GLM_BRAND_NOISE_REGEX = /^(?:来自[:：]\s*智谱清言|来自[:：]\s*chatglm|智谱清言|chatglm|言)$/iu;
const GLM_EMPTY_STATE_MARKERS = [
  '最新旗舰模型上线',
  '和我聊聊天吧',
  '研究模式',
  'PPT模式',
  '数据分析',
  '更多',
  '新对话',
  'Agent',
] as const;

function isGlmConversationUrl(url: URL): boolean {
  return GLM_HOSTS.has(url.hostname) && /^\/main\/alltoolsdetail\/?$/i.test(url.pathname);
}

function normalizeTitle(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeText(text: string): string {
  return text.replace(/\r/g, '').replace(/\u00a0/g, ' ').replace(/\s+\n/g, '\n').trim();
}

function countGlmEmptyStateMarkers(text: string): number {
  const normalized = normalizeTitle(text);
  if (!normalized) return 0;

  let count = 0;
  for (const marker of GLM_EMPTY_STATE_MARKERS) {
    if (normalized.includes(marker)) count++;
  }
  return count;
}

function isGlmEmptyStateText(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  return countGlmEmptyStateMarkers(normalized) >= 3;
}

function isGlmGarbageText(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return true;
  if (isGlmEmptyStateText(normalized)) return true;
  if (GLM_BRAND_NOISE_REGEX.test(normalized)) return true;
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildGlmConversationUrl(cid: string): string {
  const url = new URL(location.origin);
  url.pathname = '/main/alltoolsdetail';
  url.searchParams.set('cid', cid);

  const lang = new URL(location.href).searchParams.get('lang')?.trim();
  if (lang) url.searchParams.set('lang', lang);

  return url.toString();
}

function buildGlmTitleUrl(title: string): string {
  const url = new URL(location.origin);
  url.pathname = '/main/alltoolsdetail';
  url.searchParams.set('chatstash_title', title);

  const lang = new URL(location.href).searchParams.get('lang')?.trim();
  if (lang) url.searchParams.set('lang', lang);

  return url.toString();
}

function extractGlmConversationId(input: string | URL): string | null {
  try {
    const url = typeof input === 'string' ? new URL(input, location.origin) : input;
    const cid = url.searchParams.get('cid')?.trim();
    if (cid) return cid;
  } catch {
    return null;
  }

  return null;
}

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function extractHistoryItemTitle(item: ParentNode): string {
  const titleEl = item.querySelector<HTMLElement>('.title');
  return normalizeTitle(titleEl?.innerText || titleEl?.textContent || '');
}

function isUsableSidebarTitle(text: string): boolean {
  if (!text || text.length < 2 || text.length > 120) return false;
  if (GLM_SIDEBAR_NOISE_REGEX.test(text)) return false;
  if (/^(?:新建对话|历史记录|全部工具|全部智能体|查看更多|收起|展开|搜索|搜索历史)$/u.test(text)) {
    return false;
  }
  return true;
}

function extractCidFromElement(el: Element): string | null {
  const dataKeys = [
    'cid',
    'conversationId',
    'conversationid',
    'sessionId',
    'sessionid',
    'chatId',
    'chatid',
    'id',
    'key',
    'rowKey',
    'rowkey',
  ];

  for (const key of dataKeys) {
    const dataValue =
      el.getAttribute(`data-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`) ??
      (el instanceof HTMLElement ? el.dataset[key as keyof DOMStringMap] : undefined);
    const match = String(dataValue ?? '').match(GLM_CID_REGEX);
    if (match?.[0]) return match[0];
  }

  for (const attr of Array.from(el.attributes)) {
    const match = attr.value.match(GLM_CID_REGEX);
    if (match?.[0]) return match[0];
  }

  return null;
}

function listGlmConversationsFromHistoryList(): ConversationSummary[] {
  const results: ConversationSummary[] = [];
  const seen = new Set<string>();
  const items = Array.from(
    document.querySelectorAll<HTMLElement>('#aside-history-list .list .history-item'),
  );

  for (const item of items) {
    if (!isVisible(item)) continue;

    const title = extractHistoryItemTitle(item);
    if (!isUsableSidebarTitle(title)) continue;

    const cid = extractCidFromElement(item);
    const id = cid ? `cid:${cid}` : `title:${title}`;
    if (seen.has(id)) continue;
    seen.add(id);

    results.push({
      id,
      title: title.slice(0, 200),
      url: cid ? buildGlmConversationUrl(cid) : buildGlmTitleUrl(title),
    });
  }

  return results;
}

function pickTitle(): string {
  const selectedSidebarTitle = normalizeTitle(
    document.querySelector<HTMLElement>('#aside-history-list .history-item.selected .title')
      ?.innerText ||
      document.querySelector<HTMLElement>('#aside-history-list .history-item.selected .title')
        ?.textContent ||
      '',
  );
  if (isUsableSidebarTitle(selectedSidebarTitle)) return selectedSidebarTitle;

  const title = normalizeTitle(document.title || '');
  if (title && !GLM_GENERIC_TITLE_REGEX.test(title)) return title;

  return '智谱清言';
}

function notSidebarNoise(el: Element): boolean {
  return !el.closest('nav, aside, footer, #chatstash-root, #aside-history-list');
}

function isGlmUiNoiseText(text: string): boolean {
  const normalized = normalizeTitle(text);
  if (!normalized) return true;
  if (/^\d+\/\d+$/.test(normalized)) return true;
  if (GLM_UI_NOISE_REGEX.test(normalized)) return true;
  if (/^(?:Copy|Share|Regenerate|Retry)$/i.test(normalized)) return true;
  return false;
}

function isLikelyMessageNode(el: Element): boolean {
  const text = el.textContent?.trim() ?? '';
  if (isGlmUiNoiseText(text)) return false;
  if (el.matches('button, input, textarea, label')) return false;

  const className = el instanceof HTMLElement ? el.className : '';
  const classText = typeof className === 'string' ? className : '';
  if (/(toolbar|action|footer|header|input|editor|sidebar|menu|drawer|tool)/i.test(classText)) {
    return false;
  }

  return text.length > 0 || el.querySelector('img, pre, code, table, .katex, mjx-container') !== null;
}

function sampleElementTexts(elements: Element[], limit = 5): string[] {
  return elements
    .slice(0, limit)
    .map((el) => normalizeTitle(el.textContent || ''))
    .filter(Boolean)
    .map((text) => text.slice(0, 120));
}

async function listGlmConversationsFromDom(): Promise<ConversationSummary[]> {
  const immediate = listGlmConversationsFromHistoryList();
  if (immediate.length > 0) return immediate;

  await delay(250);
  const delayed = listGlmConversationsFromHistoryList();
  if (delayed.length > 0) return delayed;

  const currentCid = extractGlmConversationId(location.href);
  if (currentCid) {
    return [
      {
        id: `cid:${currentCid}`,
        title: pickTitle(),
        url: buildGlmConversationUrl(currentCid),
      },
    ];
  }

  return [];
}

function collectMessageElements(): Element[] {
  const root = document.querySelector('main') || document;

  const structured = Array.from(
    root.querySelectorAll<Element>(
      '[data-message-author-role], [data-role="user"], [data-role="assistant"]',
    ),
  ).filter(notSidebarNoise);
  if (structured.length > 0) return structured;

  const directSelectors = [
    '[data-testid*="message" i]',
    '[class*="message-item" i]',
    '[class*="MessageItem" i]',
    '[class*="message" i]',
    '[class*="conversation-item" i]',
    '[class*="ConversationItem" i]',
    '[class*="chat-item" i]',
    '[class*="ChatItem" i]',
    '[class*="assistant" i]',
    '[class*="user" i]',
    '[class*="question" i]',
    '[class*="answer" i]',
    '[class*="bubble" i]',
    '[class*="markdown" i]',
    'article',
    '[role="listitem"]',
  ];

  for (const selector of directSelectors) {
    const wrappers = new Set<Element>();
    const matches = Array.from(root.querySelectorAll<Element>(selector)).filter(
      (el) => notSidebarNoise(el) && isLikelyMessageNode(el),
    );

    for (const match of matches) {
      const wrapper =
        match.closest(
          '[data-testid*="message" i], [class*="message-item" i], [class*="MessageItem" i], [class*="message" i], [class*="conversation-item" i], [class*="ConversationItem" i], [class*="chat-item" i], [class*="ChatItem" i], [class*="assistant" i], [class*="user" i], [class*="question" i], [class*="answer" i], [class*="bubble" i], article, [role="listitem"]',
        ) || match;

      if (notSidebarNoise(wrapper) && isLikelyMessageNode(wrapper)) {
        wrappers.add(wrapper);
      }
    }

    const candidates = Array.from(wrappers);
    if (candidates.length >= 2) return candidates;
  }

  const containerSelectors = [
    'main',
    '[role="feed"]',
    '[role="list"]',
    '[class*="conversation" i]',
    '[class*="message-list" i]',
    '[class*="chat-content" i]',
    '[class*="scroll" i]',
    '[class*="markdown-body" i]',
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

  return Array.from(root.querySelectorAll('[role="listitem"], article')).filter(notSidebarNoise);
}

function isReadableGlmBlock(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (!notSidebarNoise(el)) return false;
  if (el.matches('button, a, nav, aside, footer, form, textarea, input')) return false;
  if (el.closest('button, a, nav, aside, footer, form, textarea, input, [contenteditable="true"]')) {
    return false;
  }

  const rect = el.getBoundingClientRect();
  if (rect.width < 240 || rect.height < 28) return false;

  const classText = typeof el.className === 'string' ? el.className : '';
  if (
    /(toolbar|action|footer|header|input|editor|sidebar|menu|drawer|tool|suggest|recommend|operate|option|search|subject|history|aside)/i.test(
      classText,
    )
  ) {
    return false;
  }

  const text = normalizeText(el.innerText || el.textContent || '');
  if (text.length < 20) return false;
  if (isGlmUiNoiseText(text)) return false;
  if (GLM_SIDEBAR_NOISE_REGEX.test(text)) return false;

  return true;
}

function cleanGlmBlockMarkdown(md: string): string {
  if (!md) return '';

  const lines = md.split('\n');
  const cleaned: string[] = [];
  let started = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (started) cleaned.push(rawLine);
      continue;
    }
    if (GLM_FOOTER_START_REGEX.test(line)) break;
    if (
      GLM_PROMO_LINE_REGEX.test(line) ||
      GLM_USERNAME_LINE_REGEX.test(line) ||
      GLM_TOOLBAR_LINE_REGEX.test(line) ||
      /data:image\//i.test(line) ||
      /https?:\/\/sfile\.chatglm\.cn\/activeimg\//i.test(line)
    ) {
      continue;
    }
    started = true;
    cleaned.push(rawLine);
  }

  return cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function cleanGlmBlockText(text: string): string {
  if (!text) return '';

  const lines = text.split('\n');
  const cleaned: string[] = [];
  let started = false;

  for (const rawLine of lines) {
    const line = normalizeTitle(rawLine);
    if (!line) {
      if (started) cleaned.push('');
      continue;
    }
    if (GLM_FOOTER_START_REGEX.test(line)) break;
    if (
      GLM_PROMO_LINE_REGEX.test(line) ||
      GLM_USERNAME_LINE_REGEX.test(line) ||
      GLM_TOOLBAR_LINE_REGEX.test(line) ||
      /data:image\//i.test(line) ||
      /sfile\.chatglm\.cn\/activeimg\//i.test(line)
    ) {
      continue;
    }
    started = true;
    cleaned.push(rawLine);
  }

  return cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function cleanGlmTurnContent(content: string, role: 'user' | 'assistant'): string {
  if (!content) return '';
  if (isGlmGarbageText(content)) return '';

  const lines = content.split('\n');
  const cleaned: string[] = [];
  let started = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const normalized = normalizeTitle(rawLine);

    if (!normalized) {
      if (started) cleaned.push('');
      continue;
    }

    if (GLM_FOOTER_START_REGEX.test(normalized)) break;

    const isNoiseLine =
      GLM_PROMO_LINE_REGEX.test(normalized) ||
      GLM_USERNAME_LINE_REGEX.test(normalized) ||
      GLM_TOOLBAR_LINE_REGEX.test(normalized) ||
      GLM_PAGE_COUNTER_REGEX.test(normalized) ||
      /复制入框/u.test(normalized) ||
      /data:image\//i.test(line) ||
      /sfile\.chatglm\.cn\/activeimg\//i.test(line);

    if (isNoiseLine) continue;

    // Drop leading image-only lines before正文开始. For assistant turns, drop all markdown-only image lines.
    if (/^!\[\]\(https?:\/\/[^)]+\)$/i.test(line)) {
      if (!started || role === 'assistant') continue;
    }

    started = true;
    cleaned.push(rawLine);
  }

  const result = cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return isGlmGarbageText(result) ? '' : result;
}

function sanitizeExtractedTurns(turns: ChatTurn[]): ChatTurn[] {
  return turns
    .map((turn) => {
      const role = turn.role === 'assistant' ? 'assistant' : 'user';
      const contentMd = cleanGlmTurnContent(turn.contentMd || '', role);
      const contentText = cleanGlmTurnContent(turn.contentText || turn.contentMd || '', role);
      const cleanedHtml = turn.contentHtml || '';

      return {
        ...turn,
        contentMd: contentMd || contentText,
        contentText: contentText || contentMd,
        contentHtml: cleanedHtml,
      };
    })
    .filter((turn) => {
      const content = normalizeText(turn.contentMd || turn.contentText || '');
      if (!content) return false;
      return !isGlmGarbageText(content);
    });
}

function looksLikeUserPrompt(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (/[？?]$/.test(normalized)) return true;
  if (/^(?:帮我|请|解释|介绍|总结|分析|如何|为什么|什么是|给我|写一篇|写一个)/u.test(normalized)) {
    return true;
  }
  return normalized.length > 40 && /[？?]/.test(normalized);
}

function collectReadableGlmBlocks(): Element[] {
  const root = document.querySelector('main') || document.body || document.documentElement;
  if (!root) return [];

  const raw = Array.from(root.querySelectorAll<Element>('article, section, div')).filter(
    isReadableGlmBlock,
  );

  const deduped: Element[] = [];
  const seen = new Set<string>();
  for (const el of raw) {
    const text = normalizeText(el.textContent || '');
    const sig = text.slice(0, 240);
    if (!sig || seen.has(sig)) continue;
    seen.add(sig);
    deduped.push(el);
  }

  const leafish = deduped.filter((el) => {
    const ownLen = normalizeText(el.textContent || '').length;
    return !deduped.some((other) => {
      if (other === el) return false;
      if (!el.contains(other)) return false;
      const childLen = normalizeText(other.textContent || '').length;
      return childLen >= Math.min(Math.floor(ownLen * 0.55), Math.max(40, ownLen - 30));
    });
  });

  return leafish.sort((a, b) => {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    return ar.top - br.top || ar.left - br.left;
  });
}

function hasUsefulTurns(turns: ChatTurn[]): boolean {
  const contents = turns
    .map((turn) => normalizeText(turn.contentMd || turn.contentText || ''))
    .filter(Boolean);
  if (contents.length < 2) return false;

  const totalChars = contents.reduce((sum, text) => sum + text.length, 0);
  const assistantMax = turns
    .filter((turn) => turn.role === 'assistant')
    .reduce((max, turn) => {
      const len = normalizeText(turn.contentMd || turn.contentText || '').length;
      return Math.max(max, len);
    }, 0);

  return totalChars >= 80 && assistantMax >= 30;
}

function buildFallbackTurns(): ChatTurn[] {
  const readableBlocks = collectReadableGlmBlocks();
  const blocks: Array<{ md: string; text: string; html: string }> = [];
  const seen = new Set<string>();

  for (const block of readableBlocks) {
    const converted = elementToMarkdown(block);
    const md = cleanGlmBlockMarkdown(converted.md || converted.text || '');
    const text = cleanGlmBlockText(converted.text || converted.md || '');
    if ((text || md).length < 20) continue;
    if (isGlmEmptyStateText(text || md)) continue;
    if (isGlmUiNoiseText(text || md)) continue;

    const sig = normalizeText(text || md).slice(0, 240);
    if (!sig || seen.has(sig)) continue;
    seen.add(sig);

    blocks.push({
      md,
      text,
      html: converted.html || '',
    });
  }

  if (blocks.length === 0) return [];

  let userBlock: { md: string; text: string; html: string } | null = null;
  let assistantBlocks = blocks;

  if (blocks.length >= 2 && looksLikeUserPrompt(blocks[0].text)) {
    userBlock = blocks[0];
    assistantBlocks = blocks.slice(1);
  }

  const assistantMd = assistantBlocks
    .map((block) => block.md || block.text)
    .filter(Boolean)
    .join('\n\n')
    .trim();
  const assistantText = assistantBlocks
    .map((block) => block.text || block.md)
    .filter(Boolean)
    .join('\n\n')
    .trim();

  const turns: ChatTurn[] = [];

  if (userBlock && (userBlock.md || userBlock.text)) {
    turns.push({
      role: 'user',
      contentMd: userBlock.md || userBlock.text,
      contentText: userBlock.text || userBlock.md,
      contentHtml: userBlock.html,
    });
  }

  if (assistantMd || assistantText) {
    turns.push({
      role: 'assistant',
      contentMd: assistantMd || assistantText,
      contentText: assistantText || assistantMd,
      contentHtml: assistantBlocks.map((block) => block.html).filter(Boolean).join('\n'),
    });
  }

  return turns;
}

export const glmAdapter: SiteAdapter = {
  id: 'glm',
  label: '智谱清言',
  matches(url: URL) {
    return isGlmConversationUrl(url);
  },

  detectUsername(): string | null {
    return null;
  },

  async listConversations(): Promise<ConversationSummary[]> {
    return listGlmConversationsFromDom();
  },

  async extract(): Promise<ExtractResult> {
    const els = collectMessageElements();
    let turns: ChatTurn[] = sanitizeExtractedTurns(buildTurnsFromMessageElements(els));

    if (!hasUsefulTurns(turns)) {
      const fallbackTurns = sanitizeExtractedTurns(buildFallbackTurns());
      if (fallbackTurns.length > 0) turns = fallbackTurns;
    }

    if (!hasUsefulTurns(turns)) {
      return {
        ok: false,
        reason: '未能识别到足够的有效会话内容（可能是页面结构更新、未进入具体会话，或内容尚未加载完成）。',
        debug: {
          counts: summarizeDebugCounts(),
          url: location.href,
          foundElements: els.length,
          samples: sampleElementTexts(els),
          fallbackBlocks: sampleElementTexts(collectReadableGlmBlocks()),
        },
      };
    }

    const conversation: Conversation = {
      title: pickTitle(),
      url: location.href,
      platform: 'glm',
      exportedAt: new Date().toISOString(),
      turns,
    };

    return { ok: true, conversation, turns };
  },
};
