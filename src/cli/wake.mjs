import { fittedWakes } from './agent-schedules.mjs';

// Turns hobkin starts for the main agent by itself. The user did not write them and Chat does not show them: the agent's answer is what they see.
const OPENING = '<hobkin-wake>';
const MOST_TOLD = 5;
const LONGEST_OUTPUT = 600;

export const isWakeBrief = text => text.startsWith(`${OPENING}\n`);

const brief = details => `${OPENING}\n${JSON.stringify(details).replaceAll('</', '<\\/')}\n</hobkin-wake>`;

/** Sessions the agent asked with `--wake` to hear about, told as the next message would have told them. */
export const sessionsBrief = sessions => brief({ sessions });

/**
 * What the main agent's own schedules found (056-agent-schedules), each as `wakeForAgent` gives it, cut to fit `most`
 * characters: each output loses its start before anything else goes.
 */
export const agentSchedulesBrief = (wakes, most) => fittedWakes(wakes, schedules => brief({ schedules }), most);

/** Commands the agent scheduled that failed, for it to fix or cancel. */
export const scheduledBrief = failures => brief({ scheduled: failures.slice(0, MOST_TOLD) });

/** Work the user chose on a card that work mode cannot start, for the agent to hand to a session of its own. */
export const handOffBrief = jobs => brief({ handOff: jobs });

/** Durable hobkins that stopped and wait on a user who has not looked, for the agent to tell the user about. */
export const hobkinsBrief = hobkins => brief({ hobkins: hobkins.map(({ id, title, status, said }) => ({ id, title, status, said })) });

/** Messages durable hobkins sent the agent with `hobkin tell`: who sent each, by the id to answer with, and its words. */
export const messagesBrief = messages => brief({ messages: messages.map(({ from, title, text, at }) => ({ from, title, text, at })) });

const isScheduledRun = message => message?.role === 'custom' && message.customType === 'scheduled-task' && Boolean(message.details?.result);

/** A scheduled run that finished cleanly tells the user nothing, because the agent speaks when what it waited for comes. */
export const isQuietScheduledRun = message => isScheduledRun(message) && message.details.result.ok === true;

/** A scheduled command that failed, from the scheduler's own message: which task, what it ran and how it ended. Anything else is null. */
export function scheduledFailure(message) {
  if (!isScheduledRun(message) || message.details.result.ok !== false || !message.details.task?.id) return null;
  const { task, result } = message.details;
  return {
    taskId: task.id,
    name: task.name ?? null,
    command: result.command ?? null,
    exitCode: result.code ?? null,
    killed: Boolean(result.killed),
    output: String(result.stderr || result.stdout || '').slice(-LONGEST_OUTPUT),
  };
}

/** The same command failing the same way is one failure, however often it runs. A changed command that fails is a new one. */
export const failureKey = ({ taskId, command, exitCode, killed }) => JSON.stringify([taskId, command, exitCode, killed]);
