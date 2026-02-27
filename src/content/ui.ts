import type { ConversationSummary } from '@/shared/types';

export type ExportChoice = 'markdown' | 'json' | 'pdf';

export type UIHandlers = {
  /** Called when the user clicks an export button with the selected conversations. */
  onExport(choice: ExportChoice, selected: ConversationSummary[]): void;
  /** Called to load the conversation list from the adapter. */
  onLoadConversations(): ConversationSummary[];
  /** Called when user manually exports debug logs. */
  onExportLogs(): void;
  /** Open extension options page. */
  onOpenSettings(): void;
};

const STYLE_ID = 'chatstash-style';
const ROOT_ID = 'chatstash-root';

function extractChatId(url: string): string {
  try {
    const path = new URL(url).pathname;
    const m = path.match(/\/chat\/(?:s\/)?([^/]+)\/?$/);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

function isCurrentConversation(conv: ConversationSummary): boolean {
  const currentId = extractChatId(location.href);
  const convId = extractChatId(conv.url) || conv.id;
  return !!currentId && !!convId && currentId === convId;
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${ROOT_ID}{position:fixed;right:16px;bottom:16px;z-index:2147483647;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
    .cs-btn{background:#111827;color:#fff;border:0;border-radius:999px;padding:10px 14px;font-size:13px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.2)}
    .cs-btn:hover{background:#0b1220}
    .cs-panel{margin-top:10px;width:320px;background:#fff;color:#111;border:1px solid rgba(0,0,0,.12);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.18);overflow:hidden}
    .cs-panel header{padding:10px 14px;font-weight:600;background:linear-gradient(135deg,#f3f4f6,#fff);display:flex;align-items:center;justify-content:space-between}
    .cs-panel header span{font-size:13px}
    .cs-panel .cs-toolbar{padding:8px 12px;border-bottom:1px solid rgba(0,0,0,.07);display:flex;gap:6px;align-items:center}
    .cs-panel .cs-toolbar button{background:#f3f4f6;border:0;border-radius:6px;padding:4px 9px;font-size:11px;cursor:pointer;color:#374151}
    .cs-panel .cs-toolbar button:hover{background:#e5e7eb}
    .cs-panel .cs-list{max-height:260px;overflow-y:auto;padding:6px 0}
    .cs-panel .cs-list-empty{padding:16px 14px;font-size:12px;color:#6b7280;text-align:center}
    .cs-panel .cs-item{display:flex;align-items:flex-start;gap:8px;padding:7px 14px;cursor:pointer;transition:background .1s}
    .cs-panel .cs-item:hover{background:#f9fafb}
    .cs-panel .cs-item input[type=checkbox]{margin-top:2px;flex-shrink:0;accent-color:#2563eb;width:14px;height:14px;cursor:pointer}
    .cs-panel .cs-item-text{font-size:12px;line-height:1.4;word-break:break-word;flex:1}
    .cs-panel .cs-item-url{font-size:10px;color:#9ca3af;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .cs-panel .cs-footer{padding:10px 12px;border-top:1px solid rgba(0,0,0,.08);display:flex;flex-direction:column;gap:8px}
    .cs-panel .cs-hint{font-size:11px;color:#6b7280;line-height:1.4}
    .cs-panel .cs-row{display:flex;gap:8px}
    .cs-act{flex:1;background:#2563eb;color:#fff;border:0;border-radius:10px;padding:8px 10px;font-size:12px;cursor:pointer}
    .cs-act:hover{background:#1d4ed8}
    .cs-act:disabled{opacity:.45;cursor:not-allowed}
    .cs-act.secondary{background:#111827}
    .cs-act.secondary:hover{background:#0b1220}
    .cs-act.secondary:disabled{opacity:.45;cursor:not-allowed}
    .cs-error{padding:10px 14px;border-top:1px solid rgba(0,0,0,.08);background:#fff7ed;color:#9a3412;font-size:12px;white-space:pre-wrap}
    .cs-status{padding:8px 14px;font-size:12px;color:#2563eb;text-align:center;border-top:1px solid rgba(0,0,0,.06)}
  `;
  document.documentElement.appendChild(style);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export interface UIControls {
  setError(message: string | null): void;
  setStatus(message: string | null): void;
}

export function mountUI(handlers: UIHandlers): UIControls {
  ensureStyle();
  if (document.getElementById(ROOT_ID)) {
    return { setError: () => {}, setStatus: () => {} };
  }

  const root = el('div');
  root.id = ROOT_ID;

  // ── Main toggle button ───────────────────────────────────────────────────
  const mainBtn = el('button', 'cs-btn');
  mainBtn.textContent = 'ChatStash 导出';

  // ── Panel ────────────────────────────────────────────────────────────────
  const panel = el('div', 'cs-panel');
  panel.style.display = 'none';

  // Header
  const headerEl = el('header');
  const headerTitle = el('span');
  headerTitle.textContent = '选择要导出的对话';
  headerEl.appendChild(headerTitle);

  // Toolbar: select-all / deselect-all / refresh
  const toolbar = el('div', 'cs-toolbar');
  const selectAllBtn = el('button');
  selectAllBtn.textContent = '全选';
  const deselectAllBtn = el('button');
  deselectAllBtn.textContent = '取消全选';
  const refreshBtn = el('button');
  refreshBtn.textContent = '刷新列表';
  const settingsBtn = el('button');
  settingsBtn.textContent = '设置';
  const currentPageBtn = el('button');
  currentPageBtn.textContent = '仅当前页';
  toolbar.append(selectAllBtn, deselectAllBtn, currentPageBtn, refreshBtn, settingsBtn);

  // Conversation list
  const listEl = el('div', 'cs-list');

  // Footer
  const footerEl = el('div', 'cs-footer');
  const hint = el('div', 'cs-hint');
  hint.textContent = '支持导出 Markdown / JSON / PDF（自动命名并直接下载）';

  const row1 = el('div', 'cs-row');
  const mdBtn = el('button', 'cs-act');
  mdBtn.textContent = '导出 MD';
  const jsonBtn = el('button', 'cs-act secondary');
  jsonBtn.textContent = '导出 JSON';
  row1.append(mdBtn, jsonBtn);

  const row2 = el('div', 'cs-row');
  const pdfBtn = el('button', 'cs-act');
  pdfBtn.textContent = '导出 PDF';
  const logsBtn = el('button', 'cs-act secondary');
  logsBtn.textContent = '导出日志';
  row2.append(pdfBtn, logsBtn);

  footerEl.append(hint, row1, row2);

  // Error + status
  const errorEl = el('div', 'cs-error');
  errorEl.style.display = 'none';
  const statusEl = el('div', 'cs-status');
  statusEl.style.display = 'none';

  panel.append(headerEl, toolbar, listEl, footerEl, statusEl, errorEl);

  // ── State ────────────────────────────────────────────────────────────────
  let conversations: ConversationSummary[] = [];
  const checkboxes = new Map<string, HTMLInputElement>();

  function getSelected(): ConversationSummary[] {
    return conversations.filter((c) => checkboxes.get(c.id)?.checked);
  }

  function updateButtonStates(): void {
    const count = getSelected().length;
    const disabled = count === 0;
    mdBtn.disabled = disabled;
    jsonBtn.disabled = disabled;
    // PDF button always enabled (uses current page)
  }

  function renderList(items: ConversationSummary[]): void {
    listEl.innerHTML = '';
    checkboxes.clear();
    conversations = items;

    if (items.length === 0) {
      const empty = el('div', 'cs-list-empty');
      empty.textContent = '未找到对话记录（请确保侧边栏已展开）';
      listEl.appendChild(empty);
      updateButtonStates();
      return;
    }

    for (const conv of items) {
      const item = el('div', 'cs-item');

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = isCurrentConversation(conv); // default: current conversation only
      cb.addEventListener('change', updateButtonStates);
      checkboxes.set(conv.id, cb);

      const textWrap = el('div', 'cs-item-text');
      textWrap.textContent = conv.title || conv.id;

      const urlLine = el('div', 'cs-item-url');
      urlLine.textContent = conv.url;

      textWrap.appendChild(urlLine);
      item.append(cb, textWrap);
      // Clicking the row also toggles the checkbox
      item.addEventListener('click', (e) => {
        if (e.target !== cb) {
          cb.checked = !cb.checked;
          updateButtonStates();
        }
      });
      listEl.appendChild(item);
    }

    updateButtonStates();
  }

  function loadConversations(): void {
    const items = handlers.onLoadConversations();
    renderList(items);
  }

  // ── Toolbar actions ──────────────────────────────────────────────────────
  selectAllBtn.onclick = () => {
    checkboxes.forEach((cb) => { cb.checked = true; });
    updateButtonStates();
  };
  deselectAllBtn.onclick = () => {
    checkboxes.forEach((cb) => { cb.checked = false; });
    updateButtonStates();
  };
  refreshBtn.onclick = () => {
    loadConversations();
  };
  settingsBtn.onclick = () => {
    handlers.onOpenSettings();
  };
  currentPageBtn.onclick = () => {
    // Mark only the conversation matching the current URL
    checkboxes.forEach((cb, id) => {
      const conv = conversations.find((c) => c.id === id);
      const isCurrent = conv ? location.href.includes(conv.id) : false;
      cb.checked = isCurrent;
    });
    updateButtonStates();
  };

  // ── Export buttons ───────────────────────────────────────────────────────
  mdBtn.onclick = () => handlers.onExport('markdown', getSelected());
  jsonBtn.onclick = () => handlers.onExport('json', getSelected());
  pdfBtn.onclick = () => handlers.onExport('pdf', getSelected());
  logsBtn.onclick = () => handlers.onExportLogs();

  // ── Toggle panel ─────────────────────────────────────────────────────────
  mainBtn.onclick = () => {
    const isOpen = panel.style.display !== 'none';
    panel.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) loadConversations();
  };

  root.append(mainBtn, panel);
  document.documentElement.appendChild(root);

  return {
    setError(message: string | null) {
      if (!message) {
        errorEl.style.display = 'none';
        errorEl.textContent = '';
        return;
      }
      errorEl.style.display = 'block';
      errorEl.textContent = message;
    },
    setStatus(message: string | null) {
      if (!message) {
        statusEl.style.display = 'none';
        statusEl.textContent = '';
        return;
      }
      statusEl.style.display = 'block';
      statusEl.textContent = message;
    },
  };
}
