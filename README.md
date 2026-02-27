# ChatStash 🚀

**ChatStash** is a lightweight, high-fidelity chat export tool for web AI chats (Chrome/Edge extension). It helps you save your conversations with AI models as clean, perfectly formatted documents.

## Why ChatStash? 🌟
Unlike generic exporters, ChatStash is deeply optimized for specific AI platforms to ensure the highest fidelity:
- **Precision Math Support**: Built-in LaTeX formula extraction and cleaning (optimized for KaTeX and MathJax).
- **Clean Export**: Automatically filters out UI noise like suggestion chips, feedback buttons, and thinking processes.
- **High-Quality PDF**: Custom "Shredder 2.0" styles to prevent text truncation during PDF generation.
- **Minute-Level Timestamps**: Every export is timestamped for easy organization.

## Features (MVP) 📦
- **Export current conversation to**:
  - **Markdown (`.md`)**: With properly wrapped and cleaned LaTeX math formulas.
  - **JSON (`.json`)**: Raw data for developers.
  - **PDF**: Clean, full-page print view via a dedicated export page.
- **Supported Platforms**:
  - **Doubao (豆包)**: `https://www.doubao.com/chat/` (Deeply optimized math & chip filtering)
  - **DeepSeek**: `https://chat.deepseek.com/` (Optimized for "Thinking" process extraction)

## Getting Started 🚀

### Load Unpacked Extension (For Users)
1. Download this repository as a ZIP and extract it, or `git clone` it.
2. Open `chrome://extensions` (or `edge://extensions`) in your browser.
3. Enable **Developer mode** (toggle in the top-right).
4. Click **Load unpacked**.
5. Select the `dist/` folder within this repository.
6. Visit Doubao or DeepSeek and click the **ChatStash 导出** button.

## Development 🛠️

### Prereqs
- Node.js 18+
- pnpm (recommended) or npm

### Install & Build
```bash
pnpm i
pnpm run build # Build once
# OR
pnpm run build:watch # Build with watch mode
```

## Future Roadmap 🗺️
- [ ] Support more AI platforms (Claude, ChatGPT, etc.)
- [ ] Multi-turn selection (only export specific messages)
- [ ] Cloud synchronization Support
- [ ] Customizable theme styles for PDF export

## License ⚖️
MIT (see `LICENSE`).

Lightweight chat export tool for web AI chats (Chrome/Edge extension).

## Features (MVP)

- Export current conversation to:
  - Markdown (`.md`)
  - JSON (`.json`)
  - PDF (via a clean export page + browser Print to PDF)
- Site adapters (initial):
  - Doubao: `https://www.doubao.com/chat/`
  - DeepSeek: `https://chat.deepseek.com/`

## Dev

### Prereqs

- Node.js 18+
- pnpm (recommended) or npm

### Install

```bash
pnpm i
```

### Build (watch)

```bash
pnpm run build:watch
```

Output goes to `dist/`.

### Load unpacked extension

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable Developer mode
3. Click "Load unpacked"
4. Select the `ChatStash/dist` folder
5. Visit Doubao or DeepSeek and click the `ChatStash 导出` button

## License

MIT (see `LICENSE`).

