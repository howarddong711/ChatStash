import { delay } from './utils';

const OVERLAY_ID = 'chatstash-overlay';
const OVERLAY_STYLE_ID = 'chatstash-overlay-style';
const PRINT_STYLE_ID = 'chatstash-print-styles';
const ROOT_ID = 'chatstash-root';
const OCR_HINT_REGEX = /^(当前模型仅对图片中的文字进行识别|切换\s*K1\.5\s*获取更好的视觉理解能力)/u;
type PrintProfile = 'generic' | 'kimi' | 'none';

function sendRuntimeMessage<TResponse>(message: Record<string, unknown>): Promise<TResponse> {
  return new Promise<TResponse>((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: TResponse) => {
      const err = chrome.runtime?.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response);
    });
  });
}

export function showOverlay(message: string): void {
  if (document.getElementById(OVERLAY_ID)) return;

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483646',
    'background:rgba(0,0,0,0.55)',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'flex-direction:column',
    'gap:12px',
    'backdrop-filter:blur(4px)',
    '-webkit-backdrop-filter:blur(4px)',
  ].join(';');

  const spinner = document.createElement('div');
  spinner.style.cssText = [
    'width:36px',
    'height:36px',
    'border:3px solid rgba(255,255,255,0.3)',
    'border-top-color:#fff',
    'border-radius:50%',
    'animation:cs-spin 0.8s linear infinite',
  ].join(';');

  if (!document.getElementById(OVERLAY_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = OVERLAY_STYLE_ID;
    style.textContent = '@keyframes cs-spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
  }

  const label = document.createElement('div');
  label.id = 'chatstash-overlay-label';
  label.style.cssText =
    'color:#fff;font-size:14px;font-family:system-ui,sans-serif;text-align:center;max-width:280px;line-height:1.5';
  label.textContent = message;

  overlay.append(spinner, label);
  document.documentElement.appendChild(overlay);
}

export function updateOverlay(message: string): void {
  const label = document.getElementById('chatstash-overlay-label');
  if (label) label.textContent = message;
}

export function hideOverlay(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}

function injectGenericPrintStyles(): void {
  const style = document.createElement('style');
  style.id = PRINT_STYLE_ID;

  const hideSelectors = [
    'nav',
    'header',
    'footer',
    'aside',
    '[class*="sidebar" i]',
    '[class*="header" i]',
    '[class*="footer" i]',
    '[class*="input-area" i]',
    '[class*="feedback" i]',
    '[class*="action" i]',
    '[class*="chat-input" i]',
    '[class*="editor-container" i]',
    '.chat-feedback',
    '.message-actions',
    'textarea[placeholder*="发消息"]',
    'input[placeholder*="发消息"]',
    '[contenteditable="true"][data-placeholder*="发消息"]',
    `#${ROOT_ID}`,
  ];

  const forceExpandSelectors = [
    'body',
    'html',
    'main',
    '#root',
    '#app',
    '[id*="root" i], [id*="app" i]',
    '[class*="main" i]',
    '[class*="container" i]',
    '[class*="layout" i]',
    '[class*="content" i]',
    '[class*="wrapper" i]',
    '[class*="scroll" i]',
    '[class*="chat" i]',
    '[class*="thread" i]',
    '[class*="session" i]',
    '[class*="conversation" i]',
    '[class*="message-list" i]',
    '[class*="messageList" i]',
    '[class*="chat-scroll" i]',
    '[class*="chatScroll" i]',
    '.ds-scroll-area',
    '.ds-chat-messages',
    '.doubao-scroll-area',
    '.conversation-list',
    '.chat-content',
    '.message-list-wrapper',
    '#main',
    '#chat-root',
    '[data-testid*="scroll" i]',
    '[role="feed"]',
    '[role="list"]',
    '[class*="message-scroll" i]',
    '[class*="messageScroll" i]',
    '[class*="list-container" i]',
    '[class*="item-container" i]',
    '[class*="scroll-container" i]',
    '[class*="doubao" i]',
    '[class*="arco-scroll" i]',
    '[class*="arco-layout" i]',
  ];

  style.textContent = `
    @media print {
      ${hideSelectors.join(', ')} {
        display: none !important;
        visibility: hidden !important;
        height: 0 !important;
        width: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
      }

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
        clip-path: none !important;
      }

      div, section, article, main {
        overflow: visible !important;
        height: auto !important;
      }

      body, html {
        overflow: visible !important;
        height: auto !important;
      }

      [class*="scroll" i], [class*="chat" i], [class*="message" i], main {
        overflow: visible !important;
        height: auto !important;
        display: block !important;
      }

      .katex, .MathJax, .math, [data-latex] {
        overflow: visible !important;
      }

      [class*="fixed" i]:not([class*="message" i]),
      [class*="sticky" i]:not([class*="message" i]),
      button[aria-label*="copy" i], button[aria-label*="share" i] {
        display: none !important;
      }
    }
  `;

  document.head.appendChild(style);
}

