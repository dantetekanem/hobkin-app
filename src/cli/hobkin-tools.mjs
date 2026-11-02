import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { efforts, inRoutineWords } from './schedules.mjs';

const settingsScope = Type.Union(['main', 'background', 'routines', 'all'].map(value => Type.Literal(value)));
const settingsEffort = Type.Union([...new Set(Object.values(efforts).flat())].map(value => Type.Literal(value)));
const routineId = Type.Optional(Type.String({ minLength: 1, maxLength: 80, pattern: '^[a-z0-9][a-z0-9._-]*$' }));
const settingsParameters = Type.Union([
  Type.Object({ action: Type.Literal('inspect'), scope: settingsScope, routineId }, { additionalProperties: false }),
  Type.Object({
    action: Type.Literal('update'),
    scope: settingsScope,
    routineId,
    model: Type.Optional(Type.String({ minLength: 3, maxLength: 200 })),
    effort: Type.Optional(settingsEffort),
  }, { additionalProperties: false }),
]);

const forModel = details => JSON.parse(inRoutineWords(JSON.stringify(details)));

export function createScheduleTool(triggerSchedule) {
  const parameters = Type.Object({ routineId }, { additionalProperties: false });
  return defineTool({
    name: 'run_routine',
    label: 'Run a routine once',
    description: 'Only on an explicit user request, run one exact native routine ID now, even if paused or outside its calendar. No settings change. Omit routineId to list up to 20 candidates. Returns admission, not completion; results appear in Reports.',
    parameters,
    async execute(id, request, signal) {
      if (!Check(parameters, request)) throw Error('Invalid routine request.');
      signal?.throwIfAborted();
      if (!triggerSchedule) throw Error('Running routines is unavailable.');
      const details = forModel(await triggerSchedule(request.routineId, id, signal));
      return { content: [{ type: 'text', text: JSON.stringify(details) }], details };
    },
  });
}

export function createCheckMessageTool(messageCheck) {
  const parameters = Type.Object({
    routineId,
    message: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
  }, { additionalProperties: false });
  return defineTool({
    name: 'message_check',
    label: 'Message a running check',
    description: 'Send a message to a routine while it runs, to pass on what the user said, redirect it or ask it to wrap up. It reads the message at its next step and carries on; its report holds the result. Omit both fields to list the routines running now.',
    parameters,
    async execute(_id, request, signal) {
      if (!Check(parameters, request)) throw Error('Invalid check message.');
      signal?.throwIfAborted();
      if (!messageCheck) throw Error('Messaging checks is unavailable.');
      const details = forModel(await messageCheck({ scheduleId: request.routineId, message: request.message }));
      return { content: [{ type: 'text', text: JSON.stringify(details) }], details };
    },
  });
}

/** `run(request, signal)` returns the receipt; the host that owns the session and settings supplies it. */
export function createSettingsTool(run) {
  return defineTool({
    name: 'model_settings',
    label: 'Model and effort settings',
    description: 'Inspect or update model and effort for exactly main, background, routines, or all. Add routineId with scope routines to target one routine. Inspect lists availableModels. Updates require an installed provider/model reference and persist only Hobkin settings, never Pi global defaults. Main updates also change this session without saving Pi defaults and apply from the next model call; the receipt separates saved settings from the observed active binding.',
    parameters: settingsParameters,
    async execute(_id, request, signal) {
      if (!Check(settingsParameters, request)) throw Error('Invalid model settings request.');
      signal?.throwIfAborted();
      if (!run) throw Error('Model settings are unavailable.');
      const details = forModel(await run(request, signal));
      return { content: [{ type: 'text', text: JSON.stringify(details) }], details };
    },
  });
}
