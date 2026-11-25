import { BRIDGE, callBridge } from './bridge.mjs';
import { guardCodeToolAbort } from './code-tool-crash.mjs';
import { createOwnedAgentSessionTool } from './owned-agent-tool.mjs';
import { decidedSection } from './decided.mjs';
import { composePersonaPrompt } from './persona.mjs';
import { directionsSection } from './directions.mjs';
import { createMemoryTool, memorySection } from './memory.mjs';
import { createActionItemTool } from './action-item-tool.mjs';
import { createQuestionTool } from './questions.mjs';
import { createCheckMessageTool, createScheduleTool, createSettingsTool, createStopWorkloadTool } from './hobkin-tools.mjs';
import { createAgentScheduleTool, createAgentSchedulesTool } from './schedule-tools.mjs';
import { createRecallTool, createRememberTool } from './memory-tools.mjs';
import loadSkill from './load-skill-extension.mjs';

/**
 * Every tool this extension registers, by name, as the main chat's exact list of bridged tools (`pi-session.mjs`) expects
 * them. A tool added here is added to that list in the same change. `load_skill` alone runs in the chat's own Pi rather
 * than in the host, since only that Pi knows its skills (070-load-skill).
 */
export const HOBKIN_BRIDGE_TOOLS = Object.freeze(['ask_question', 'run_routine', 'message_check', 'hobkin_memory', 'model_settings', 'stop_workload',
  'hobkin_schedule', 'hobkin_schedules', 'hobkin_recall', 'hobkin_remember', 'hobkin_action_items', 'owned_agent', 'load_skill']);

/** hobkin's memories for the prompt. A host from before has none to give, and that costs the index, never the turn. */
async function memoriesSection(ctx) {
  try {
    const index = await callBridge(ctx, { op: 'memories' });
    return typeof index === 'string' ? index : '';
  } catch {
    return '';
  }
}

/**
 * Loaded with --extension by the Pi child that Hobkin starts for its main chat. The tools keep their
 * names, schemas and descriptions; each call runs in Hobkin, which owns the questions, schedules,
 * settings and memory, the schedules the main agent keeps for itself (056-agent-schedules) and the memories every agent
 * shares (057-shared-memory). The model is Pi's, under whatever launcher started it. The chat's Pi also gets the guard
 * against Pi's code tool crash (`code-tool-crash.mjs`).
 */
export default function hobkin(pi) {
  guardCodeToolAbort();
  const tools = [createQuestionTool(), createScheduleTool(), createCheckMessageTool(), createMemoryTool(), createSettingsTool(), createStopWorkloadTool(),
    createAgentScheduleTool(), createAgentSchedulesTool(), createRecallTool(), createRememberTool(), createActionItemTool()];
  for (const tool of tools) {
    pi.registerTool({
      ...tool,
      execute: (id, params, signal, _update, ctx) => callBridge(ctx, { op: 'tool', name: tool.name, id, params }, signal),
    });
  }
  const ownedTool = createOwnedAgentSessionTool(async (params, signal, ctx, id) =>
    (await callBridge(ctx, { op: 'tool', name: 'owned_agent', id, params }, signal)).details);
  tools.push(ownedTool);
  pi.registerTool(ownedTool);
  // Ahead of the prompt below, which is set whole from Pi's, so it carries the list of skills load_skill words.
  tools.push(loadSkill(pi));
  pi.on('before_agent_start', async (event, ctx) => {
    const persona = await callBridge(ctx, { op: 'persona' });
    const sections = [
      directionsSection(await callBridge(ctx, { op: 'directions' })),
      memorySection(await callBridge(ctx, { op: 'memory' })),
      await memoriesSection(ctx),
      decidedSection(await callBridge(ctx, { op: 'decided' })),
    ].filter(Boolean);
    return { systemPrompt: composePersonaPrompt([event.systemPrompt, ...sections].join('\n\n'), persona) };
  });
  // Session start runs before Pi reads its input, so this one record is a status update, never a dialog.
  pi.on('session_start', (_event, ctx) => {
    const names = tools.map(tool => tool.name);
    const missing = names.filter(name => !pi.getActiveTools().includes(name));
    if (missing.length) pi.setActiveTools([...pi.getActiveTools(), ...missing]);
    const active = pi.getActiveTools();
    ctx.ui.setStatus(BRIDGE, JSON.stringify({ version: 1, tools: names.filter(name => active.includes(name)) }));
  });
}
