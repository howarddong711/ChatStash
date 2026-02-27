import { getSettings, saveSettings } from '@/shared/settings';

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: #${id}`);
  return el;
}

function showToast(message: string, isError = false): void {
  const toast = byId('toast');
  toast.textContent = message;
  toast.className = isError ? 'toast error show' : 'toast show';
  setTimeout(() => {
    toast.className = 'toast';
    toast.textContent = '';
  }, 3000);
}

function updatePathPreview(rootDir: string): void {
  const preview = byId('pathPreview');
  if (!rootDir.trim()) {
    preview.textContent = '示例路径将在输入后显示…';
    return;
  }
  const normalized = rootDir.trim().replace(/\\/g, '/').replace(/\/$/, '');
  preview.innerHTML = [
    `${normalized}/<strong>doubao</strong>/<strong>用户名</strong>/对话标题-20260222-123456.md`,
    `${normalized}/<strong>deepseek</strong>/<strong>default</strong>/对话标题-20260222-123456.json`,
  ].join('<br>');
}

async function main(): Promise<void> {
  const settings = await getSettings();

  const rootDirInput = byId('rootDir') as HTMLInputElement;
  const enableDebugLogsInput = byId('enableDebugLogs') as HTMLInputElement;
  rootDirInput.value = settings.rootDir;
  enableDebugLogsInput.checked = settings.enableDebugLogs;
  updatePathPreview(settings.rootDir);

  rootDirInput.addEventListener('input', () => {
    updatePathPreview(rootDirInput.value);
  });

  byId('saveBtn').addEventListener('click', async () => {
    try {
      await saveSettings({
        rootDir: rootDirInput.value.trim(),
        enableDebugLogs: enableDebugLogsInput.checked,
      });
      showToast('✓ 设置已保存');
    } catch (e) {
      showToast('保存失败：' + (e instanceof Error ? e.message : String(e)), true);
    }
  });

  byId('clearBtn').addEventListener('click', async () => {
    rootDirInput.value = '';
    updatePathPreview('');
    try {
      enableDebugLogsInput.checked = false;
      await saveSettings({ rootDir: '', enableDebugLogs: false });
      showToast('✓ 已清除路径，恢复弹窗模式');
    } catch (e) {
      showToast('保存失败：' + (e instanceof Error ? e.message : String(e)), true);
    }
  });
}

void main().catch((e) => console.error('[ChatStash options]', e));
