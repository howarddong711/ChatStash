import TurndownService from 'turndown';

import type { ChatRole, ChatTurn } from '@/shared/types';

const turndown = new TurndownService({
  codeBlockStyle: 'fenced',
  headingStyle: 'atx',
  bulletListMarker: '-',
});

// LaTeX math support rule for Turndown
function isDisplayMode(el: Element): boolean {
  if (el.getAttribute('display') === 'true') return true;
  if (el.classList.contains('katex-display')) return true;
  if (el.classList.contains('math-block')) return true;
  if (el.classList.contains('math-display')) return true;
  
  // Check parent structure for explicit display signals
  const parent = el.closest('.math-block, .katex-display, .math-display, [display="true"]');
  return !!parent;
}

function cleanMathText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\u200B/g, '') // remove zero-width spaces
    .replace(/\uE020\s*=/g, '\\neq ') // U+E020 = -> \neq =
    .replace(/\uE020/g, '\\not ') // U+E020 -> \not 
    .replace(/\u2260/g, '\\neq ') // ≠
    .replace(/\u2212/g, '-') // minus
    .replace(/\u2215/g, '/') // division slash
    .replace(/\u22c5/g, '\\cdot ')
    .replace(/\u2098/g, '_n')
    .replace(/\u2081/g, '_1')
    .replace(/\u2082/g, '_2')
    .replace(/\u2083/g, '_3')
    .replace(/\u2084/g, '_4')
    .replace(/\u2085/g, '_5')
    .replace(/\u2086/g, '_6')
    .replace(/\u2087/g, '_7')
    .replace(/\u2088/g, '_8')
    .replace(/\u2089/g, '_9')
    .replace(/\u2080/g, '_0')
    .replace(/\u00A0/g, ' ')
    .trim();
}