function injectKimiPrintStyles(): void {
  const style = document.createElement('style');
  style.id = PRINT_STYLE_ID;

  const hideSelectors = [
    '.sidebar-placeholder',
    '.sidebar',
    '.layout-header',
    '.chat-editor',
    '.chat-input',
    '.chat-editor-action',
    '.legal-footer',
    '.download-app-btn',
    '.sidebar-footer',
    '.sidebar-nav',
    '.home-bottom',
    '.landing-area',
    '.case-list',
    '.tool-switch',
    '.toolkit-trigger-btn',
    '.send-button-container',
    '.icon-button',
    'button[aria-label*="copy" i]',
    'button[aria-label*="share" i]',
    `#${ROOT_ID}`,
  ];

  const expandSelectors = [
    'html',
    'body',
    '#app',
    '.app',
    '.main',
    'main',
    '#page-layout-container',
    '#chat-container',
    '.layout-container',
    '.layout-content',
    '.layout-content-main',
    '.chat-box',
    '[role="feed"]',
    '[role="list"]',
    '[class*="chat" i]',
    '[class*="content" i]',
    '[class*="message" i]',
    '[class*="scroll" i]',
    '[class*="scrollbar" i]',
    '[class*="overflow" i]',
  ];

  style.textContent = `
    @page {
      size: auto;
      margin: 12mm;
    }

    @media print {
      ${hideSelectors.join(', ')} {
        display: none !important;
        visibility: hidden !important;
      }

      ${expandSelectors.join(', ')} {
        height: auto !important;
        min-height: 0 !important;
        max-height: none !important;
        overflow: visible !important;
        position: static !important;
        transform: none !important;
        contain: none !important;
        clip: auto !important;
        clip-path: none !important;
      }

      html, body, #app, .app, .main {
        width: auto !important;
        max-width: none !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      #page-layout-container,
      #chat-container,
      .layout-container,
      .layout-content,
      .layout-content-main,
      .chat-box {
        display: block !important;
        box-shadow: none !important;
      }

      [class*="fixed" i],
      [class*="sticky" i] {
        position: static !important;
      }
    }
  `;

  document.head.appendChild(style);
}

function injectPrintStyles(profile: PrintProfile): void {
  if (profile === 'none') return;
  if (profile === 'kimi') {
    injectKimiPrintStyles();
    return;
  }
  injectGenericPrintStyles();
}

function removePrintStyles(): void {
  document.getElementById(PRINT_STYLE_ID)?.remove();
}

function hideChatstashUi(): void {
  const root = document.getElementById(ROOT_ID);
  const overlay = document.getElementById(OVERLAY_ID);
  if (root) root.style.setProperty('display', 'none', 'important');
  if (overlay) overlay.style.setProperty('display', 'none', 'important');
}

function restoreChatstashUi(): void {
  const root = document.getElementById(ROOT_ID);
  const overlay = document.getElementById(OVERLAY_ID);
  if (root) root.style.removeProperty('display');
  if (overlay) overlay.style.removeProperty('display');
}

function hideKimiTextOverlays(): HTMLElement[] {
  const hidden: HTMLElement[] = [];
  const elements = document.querySelectorAll<HTMLElement>('div, span, p');

  for (const element of elements) {
    const text = element.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (!OCR_HINT_REGEX.test(text)) continue;
    if (element.closest(`#${ROOT_ID}`)) continue;

    element.style.setProperty('display', 'none', 'important');
    hidden.push(element);
  }

  return hidden;
}

function restoreKimiTextOverlays(hidden: HTMLElement[]): void {
  for (const element of hidden) {
    element.style.removeProperty('display');
  }
}

async function withPreparedPrintContext<T>(
  task: () => Promise<T>,
  opts: { waitMs?: number; printProfile?: PrintProfile } = {},
): Promise<T> {
  const waitMs = opts.waitMs ?? 0;
  const printProfile = opts.printProfile ?? 'generic';

  injectPrintStyles(printProfile);
  hideChatstashUi();
  const hiddenKimiOverlays = printProfile === 'kimi' ? hideKimiTextOverlays() : [];

  if (waitMs > 0) {
    await delay(waitMs);
  }

  try {
    return await task();
  } finally {
    if (printProfile !== 'none') {
      removePrintStyles();
    }
    restoreKimiTextOverlays(hiddenKimiOverlays);
    restoreChatstashUi();
  }
}

export async function downloadCurrentPagePdf(
  filename: string,
  opts: { waitMs?: number; printProfile?: PrintProfile } = {},
): Promise<void> {
  const response = await withPreparedPrintContext<{ ok: boolean; error?: string }>(
    () => sendRuntimeMessage({ type: 'CHATSTASH_PRINT_TO_PDF', filename }),
    opts,
  );

  if (!response.ok) {
    throw new Error(response.error || 'PDF export failed');
  }
}

export async function captureCurrentPagePdfBlob(
  opts: { waitMs?: number; printProfile?: PrintProfile } = {},
): Promise<Blob> {
  const response = await withPreparedPrintContext<{ ok: boolean; data?: string; error?: string }>(
    () => sendRuntimeMessage({ type: 'CHATSTASH_GENERATE_PDF' }),
    opts,
  );

  if (!response.ok || !response.data) {
    throw new Error(response.error || 'No PDF data received');
  }

  const binary = atob(response.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: 'application/pdf' });
}
