import { fileURLToPath } from 'node:url';
import { callBridge } from './bridge.mjs';
import { createRecallTool, createSuggestMemoryTool } from './memory-tools.mjs';

/**
 * The path hobkin loads with `--extension` into a run that reads hobkin's memories (`namingExtensions` in
 * `harnesses.mjs`): a routine, a Work run or a session run. It recalls shared memories and suggests one to the main
 * hobkin, each over the run's own bridge (`bridge.mjs`), which knows the run by its pipe (057-shared-memory).
 */
export const memoryExtension = fileURLToPath(import.meta.url);

export default function hobkinMemories(pi) {
  for (const tool of [createRecallTool(), createSuggestMemoryTool()]) {
    pi.registerTool({
      ...tool,
      execute: (id, params, signal, _update, ctx) => callBridge(ctx, { op: 'tool', name: tool.name, id, params }, signal),
    });
  }
}
