/**
 * ChatStash Background Service Worker
 *
 * Handles chrome.downloads and chrome.debugger PDF generation
 * on behalf of content scripts.
 * Content scripts cannot call chrome.downloads or chrome.debugger
 * directly in MV3 — they must send a message to the background
 * worker, which has the required permissions in its execution context.
 */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'CHATSTASH_OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage(() => {
      const err = chrome.runtime.lastError;
      if (err) {
        console.error('[ChatStash] openOptionsPage failed:', err.message);
        sendResponse({ ok: false, error: err.message });
      } else {
        sendResponse({ ok: true });
      }
    });

    return true;
  }

  if (message?.type === 'CHATSTASH_OPEN_EXPORT_PAGE') {
    const key = String((message as { key?: unknown }).key ?? '').trim();
    if (!key) {
      sendResponse({ ok: false, error: 'missing export key' });
      return false;
    }

    const url = chrome.runtime.getURL(`src/pages/export/index.html#${encodeURIComponent(key)}`);
    chrome.tabs.create({ url, active: true }, (tab) => {
      const err = chrome.runtime.lastError;
      if (err) {
        console.error('[ChatStash] open export page failed:', err.message);
        sendResponse({ ok: false, error: err.message });
      } else {
        sendResponse({ ok: true, tabId: tab?.id });
      }
    });

    return true;
  }

  if (message?.type === 'CHATSTASH_DOWNLOAD') {
    const { url, filename } = message as { type: string; url: string; filename: string };

    chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
      const err = chrome.runtime.lastError;
      if (err) {
        console.error('[ChatStash] download failed:', err.message);
        sendResponse({ ok: false, error: err.message });
      } else {
        sendResponse({ ok: true, downloadId });
      }
    });

    // Return true to keep the message channel open for the async sendResponse
    return true;
  }

  if (message?.type === 'CHATSTASH_PRINT_TO_PDF') {
    const tabId = _sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: 'cannot determine tab ID' });
      return false;
    }

    const { filename } = message as { type: string; filename: string };

    (async () => {
      try {
        await chrome.debugger.attach({ tabId }, '1.2');
        const res = await chrome.debugger.sendCommand(
          { tabId },
          'Page.printToPDF',
          {
            printBackground: true,
            preferCSSPageSize: true,
            marginTop: 0.4,
            marginBottom: 0.4,
            marginLeft: 0.4,
            marginRight: 0.4,
          },
        ) as { data: string };
        await chrome.debugger.detach({ tabId });

        const dataUrl = 'data:application/pdf;base64,' + res.data;
        chrome.downloads.download(
          { url: dataUrl, filename: filename || 'chat.pdf', saveAs: false },
          (downloadId) => {
            const err = chrome.runtime.lastError;
            if (err) {
              console.error('[ChatStash] PDF download failed:', err.message);
              sendResponse({ ok: false, error: err.message });
            } else {
              sendResponse({ ok: true, downloadId });
            }
          },
        );
      } catch (e) {
        // Ensure debugger is detached even on error
        try {
          await chrome.debugger.detach({ tabId });
        } catch { /* already detached */ }

        const msg = e instanceof Error ? e.message : String(e);
        console.error('[ChatStash] printToPDF failed:', msg);
        sendResponse({ ok: false, error: msg });
      }
    })();

    return true;
  }

  if (message?.type === 'CHATSTASH_GENERATE_PDF') {
    // Like PRINT_TO_PDF but returns the raw base64 data instead of triggering
    // a download — lets the content script collect multiple PDFs and zip them.
    const tabId = _sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: 'cannot determine tab ID' });
      return false;
    }

    (async () => {
      try {
        await chrome.debugger.attach({ tabId }, '1.2');
        const res = await chrome.debugger.sendCommand(
          { tabId },
          'Page.printToPDF',
          {
            printBackground: true,
            preferCSSPageSize: true,
            marginTop: 0.4,
            marginBottom: 0.4,
            marginLeft: 0.4,
            marginRight: 0.4,
          },
        ) as { data: string };
        await chrome.debugger.detach({ tabId });
        sendResponse({ ok: true, data: res.data });
      } catch (e) {
        try { await chrome.debugger.detach({ tabId }); } catch { /* already detached */ }
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[ChatStash] generatePDF failed:', msg);
        sendResponse({ ok: false, error: msg });
      }
    })();

    return true;
  }
});
