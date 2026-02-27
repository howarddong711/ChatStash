import DOMPurify from 'dompurify';
import markedKatex from 'marked-katex-extension';
import { marked } from 'marked';

import { downloadTextFile, safeFilename } from '@/shared/download';
import { deleteExportBundle, getExportBundle } from '@/shared/sessionStore';
import type { ExportBundle } from '@/shared/types';

// Configure marked with KaTeX extension for math rendering in fallback mode
marked.use(markedKatex({ throwOnError: false }));

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: ${id}`);
  return el;
}

function showError(message: string): void {
  const el = byId('error');
  el.style.display = 'block';
  el.textContent = message;
}

function getKeyFromHash(): string | null {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  const key = decodeURIComponent(raw || '').trim();
  return key || null;
}

async function main(): Promise<void> {
  const key = getKeyFromHash();
  if (!key) {
    showError('缺少导出 key（请从 ChatStash 扩展内打开此页面）。');
    return;
  }

  const bundle = await getExportBundle<ExportBundle>(key);
  if (!bundle) {
    showError('导出内容已过期或不存在（请返回页面重新导出）。');
    return;
  }

  // Best-effort cleanup (don't block rendering)
  void deleteExportBundle(key);

  const { conversation, markdown } = bundle;
  const title = conversation.title || 'Chat';
  const filenameBase = safeFilename(title) || 'chat';

  byId('title').textContent = title;
  byId('meta').textContent = `${conversation.platform} · ${conversation.exportedAt} · ${conversation.url}`;

  // Prefer pre-rendered HTML from the original page (high-fidelity).
  // Falls back to Markdown → marked + KaTeX rendering.
  if (bundle.html) {
    const safe = DOMPurify.sanitize(bundle.html, {
      USE_PROFILES: { html: true },
      ADD_TAGS: ['math', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'mover', 'munder',
                 'munderover', 'msqrt', 'mroot', 'mtable', 'mtr', 'mtd', 'mtext', 'mspace',
                 'annotation', 'semantics'],
      ADD_ATTR: ['xmlns', 'encoding', 'mathvariant', 'displaystyle', 'scriptlevel',
                 'columnalign', 'rowalign', 'columnspacing', 'rowspacing', 'fence', 'stretchy',
                 'separator', 'accent', 'accentunder', 'lspace', 'rspace', 'linethickness',
                 'minsize', 'maxsize', 'movablelimits', 'symmetric'],
    });
    byId('render').innerHTML = safe;
  } else {
    const html = marked.parse(markdown, { breaks: true, gfm: true }) as string;
    const safe = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    byId('render').innerHTML = safe;
  }

  byId('printBtn').addEventListener('click', () => window.print());
  byId('dlMdBtn').addEventListener('click', () => {
    downloadTextFile(`${filenameBase}.md`, markdown, 'text/markdown;charset=utf-8');
  });
  byId('dlJsonBtn').addEventListener('click', () => {
    downloadTextFile(
      `${filenameBase}.json`,
      JSON.stringify(conversation, null, 2) + '\n',
      'application/json;charset=utf-8',
    );
  });

  // Auto-trigger print dialog after a short delay to let the browser render
  setTimeout(() => window.print(), 800);
}

void main().catch((e) => showError(e instanceof Error ? e.message : String(e)));
