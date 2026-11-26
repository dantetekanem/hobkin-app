import { fileURLToPath } from 'node:url';
import { callBridge } from './bridge.mjs';
import { createRecallTool, createRememberTool } from './memory-tools.mjs';

/**
 * The path hobkin loads with `--extension` into a durable hobkin's turn on Pi (`namingExtensions` in `harnesses.mjs`):
 * it recalls every memory, private ones too, and remembers at once as that hobkin, over its own bridge
 * (057-shared-memory).
 */
export const memoryKeeperExtension = fileURLToPath(import.meta.url);

export default function hobkinMemoryKeeper(pi) {
  for (const tool of [createRecallTool(), createRememberTool()]) {
    pi.registerTool({
      ...tool,
      execute: (id, params, signal, _update, ctx) => callBridge(ctx, { op: 'tool', name: tool.name, id, params }, signal),
    });
  }
}
