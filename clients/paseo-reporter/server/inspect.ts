import type { AgentTimelineItem } from '@getpaseo/protocol/agent-types';

export type TextReply = {
  text: string;
  /** The user message that initiated this completed reply. */
  input?: string;
  /** The provider's ID for the assistant reply, when it exposes one. */
  messageId?: string;
  /** The assistant reply immediately preceding this user/assistant exchange. */
  parentMessageId?: string;
};

/**
 * Select the completed assistant text and its parent from the timeline currently
 * visible to Paseo. This deliberately derives the parent from the timeline on
 * every turn instead of remembering only the last report: after a rewind, the
 * discarded branch is absent and the reply attaches to the rewind point.
 */
export function latestTextReply(timeline: readonly AgentTimelineItem[]): TextReply | undefined {
  let userIndex = -1;
  let input: string | undefined;
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item.type === 'user_message') {
      userIndex = index;
      input = item.text.trim() || undefined;
      break;
    }
  }

  const messages = timeline.slice(userIndex + 1).filter((item): item is Extract<AgentTimelineItem, { type: 'assistant_message' }> => item.type === 'assistant_message');
  const text = messages.map((item) => item.text).join('').trim();
  if (!text) return undefined;

  const messageId = [...messages].reverse().find((item) => item.messageId)?.messageId;
  let parentMessageId: string | undefined;
  for (let index = userIndex - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item.type === 'assistant_message' && item.messageId) {
      parentMessageId = item.messageId;
      break;
    }
  }
  return { text, input: input || undefined, messageId, parentMessageId };
}
