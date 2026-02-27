import JSZip from 'jszip';

export function safeFilename(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .normalize('NFC') // Use NFC for better Chinese character support
    // Allow alphanumeric, Chinese, Japanese, Korean characters, and common safe symbols
    .replace(/[^\w\s\u4e00-\u9fff\u3040-\u30ff\u3130-\u318f\uac00-\ud7af\-_]/gi, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[._\s-]+|[._\s-]+$/g, '')
    .slice(0, 120);

  return cleaned || 'chat';
}

/**
 * Build a path segment for a single file inside a zip or a download filename.
 * Structure: {platform}/{username}/{title}-{timestamp}.{ext}
 */
export function buildFilePath(opts: {
  platform: string;
  username: string | null;
  title: string;
  timestamp: string;
  ext: string;
}): string {
  const { platform, username, title, timestamp, ext } = opts;
  const safePlatform = safeFilename(platform) || 'chat';
  const safeUser = safeFilename(username ?? 'default') || 'default';
  const safeTitle = safeFilename(title) || 'chat';
  return `${safePlatform}/${safeUser}/${safeTitle}-${timestamp}.${ext}`;
}

/**
 * Build a categorized filename for a single-file download via <a>.click().
 * Structure: [{rootDir}/]{platform}/{username}/{title}-{timestamp}.{ext}
 */
export function buildCategorizedFilename(opts: {
  rootDir: string;
  platform: string;
  username: string | null;
  title: string;
  timestamp: string;
  ext: string;
}): string {
  const { rootDir, ...rest } = opts;
  const innerPath = buildFilePath(rest);

  if (rootDir.trim()) {
    const normalizedRoot = rootDir
      .trim()
      .replace(/\\/g, '/')
      .replace(/\/$/, '')
      .split('/')
      .map((seg) => safeFilename(seg) || 'chat')
      .join('/');
    return `${normalizedRoot}/${innerPath}`;
  }
  return innerPath;
}

/** Single-file download via anchor click (works fine for one file, no dialog). */
export function downloadBlobFile(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

/** Single-file text download via anchor click. */
export function downloadTextFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  downloadBlobFile(filename, blob);
}

export interface ZipEntry {
  /** Path inside the zip (e.g. "doubao/alice/chat-20260222.md") */
  path: string;
  content: string | Blob | ArrayBuffer | Uint8Array;
}

function addNumericSuffix(path: string, index: number): string {
  const slash = path.lastIndexOf('/');
  const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
  const name = slash >= 0 ? path.slice(slash + 1) : path;

  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  return `${dir}${base}-${index}${ext}`;
}

/**
 * Pack multiple text files into a single zip and trigger ONE download.
 * Completely avoids the multi-dialog problem — no background worker needed.
 */
export async function downloadZip(entries: ZipEntry[], zipName: string): Promise<void> {
  const zip = new JSZip();
  const seen = new Map<string, number>();

  for (const entry of entries) {
    const prev = seen.get(entry.path) ?? 0;
    const next = prev + 1;
    seen.set(entry.path, next);

    const finalPath = next === 1 ? entry.path : addNumericSuffix(entry.path, next);
    zip.file(finalPath, entry.content);
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = zipName;
  a.rel = 'noopener';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
