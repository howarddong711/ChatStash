import type { ChatTurn, Conversation, ConversationSummary } from '@/shared/types';

export type AdapterId = 'doubao' | 'deepseek' | 'unknown';

export type ExtractResult =
  | { ok: true; conversation: Conversation; turns: ChatTurn[] }
  | { ok: false; reason: string; debug?: Record<string, unknown> };

export interface SiteAdapter {
  readonly id: AdapterId;
  readonly label: string;
  matches(url: URL): boolean;
  /**
   * Extract the current conversation (the one currently visible on screen).
   */
  extract(): Promise<ExtractResult>;
  /**
   * List all conversations accessible from the current page (sidebar list).
   * Returns an empty array if the sidebar is not detectable.
   */
  listConversations(): ConversationSummary[];
  /**
   * Attempt to detect the currently logged-in user's display name.
   * Returns null when not detectable.
   */
  detectUsername(): string | null;
}
