# ChatStash 🚀

[中文版](./README.md) | [English Version](./README_EN.md)

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
  - **Doubao (Doubao)**: `https://www.doubao.com/chat/` (Deeply optimized math & chip filtering)
  - **DeepSeek**: `https://chat.deepseek.com/` (Optimized for "Thinking" process extraction)

## Getting Started 🚀

### Load Unpacked Extension (For Users)
1. Download a pre-built ZIP from [Releases](https://github.com/howarddong711/ChatStash/releases) and extract it.
2. Open `chrome://extensions` (or `edge://extensions`) in your browser.
3. Enable **Developer mode** (toggle in the top-right).
4. Click **Load unpacked**.
5. Select the `dist/` folder.
6. Visit Doubao or DeepSeek and click the **ChatStash Export** button.

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
