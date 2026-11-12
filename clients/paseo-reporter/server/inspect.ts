import type { AgentTimelineItem } from '@getpaseo/protocol/agent-types';

/** Returns the accumulated textual assistant output after the latest user message. */
export function latestOutputText(timeline: readonly AgentTimelineItem[]): string {
  let output = '';

  for (const item of timeline) {
    if (item.type === 'user_message') {
      output = '';
    } else if ('text' in item && typeof item.text === 'string') {
      output += item.text;
    }
  }

  return output.trim();
}
