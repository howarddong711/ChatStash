export type ChatRole = 'user' | 'assistant' | 'system';

export type ChatTurn = {
  role: ChatRole;
  contentText: string;
  contentMd: string;
  /** Raw cleaned HTML from the original page DOM (for high-fidelity PDF print). */
  contentHtml?: string;
  createdAt?: number;
};

export type Conversation = {
  title: string;
  url: string;
  platform: string;
  exportedAt: string;
  turns: ChatTurn[];
};

export type ExportBundle = {
  conversation: Conversation;
  markdown: string;
  /** Pre-rendered HTML from the original page (for high-fidelity PDF print). */
  html?: string;
};

/** A lightweight summary of a conversation from the sidebar list. */
export type ConversationSummary = {
  /** Unique identifier for the conversation (from URL or DOM) */
  id: string;
  /** Human-readable title shown in the sidebar */
  title: string;
  /** Full URL to navigate to the conversation */
  url: string;
  /** ISO timestamp of last activity, if detectable */
  updatedAt?: string;
};

/** User-configurable settings stored in chrome.storage.local */
export type UserSettings = {
  /**
   * Root download directory path as entered by the user.
   * Files will be placed at: {rootDir}/{platform}/{username}/{filename}
   * If empty, the browser's default download dialog is shown.
   */
  rootDir: string;
  /**
   * Enable runtime debug logs for export flow.
   * Default is false to avoid extra overhead for normal users.
   */
  enableDebugLogs: boolean;
};