// LaTeX math support rule for Turndown
turndown.addRule('katex', {
  filter: (node) => {
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    
    // Check for math container classes and attributes
    if ((tag === 'span' || tag === 'div' || tag === 'mjx-container') && (
      el.classList.contains('katex') || 
      el.classList.contains('math') ||
      el.classList.contains('math-inline') ||
      el.classList.contains('math-block') ||
      el.classList.contains('katex-display') ||
      el.hasAttribute('data-latex') ||
      el.hasAttribute('data-tex') ||
      el.hasAttribute('data-raw-tex') ||
      el.hasAttribute('mjx-tex') ||
      tag === 'mjx-container'
    )) {
      // IMPORTANT: Only match if the element actually has extractable formula content
      const hasContent = 
        el.hasAttribute('data-latex') ||
        el.hasAttribute('data-tex') ||
        el.hasAttribute('data-raw-tex') ||
        el.hasAttribute('mjx-tex') ||
        el.getAttribute('alttext') !== null ||
        el.getAttribute('data-formula') !== null ||
        el.querySelector('annotation') !== null ||
        el.querySelector('script[type*="math"]') !== null ||
        el.querySelector('math') !== null ||
        el.querySelector('[data-latex], [data-tex], [data-raw-tex], [mjx-tex]') !== null ||
        ((el as HTMLElement).innerText?.trim().length ?? 0) > 0;
      
      return hasContent;
    }
    
    // Also match annotation elements inside math containers
    if (tag === 'annotation' && 
        (el.getAttribute('encoding') === 'application/x-tex' ||
         el.closest('[class*="math" i], .katex, mjx-container, [data-latex]'))) {
      return true;
    }
    
    return false;
  },
  replacement: (_content, node) => {
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    
    // 1. Helper: find latex in attributes recursively
    const findLatexAttrRecursive = (e: Element): string | null => {
      const attr = e.getAttribute('data-latex') || 
                   e.getAttribute('data-tex') || 
                   e.getAttribute('data-raw-tex') ||
                   e.getAttribute('mjx-tex') ||
                   e.getAttribute('alttext') ||
                   null;
      if (attr) return attr;
      
      const child = e.querySelector('[data-latex], [data-tex], [data-raw-tex], [mjx-tex]');
      if (child) return findLatexAttrRecursive(child);
      
      return null;
    };

    let latex = findLatexAttrRecursive(el);

    // 2. If it's an annotation element, the content IS the latex source
    if (!latex && tag === 'annotation') {
      latex = el.textContent?.trim() || null;
    }

    // 3. KaTeX annotation element (standard method)
    if (!latex) {
      const annotation = el.querySelector('annotation[encoding="application/x-tex"], annotation');
      if (annotation) latex = annotation.textContent?.trim() || null;
    }
    
    // 4. MathML alttext or data-latex attribute
    if (!latex) {
      const mathml = el.querySelector('math');
      if (mathml) latex = mathml.getAttribute('alttext') || mathml.getAttribute('data-latex');
    }

    // 5. Check for script tags with LaTeX source
    if (!latex) {
      const scriptTex = el.querySelector('script[type="math/tex"], script[type="math/tex; mode=display"]');
      if (scriptTex) latex = scriptTex.textContent?.trim();
    }

    if (latex) {
      const isDisplay = isDisplayMode(el);
      // Clean up potential escaping/double backslashes from attributes
      const cleanLatex = latex.replace(/\\\\/g, '\\');
      return isDisplay ? `\n\n$$${cleanLatex}$$\n\n` : `$${cleanLatex}$`;
    }
    
    // 8. LAST RESORT: text content (always wrap if it's a known math container)
    const rawText = (el as HTMLElement).innerText || el.textContent || '';
    if (!rawText || rawText.length === 0) return '';
    
    const trimmed = cleanMathText(rawText);
    if (!trimmed) return '';

    // Avoid double-wrapping
    if (trimmed.startsWith('$') && trimmed.endsWith('$')) return trimmed;

    const isDisplay = isDisplayMode(el);
    // If we are in a known math container (katex, mjx-container, etc.), ALWAYS wrap
    if (el.classList.contains('katex') || 
        el.classList.contains('math') || 
        tag === 'mjx-container' || 
        el.hasAttribute('data-latex')) {
      return isDisplay ? `\n\n$$${trimmed}$$\n\n` : `$${trimmed}$`;
    }

    // Otherwise, only wrap in delimiters if it contains common math symbols
    if (/[\^_\{\}\\\(\)\[\]\|\*\+\-\/]/.test(trimmed) && trimmed.length < 1000) {
      return isDisplay ? `\n\n$$${trimmed}$$\n\n` : `$${trimmed}$`;
    }
    
    return '';
  },
});


const THOUGHT_REGEX = /^(Thought(?:ing)?|Thinking)\s+for\s+\d+(?:\.\d+)?\s*seconds\.?|思考(?:了|中)?\s*\d+(?:\.\d+)?\s*秒[。\.!！]?$/i;
const OCR_HINT_REGEX = /^(当前模型仅对图片中的文字进行识别|切换\s*K1\.5\s*获取更好的视觉理解能力)/iu;

const KNOWN_LANGS = new Set([
  'bash', 'sh', 'shell', 'zsh', 'pwsh', 'powershell', 'ps1', 'cmd', 'bat',
  'python', 'py', 'javascript', 'js', 'typescript', 'ts', 'json', 'yaml', 'yml',
  'xml', 'html', 'css', 'sql', 'go', 'java', 'c', 'cpp', 'c++', 'rust', 'rs',
  'plaintext', 'text', 'markdown', 'md', 'dockerfile', 'makefile', 'toml', 'ini',
  'console', 'terminal', 'bashrc', 'zshrc', 'php', 'ruby', 'rb', 'perl', 'pl',
  'kotlin', 'kt', 'swift', 'dart', 'objectivec', 'objc', 'r', 'scala', 'elixir',
  'haskell', 'lua', 'matlab', 'docker-compose', 'powershell', 'terminal',
  'rust', 'rs', 'solidity', 'nix', 'hcl', 'terraform', 'cmake', 'meson',
  'output', 'stderr', 'stdout', 'logs', 'shell-script'
]);

