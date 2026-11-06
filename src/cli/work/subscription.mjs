import { answerDecision, answeredByUser, fileDecision, openDecisions } from '../decisions.mjs';
import { lookTime } from './chat.mjs';
import { reply } from './controls.mjs';
import { readMode, writeMode } from './store.mjs';

// Work ahead of the subscription's pace is told and asked about. Nothing stops for it until the user says so.
const KEY = 'subscription';
// The longest window there is, so no answer that could still hold is left out.
const WEEK_MS = 7 * 24 * 3600 * 1000;

const usedWords = ({ label, usedPercent, elapsedPercent }) => {
  const window = label === 'window' ? 'the window' : `the ${label} window`;
  const used = `${Math.round(usedPercent)}% of ${window} is used`;
  return Number.isFinite(elapsedPercent) ? `${used}, with ${Math.round(elapsedPercent)}% of its time gone` : used;
};
const sentence = text => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

export const choosesPause = (mode, now) => Boolean(mode.subscriptionPause) && Date.parse(mode.subscriptionPause.until) > now;

/** A keep working the user gave holds until the time its question named, so nothing asks again before then. */
function keptWorking(root, now) {
  return answeredByUser(root, now - WEEK_MS).some(({ answerTo, answer }) => {
    const until = new Date(answerTo?.until ?? 0).getTime();
    return answerTo?.kind === KEY && answer === 'keep' && until > now;
  });
}

/**
 * Once a day for each window, Chat says work is ahead of the subscription's pace and hobkin asks whether to pause until it catches up. Keep working
 * comes first, because a question left alone changes nothing.
 */
export function offerSubscriptionPause(root, ahead, now = Date.now()) {
  const mode = readMode(root);
  const asked = ahead && `${ahead.label}:${new Date(now).toDateString()}`;
  if (!ahead || !mode.enabled || mode.pausedAt || choosesPause(mode, now) || mode.subscriptionAsked === asked) return false;
  if (keptWorking(root, now)) {
    // The day counts as asked, so the ticks after this one skip reading the answers.
    writeMode(root, { subscriptionAsked: asked });
    return false;
  }

  const facts = usedWords(ahead);
  const until = ahead.until ? lookTime(ahead.until, now) : null;
  const pause = until ? `Pause until ${until}` : 'Pause until I resume it';
  const at = new Date(now).toISOString();
  writeMode(root, { subscriptionAsked: asked, pauseNotice: { id: `${KEY}:${asked}`, at, line: `${sentence(facts)}. Work keeps going unless you pause it.`, tone: 'useful' } });
  fileDecision(root, {
    key: `${KEY}:${asked}`,
    from: 'Work mode',
    tldr: until ? `Pause work until ${until} to protect the subscription?` : 'Pause work to protect the subscription?',
    question: `${sentence(facts)}. Pause new work ${until ? `until ${until}` : 'until you resume it'} to protect the subscription, or keep working?`,
    choices: [{ value: 'keep', label: 'Keep working' }, { value: 'pause', label: pause }],
    answerTo: { kind: KEY, until: ahead.until ?? null },
  }, now);
  return true;
}

/** Once the window has caught up, asking to pause for it no longer holds, so the question closes as keep working. */
export function retireSubscriptionPause(root, ahead, now = Date.now()) {
  if (ahead) return;
  for (const { id, answerTo } of openDecisions(root)) {
    if (answerTo?.kind === KEY) answerDecision(root, id, 'keep', now);
  }
}

/** Carries out the answer. A pause the user chose ends by itself at its time, or sooner with hobkin work resume. */
export function answerSubscriptionPause(root, value, until, now = Date.now()) {
  if (value !== 'pause') return reply('Work keeps going.');
  if (!until) {
    writeMode(root, { pausedAt: new Date(now).toISOString() });
    return reply('Paused everywhere until hobkin work resume, to protect the subscription. Running agents finish.');
  }

  writeMode(root, { subscriptionPause: { at: new Date(now).toISOString(), until: new Date(until).toISOString() } });
  return reply(`New work waits until ${lookTime(until, now)} to protect the subscription. Running agents finish, and hobkin work resume starts it sooner.`);
}
