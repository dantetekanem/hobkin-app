import { fileURLToPath } from 'node:url';
import { callBridge } from './bridge.mjs';
import { createAgentScheduleTool, createAgentSchedulesTool } from './schedule-tools.mjs';

/**
 * The path hobkin loads with `--extension` into a run that keeps schedules (`namingExtensions` in `harnesses.mjs`): a
 * durable hobkin's turn and a `hobkin session` run. Each tool asks hobkin over the run's own bridge (`bridge.mjs`), which
 * knows the run by its pipe, and answers with hobkin's words (056-agent-schedules).
 */
export const scheduleExtension = fileURLToPath(import.meta.url);

export default function hobkinSchedules(pi) {
  for (const tool of [createAgentScheduleTool(), createAgentSchedulesTool()]) {
    pi.registerTool({
      ...tool,
      execute: (id, params, signal, _update, ctx) => callBridge(ctx, { op: 'tool', name: tool.name, id, params }, signal),
    });
  }
}