function isCodeLangLabel(s: string): boolean {
  const t = s.trim().toLowerCase().replace(/[:\uFF1A\s]+$/, '').replace(/\s*[\(\[][^)\]]*[\)\]]$/, '');
  const clean = t.replace(/\b(run|copy|运行|复制)\b$/i, '').trim();
  const parts = clean.split(/\s+|[\/\\\-_:]/).filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every(p => KNOWN_LANGS.has(p) || /^[a-z0-9]{1,10}$/.test(p));
}

function normalizeText(text: string): string {
  return text.replace(/\u00A0/g, ' ').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Clone an element and strip all DOM noise before converting to Markdown.
 * This runs in the content-script context (full DOM access).
 */
export function cloneAndClean(el: Element): Element {
  const clone = el.cloneNode(true) as Element;

  // 1. Remove blank SVG placeholder images and decorative SVGs
  clone.querySelectorAll('img[src^="data:image/svg"]').forEach((n) => n.remove());
  clone.querySelectorAll('svg[aria-hidden="true"], .code-toolbar svg, .toolbar svg').forEach((n) => n.remove());

  // 1b. Remove DeepSeek "thinking" / chain-of-thought containers.
  clone.querySelectorAll('.ds-think-content, [class*="think-content" i], [class*="thinking" i], .e1675d8b, .reasoning-content, [class*="reasoning" i]').forEach((n) => n.remove());
  
  // 1c. Remove Doubao-specific UI noise
  clone.querySelectorAll('.chat-feedback, .message-actions, [class*="feedback" i], [class*="action" i]').forEach((n) => n.remove());

  // 1d. Remove Doubao reasoning/thinking blocks specifically
  clone.querySelectorAll('[class*="thought" i], [class*="thinking" i], [class*="reasoning" i]').forEach((n) => {
    const text = n.textContent?.trim() ?? '';
    if (THOUGHT_REGEX.test(text) || /思考(?:中|完毕|了|过程|逻辑)/i.test(text) || /Thought/i.test(text)) {
       n.remove();
    }
  });

  // Fallback: check text content for "Thought for X seconds" if class is obfuscated
  clone.querySelectorAll('span, div, p').forEach((n) => {
    const text = n.textContent?.trim() ?? '';
    if (THOUGHT_REGEX.test(text) || /^(思考中|思考完毕|正在思考|Thinking...)$/.test(text)) {
      const container = n.closest('div[class]') || n;
      container.remove();
    }
  });

  // 2. Remove code-block UI chrome
  clone.querySelectorAll('button').forEach((btn) => {
    // Only remove buttons that look like toolbar buttons or are not inside code content
    if (!btn.closest('code') && !btn.closest('pre')) {
      btn.remove();
    } else if (/copy|run|复制|运行/i.test(btn.innerText || btn.getAttribute('aria-label') || '')) {
      btn.remove();
    }
  });

  // 1c. Clean up KaTeX visual noise but KEEP anything that carries the math source/annotation
  clone.querySelectorAll('.katex-html').forEach((n) => {
    if (
      n.hasAttribute('data-latex') ||
      n.closest('[data-latex], .katex, .math, .math-block, mjx-container') ||
      n.querySelector('annotation[encoding="application/x-tex"], math, [mjx-tex], [data-latex]')
    ) {
      return;
    }
    n.remove();
  });

  // 2. Remove aria-hidden elements (but keep mathml/annotations for Turndown)
  clone.querySelectorAll('[aria-hidden="true"]').forEach((n) => {
    // Keep math related elements as they are needed for extraction
    if (n.closest('.katex, .math, .math-block, [data-latex]')) return;
    n.remove();
  });

  // Remove DeepSeek message feedback (thumbs up/down) and other noise
  clone.querySelectorAll('.ds-message-feedback-container, [class*="feedback" i], .ds-icon-button, [class*="icon-button" i]').forEach((n) => n.remove());

  // 2b. Remove language labels adjacent to code blocks
  clone.querySelectorAll('pre, code').forEach((codeEl) => {
    const parent = codeEl.parentElement;
    if (!parent) return;
    Array.from(parent.children).forEach((sibling) => {
      if (sibling === codeEl) return;
      if (sibling.tagName === 'PRE' || sibling.tagName === 'CODE') return;
      const text = sibling.textContent?.trim() ?? '';
      const lc = text.toLowerCase().replace(/[:\uFF1A\s]+$/, '').trim();
      const isLikelyLang = isCodeLangLabel(lc) || /lang|language|code[-_]?(header|toolbar)|language-label/i.test(sibling.className);
      const hasToolbarBtn = !!sibling.querySelector('button, [data-copy], .copy, .run');
      if (isLikelyLang || hasToolbarBtn || sibling.getAttribute('aria-hidden') === 'true') {
        sibling.remove();
      }
    });
  });

  // Remove {insert_element_N_} placeholder text nodes
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  const placeholderNodes: Node[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (/\{insert_element_\d+_\}/.test(node.textContent ?? '')) {
      placeholderNodes.push(node);
    }
  }
  placeholderNodes.forEach((n) => n.parentNode?.removeChild(n));

  // 3. Remove recommended / follow-up question chips and UI labels.
  clone.querySelectorAll('div, section, ul, li, span, p').forEach((el) => {
    // Safety: never remove math-related nodes in this pass
    if (el.classList.contains('katex') || el.hasAttribute('data-latex') || el.closest('.katex, [data-latex], mjx-container')) return;

    const text = el.textContent?.trim() ?? '';
    if (
      /^(聊聊新话题|再写一个|重新生成|分享|复制|运行|收藏|踩|赞|点赞|点踩|Chat about new topics|Regenerate|Share|Copy|Run|Feedback|Like|Dislike|Stop|停止|清空|重新开始)$/i.test(
        text,
      ) || OCR_HINT_REGEX.test(text)
      || (text.length < 120 && /[?？]\s*(?:→|›)?\s*$/.test(text)) // Catch suggested questions with arrows
    ) {
      el.remove();
      return;
    }
  });

  // Remove containers whose children look like question chips
  clone.querySelectorAll('div, section, ul').forEach((container) => {
    const children = Array.from(container.children);
    if (children.length < 2) return;
    const allLookLikeQuestions = children.every((child) => {
      const text = child.textContent?.trim() ?? '';
      return text.length > 0 && text.length < 120 && (/[？?]\s*(?:→|›)?\s*$/.test(text) || child.querySelector('button, a'));
    });
    if (allLookLikeQuestions) container.remove();
  });
  return clone;
}

/**
 * Post-process Markdown to strip any noise that slipped through DOM cleaning.
 */
function postprocessMarkdown(md: string): string {
  const isNoisyUILabel = (s: string) => /^(运行|复制|copy|run|重新生成|regenerate|share|分享|feedback|stop|停止|清空|重新开始)$/i.test(s.trim());

  const lines = md.split('\n');
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i] ?? '';
    const next = lines[i + 1] ?? '';

    // Drop stray language labels / UI labels immediately before a code fence
    if ((isCodeLangLabel(cur) || isNoisyUILabel(cur)) && next.trim().startsWith('```')) {
      continue;
    }
    // Drop Thought lines
    if (THOUGHT_REGEX.test(cur.trim())) {
      continue;
    }
    if (OCR_HINT_REGEX.test(cur.trim())) {
      continue;
    }

    // Drop placeholder lines
    if (/^\{insert_element_\d+_\}$/.test(cur.trim())) {
      continue;
    }

    out.push(cur);
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function elementToMarkdown(el: Element): { md: string; text: string; html: string } {
  const cleaned = cloneAndClean(el);
  const html = (cleaned as HTMLElement).innerHTML ?? '';
  let md = '';
  try {
    md = turndown.turndown(html);
  } catch {
    md = '';
  }
  const text = normalizeText((cleaned as HTMLElement).innerText ?? cleaned.textContent ?? '');

  const mdRaw = normalizeText(md || '');
  const mdNorm = mdRaw ? postprocessMarkdown(mdRaw) : '';
  return {
    md: mdNorm || text,
    text,
    html,
  };
}

function tokenSet(s: string): Set<string> {
  const parts = s.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) ?? [];
  return new Set(parts);
}

