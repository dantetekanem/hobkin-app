import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import { callBridge } from './bridge.mjs';

/** The path hobkin loads with `--extension` into a job that lives until its agent says it is done (`namingExtensions` in `harnesses.mjs`). */
export const doneExtension = fileURLToPath(import.meta.url);

const description = readFileSync(new URL('../prompts/done-tool.md', import.meta.url), 'utf8').trim();

const parameters = Type.Object({
  report: Type.String({ description: 'Your report: the point first, then what you did, what you found and what is left.' }),
}, { additionalProperties: false });

/**
 * `hobkin_done`: tells the host over the job's own bridge (`bridge.mjs`), which knows the job by its pipe, that the job
 * is finished, and answers with the host's words. The host ends the job with this report once the turn ends
 * (072-jobs-live-until-done).
 */
export const createDoneTool = () => ({
  name: 'hobkin_done',
  label: 'Done',
  description,
  parameters,
  async execute(_id, params, signal, _update, ctx) {
    const { text } = await callBridge(ctx, { op: 'done', ...params }, signal);
    return { content: [{ type: 'text', text }], details: {} };
  },
});

export default function hobkinDone(pi) {
  pi.registerTool(createDoneTool());
}
