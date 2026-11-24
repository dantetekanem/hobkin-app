import { readFileSync } from 'node:fs';
import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { STOP_ON, WAKE_ON } from './agent-schedules.mjs';

/**
 * The tools an agent keeps its own schedules with (056-agent-schedules): `hobkin_schedule` makes one and
 * `hobkin_schedules` lists, cancels, pauses, resumes or runs one now. They run in hobkin, which knows the agent by who
 * asks: the main chat by its own bridge, a run by its own pipe (`schedule-extension.mjs`). The names are not the Pi
 * scheduler's, which a run given these does not load (`namingExtensions` in `harnesses.mjs`).
 */

export const SCHEDULE_TOOL = 'hobkin_schedule';
export const SCHEDULES_TOOL = 'hobkin_schedules';
export const SCHEDULE_TOOLS = Object.freeze([SCHEDULE_TOOL, SCHEDULES_TOOL]);

const words = name => readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), 'utf8').trim();
const oneOf = values => Type.Union(values.map(value => Type.Literal(value)));

// Only the types: hobkin checks the bounds, so a schedule past them is refused in hobkin's own words.
const scheduleParameters = Type.Object({
  name: Type.Optional(Type.String({ description: 'A few words the user sees, up to 80 characters.' })),
  command: Type.Optional(Type.String({ description: 'The shell command to run each time, up to 4000 characters. Leave it out for a plain wake.' })),
  note: Type.String({ description: 'What to do when it wakes you, 1 to 1000 characters.' }),
  in: Type.Optional(Type.String({ description: 'When it first fires, as a duration such as 90s, 10m or 1h30m.' })),
  at: Type.Optional(Type.String({ description: "When it first fires, as a 24-hour clock time such as 19:30 in the user's time zone." })),
  every: Type.Optional(Type.String({ description: 'Repeat this often, 1m or longer, such as 6h or 1d. Without it, it fires once.' })),
  wakeOn: Type.Optional(oneOf(WAKE_ON)),
  stopOn: Type.Optional(oneOf(STOP_ON)),
  pendingExit: Type.Optional(Type.Array(Type.Integer(), { description: 'Up to 4 exit codes that mean "not yet".' })),
  maxRuns: Type.Optional(Type.Integer({ description: 'At most this many runs, up to 1440.' })),
  maxWakes: Type.Optional(Type.Union([Type.Integer(), Type.Literal('none')], { description: 'At most this many wakes, or none for no cap. Default 12.' })),
  expiresIn: Type.Optional(Type.String({ description: 'Its lifetime, 2h unless you say: any duration, such as 3d, or none for no end.' })),
  timeoutMs: Type.Optional(Type.Integer({ description: 'How long one run may take, 5000 to 600000. Default 120000.' })),
}, { additionalProperties: false });

const schedulesParameters = Type.Object({
  action: oneOf(['list', 'cancel', 'pause', 'resume', 'run']),
  id: Type.Optional(Type.String({ description: 'The schedule, for every action but list.' })),
}, { additionalProperties: false });

const answer = details => ({ content: [{ type: 'text', text: details.text ?? JSON.stringify(details) }], details });

/** `make(params, signal)` answers `{ text, schedule }` or throws the refusal. hobkin supplies it; a tool without it says so. */
export function createAgentScheduleTool(make) {
  return defineTool({
    name: SCHEDULE_TOOL,
    label: 'Schedule for yourself',
    description: words('schedule-tool'),
    parameters: scheduleParameters,
    async execute(_id, params, signal) {
      signal?.throwIfAborted();
      if (!make) throw Error('Schedules are not available here.');
      return answer(await make(params, signal));
    },
  });
}

/** `manage(params, signal)` answers what the action did, or throws the refusal. */
export function createAgentSchedulesTool(manage) {
  return defineTool({
    name: SCHEDULES_TOOL,
    label: 'Your schedules',
    description: words('schedules-tool'),
    parameters: schedulesParameters,
    async execute(_id, params, signal) {
      signal?.throwIfAborted();
      if (!manage) throw Error('Schedules are not available here.');
      return answer(await manage(params, signal));
    },
  });
}

/** Both tools on one handler, `{ make, manage }`, by name, as a bridge serves them. */
export const agentScheduleTools = handler => ({
  [SCHEDULE_TOOL]: createAgentScheduleTool(handler?.make),
  [SCHEDULES_TOOL]: createAgentSchedulesTool(handler?.manage),
});
