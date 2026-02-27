import type { Conversation } from '@/shared/types';

function h1Title(title: string): string {
  const safe = title.trim() || 'Chat';
  return `# ${safe}\n`;
}

export function conversationToMarkdown(conversation: Conversation): string {
  const lines: string[] = [];
  lines.push(`# ${conversation.title || 'Chat'}`);
  lines.push('');
  lines.push(`> **Platform**: ${conversation.platform.charAt(0).toUpperCase() + conversation.platform.slice(1)}`);
  lines.push(`> **Date**: ${new Date(conversation.exportedAt).toLocaleString()}`);
  lines.push(`> **URL**: ${conversation.url}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const turn of conversation.turns) {
    const isAssistant = turn.role === 'assistant';
    const roleLabel = isAssistant ? 'Assistant' : 'User';
    lines.push(`### ${roleLabel}`);
    lines.push('');
    lines.push(turn.contentMd || turn.contentText || '');
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n').trim() + '\n';
}
