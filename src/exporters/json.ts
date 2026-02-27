import type { Conversation } from '@/shared/types';

export function conversationToJson(conversation: Conversation): string {
  return JSON.stringify(conversation, null, 2) + '\n';
}

