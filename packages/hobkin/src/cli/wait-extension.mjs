import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import { callBridge } from './bridge.mjs';

/** The path hobkin loads with `--extension` into a run that can wait (`namingExtensions` in `harnesses.mjs`). */
export const waitExtension = fileURLToPath(import.meta.url);

const description = readFileSync(new URL('../prompts/wait-tool.md', import.meta.url), 'utf8').trim();

// Only the types: the host checks the bounds, so a wait past them is answered in the host's own words.
const parameters = Type.Object({
  minutes: Type.Optional(Type.Number({ description: 'Minutes to wait, from 1 to 1440.' })),
  at: Type.Optional(Type.String({ description: "A 24-hour clock time to carry on at, such as 19:30, in the user's time zone: the next one to come." })),
  note: Type.String({ description: 'What to do when the time comes.' }),
}, { additionalProperties: false });

/**
 * `hobkin_wait`: asks the host over the run's own bridge (`bridge.mjs`), which knows the run by its pipe, and answers
 * with the host's words. The host ends the run as waiting once this turn ends (053-run-waits).
 */
export const createWaitTool = () => ({
  name: 'hobkin_wait',
  label: 'Wait',
  description,
  parameters,
  async execute(_id, params, signal, _update, ctx) {
    const { text, until, note } = await callBridge(ctx, { op: 'wait', ...params }, signal);
    return { content: [{ type: 'text', text }], details: { until, note } };
  },
});

export default function hobkinWait(pi) {
  pi.registerTool(createWaitTool());
}
