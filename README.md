# ChatStash 🚀

[中文版](./README_CN.md) | [English Version](./README.md)

**ChatStash** 是一款轻量、极致还原的 AI 对话导出工具（Chrome/Edge 浏览器扩展）。它能帮助您将与 AI 模型的对话保存为干净、格式完美的文档。

## 为什么选择 ChatStash? 🌟
不同于通用的导出工具，ChatStash 针对特定 AI 平台进行了深度优化，以确保最高还原度：
- **精准数学公式支持**：内置 LaTeX 公式提取与清理（针对 KaTeX 和 MathJax 深度优化）。
- **纯净导出**：自动过滤 UI 噪音，如推荐问题（猜你想问）、反馈按钮、思维链（Thinking）过程等。
- **高质量 PDF**：自定义 "Shredder 2.0" 样式，解决浏览器打印 PDF 时常见的容器截断问题。
- **分钟级时间戳**：每次导出均带精确时间戳，方便归档管理。

## 核心功能 📦
- **支持导出格式**：
  - **Markdown (`.md`)**：完美包装并清理后的 LaTeX 数学公式。
  - **JSON (`.json`)**：供开发者使用的原始数据。
  - **PDF**：通过专用导出页面生成的纯净、全页打印视图。
- **支持平台**：
  - **豆包 (Doubao)**：`https://www.doubao.com/chat/`（深度优化公式抓取与推荐项过滤）
  - **DeepSeek**：`https://chat.deepseek.com/`（优化“思维链”提取）

## 快速开始 🚀

### 安装插件（面向用户）
1. [下载 Release 压缩包](https://github.com/howarddong711/ChatStash/releases) 并解压。
2. 在浏览器中打开 `chrome://extensions`（或 `edge://extensions`）。
3. 开启右上角的 **开发者模式**。
4. 点击 **加载已解压的扩展程序**。
5. 选择本仓库中的 `dist/` 文件夹。
6. 访问豆包或 DeepSeek，点击页面侧边的 **ChatStash 导出** 按钮。

## 开发指南 🛠️

### 环境准备
- Node.js 18+
- pnpm (推荐) 或 npm

### 编译构建
```bash
pnpm i
pnpm run build # 单次构建
# 或者
pnpm run build:watch # 监听模式构建
```

## 后续规划 🗺️
- [ ] 支持更多 AI 平台 (Claude, ChatGPT 等)
- [ ] 多选导出（仅导出特定对话轮次）
- [ ] 云端同步支持
- [ ] 为 PDF 导出提供可自定义的主题样式

## 开源协议 ⚖️
MIT (详见 `LICENSE`)。

---

# ChatStash 🚀 (English Version)

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
