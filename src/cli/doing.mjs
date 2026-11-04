import { searchingTool } from './mood.mjs';

// The main agent hands work off with `hobkin session`, so that command reads as delegating, wherever hobkin is installed.
const DELEGATION = /(?:\bmain\.mjs'?|\bhobkin)\s+session\b/;

const toolDoing = (name, args) => {
  if (searchingTool(name)) return 'researching';
  if (name === 'bash' && DELEGATION.test(args?.command ?? '')) return 'delegating';
  return 'working';
};

const streamedDoing = part => {
  if (part.startsWith('thinking')) return 'thinking';
  if (part.startsWith('text')) return 'writing';
  if (part.startsWith('toolcall')) return 'working';
  return null;
};

/** One word for what the main agent is doing, from each event of its turn. An event that says nothing new keeps the word it had. */
export function doingAfter(previous, event) {
  const part = event?.assistantMessageEvent?.type;
  if (event?.type === 'message_update' && typeof part === 'string') return streamedDoing(part) ?? previous;
  if (event?.type === 'tool_execution_start') return toolDoing(event.toolName, event.args);
  if (event?.type === 'tool_execution_end' || event?.type === 'compaction_end') return 'thinking';
  if (event?.type === 'auto_retry_start') return 'retrying';
  if (event?.type === 'compaction_start') return 'compacting';
  return previous;
}
