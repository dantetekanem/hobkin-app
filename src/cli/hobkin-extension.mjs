import { BRIDGE, callBridge } from './bridge.mjs';
import { createOwnedAgentSessionTool } from './owned-agent-tool.mjs';
import { decidedSection } from './decided.mjs';
import { composePersonaPrompt } from './persona.mjs';
import { directionsSection } from './directions.mjs';
import { createMemoryTool, memorySection } from './memory.mjs';
import { createQuestionTool } from './questions.mjs';
import { createCheckMessageTool, createScheduleTool, createSettingsTool, createStopWorkloadTool } from './hobkin-tools.mjs';

/**
 * Loaded with --extension by the Pi child that Hobkin starts for its main chat. The tools keep their
 * names, schemas and descriptions; each call runs in Hobkin, which owns the questions, schedules,
 * settings and memory. The model is Pi's, under whatever launcher started it.
 */
export default function hobkin(pi) {
  const tools = [createQuestionTool(), createScheduleTool(), createCheckMessageTool(), createMemoryTool(), createSettingsTool(), createStopWorkloadTool()];
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
  pi.on('before_agent_start', async (event, ctx) => {
    const persona = await callBridge(ctx, { op: 'persona' });
    const sections = [
      directionsSection(await callBridge(ctx, { op: 'directions' })),
      memorySection(await callBridge(ctx, { op: 'memory' })),
      decidedSection(await callBridge(ctx, { op: 'decided' })),
    ];
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