export function guessRoleFromElement(el: Element): ChatRole | null {
  const attrValues = [
    el.getAttribute('data-role'),
    el.getAttribute('data-message-author-role'),
    el.getAttribute('data-author'),
    el.getAttribute('aria-label'),
  ]
    .filter(Boolean)
    .map((v) => String(v));

  const attrTokens = tokenSet(attrValues.join(' '));
  const cls = (el as HTMLElement).className ? String((el as HTMLElement).className) : '';
  const clsTokens = tokenSet(cls);

  const hasAny = (set: Set<string>, candidates: string[]) =>
    candidates.some((t) => set.has(t));

  if (
    hasAny(attrTokens, ['assistant', 'bot', 'ai', '助手', '豆包', 'doubao']) ||
    hasAny(clsTokens, ['assistant', 'bot'])
  ) {
    return 'assistant';
  }

  if (
    hasAny(attrTokens, ['user', 'human', '用户', '我']) ||
    hasAny(clsTokens, ['user'])
  ) {
    return 'user';
  }

  return null;
}

function removeAncestors(elements: Element[]): Element[] {
  return elements.filter((el) => {
    return !elements.some((other) => other !== el && el.contains(other));
  });
}

function normalizeForComparison(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/[.,!?;:，。！？；：]/g, '').trim();
}

export function buildTurnsFromMessageElements(elements: Element[]): ChatTurn[] {
  // Step 1: Drop ancestor wrappers and sort by document position
  const leafElements = removeAncestors(elements).sort((a, b) => {
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });

  const turns: ChatTurn[] = [];
  let lastRole: ChatRole | null = null;
  let prevContentSig = '';

  for (const el of leafElements) {
    let role = guessRoleFromElement(el);
    if (!role) {
      role = lastRole === 'user' ? 'assistant' : 'user';
    }

    let { md, text, html } = elementToMarkdown(el);
    if (!md && !text) continue;

    let contentForSig = normalizeForComparison(text || md);

    // Assistant echo-trimming: strip exact user repetition at start
    if (role === 'assistant' && lastRole === 'user' && prevContentSig) {
      if (contentForSig.startsWith(prevContentSig)) {
        const userNorm = prevContentSig;
        if (normalizeForComparison(text).startsWith(userNorm)) {
          text = text.trim().slice(prevContentSig.length).replace(/^[\s:>-]+/, '').trim();
          md = md.trim().slice(prevContentSig.length).replace(/^[\s:>-]+/, '').trim();
          contentForSig = normalizeForComparison(text || md);
        }
      }
    }

    // Dedupe
    if (contentForSig && contentForSig === prevContentSig) continue;
    prevContentSig = contentForSig;

    turns.push({
      role,
      contentMd: md,
      contentText: text,
      contentHtml: html,
    });
    lastRole = role;
  }

  return turns;
}

export function summarizeDebugCounts(): Record<string, number> {
  const selectors = [
    '[data-role]',
    '[data-message-author-role]',
    'article',
    '[role="listitem"]',
    'div[class*="message" i]',
    'div[class*="chat" i]',
    '.katex',
    'annotation[encoding="application/x-tex"]',
  ] as const;

  const out: Record<string, number> = {};
  for (const s of selectors) out[s] = document.querySelectorAll(s).length;
  return out;
}
