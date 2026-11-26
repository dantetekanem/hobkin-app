import { answerPromotion } from './autonomy.mjs';
import { noteForCheck } from './checks.mjs';
import { answerDecision, decisionRow, findOpenDecision, handDecision, isActionItem, openDecisions } from './decisions.mjs';
import { ROUTINE_ASKS } from './routine-care.mjs';
import { recordEvent } from './events.mjs';
import { handAnswer, remindTomorrow } from './inbox.mjs';
import { answerOffer, askAgent } from './work/controls.mjs';
import { answerDeploy } from './work/deploys.mjs';
import { answerPair } from './work/pairs.mjs';
import { answerPickUp } from './work/pick-up.mjs';
import { findItem, findProject } from './work/names.mjs';
import { answerSubscriptionPause } from './work/subscription.mjs';

const USAGE = 'Say `hobkin decisions` to list what is open, or `hobkin decisions answer <id> <value>`, with `--typed "<their words>"` in place of the value for an answer in their own words.';

function chosen(decision, value) {
  const choice = decision.choices.find(entry => entry.value === value);
  if (!choice) throw Error(`That is not one of its choices: ${decision.choices.map(entry => entry.value).join(', ')}.`);
  return choice;
}

/** What hobkin's own questions do with a choice. Each says what came of it, or nothing. */
function carryOutChoice(root, { answerTo }, value, now) {
  if (answerTo?.kind === 'reminder' && value === 'tomorrow') return remindTomorrow(root, answerTo.id, now);
  if (answerTo?.kind === 'merge') return answerOffer(root, answerTo, value, now);
  if (answerTo?.kind === 'pair') return answerPair(root, value, answerTo.rows, now);
  if (answerTo?.kind === 'deploy') return answerDeploy(root, value, answerTo, now);
  if (answerTo?.kind === 'pickup') return answerPickUp(root, value, answerTo.keys);
  if (answerTo?.kind === 'subscription') return answerSubscriptionPause(root, value, answerTo.until, now);
  if (answerTo?.kind === 'autonomy') return answerPromotion(root, answerTo.taskClass, value, now);
  return null;
}

/**
 * Their own words carry nothing out by themselves, so an offer or a pair holds the way reading it first does: an offer for a day, a pair until
 * its rows have moved. Otherwise it would come straight back while whoever heard the words acts on them.
 */
function holdWhileTheyAct(root, { answerTo }, now) {
  if (answerTo?.kind === 'merge') return answerOffer(root, answerTo, 'later', now);
  if (answerTo?.kind === 'pair') return answerPair(root, 'read', answerTo.rows, now);
  return null;
}

/**
 * Carries out the user's answer to a decision, given on screen or told to the main agent in Chat: one of its choices, or their own words. The
 * asker hears first, in the words the answer came in, so an answer that cannot reach it stays open for another try. A merge that fails is the
 * same: it throws, and the reason goes back to where they answered. Their own words carry out nothing by themselves: whoever hears them acts.
 */
export async function carryOutAnswer(root, id, { value = null, typed = null, deliverMain } = {}, now = Date.now()) {
  const words = typed?.trim() || null;
  if (!value && !words) throw Error('Give one of its choices or their own words.');
  const decision = findOpenDecision(root, id);
  const choice = words ? null : chosen(decision, value);
  const { question, answerTo, at, from } = decision;
  const kind = answerTo?.kind;
  // The desktop path must not acknowledge a choice that has no route. Typed words can still go to Chat.
  const hasHandler = ['work', 'routine', 'outside', 'reminder', 'merge', 'pair', 'deploy', 'pickup', 'subscription', 'chat', 'routines', 'land', 'read'].includes(kind)
    || (kind === 'action' && (answerTo.id || ['done', 'drop', 'hobkin'].includes(value)));
  if (deliverMain && !words && !hasHandler) return { ok: false, unavailable: 'handler' };
  if (deliverMain && kind === 'work') {
    try { findItem(root, findProject(root, answerTo.slug), answerTo.item); }
    catch { return { ok: false, unavailable: 'target' }; }
  }
  const said = words
    ? `The user was asked: ${question} They answered in their own words: ${words}`
    : `The user was asked: ${question} They answered: ${choice.label}`;
  if (answerTo?.kind === 'work') askAgent(root, answerTo.slug, answerTo.item, said, { answering: true });
  if (answerTo?.kind === 'routine') noteForCheck(root, answerTo.id, said);
  // A routine's action item tells that routine. One YOLO readiness filed names no routine, and its next check reads the answer itself.
  if (answerTo?.kind === 'action' && answerTo.id) noteForCheck(root, answerTo.id, `The user answered the action item "${decision.tldr}": ${choice?.label ?? words}.`);
  if (answerTo?.kind === 'outside') handAnswer(root, { from, question, answer: words ?? choice.label }, now);
  // Doing it with hobkin keeps an action item open while the main agent helps, so it is handed on, not answered. It no longer waits on the user.
  const asked = words ? null : ROUTINE_ASKS[value];
  if (!words && value === 'hobkin' && isActionItem(decision)) {
    if (decision.handedAt) return { ok: true, message: 'hobkin already has it in Chat.' };
    if (deliverMain) await deliverMain(decision, 'Help me do this.', true);
    handDecision(root, id, now);
    recordEvent(root, 'action_handed', { id, routine: answerTo?.id }, now);
    return { ok: true, handOff: decision, message: 'The main agent takes it in Chat, and it leaves Action Items.' };
  }
  if (words) await holdWhileTheyAct(root, decision, now);
  const came = words ? null : await carryOutChoice(root, decision, value, now);
  if (deliverMain) {
    if (came?.unavailable) return { ok: false, unavailable: 'target' };
    if (came?.ok === false) return came;
    if (asked && kind === 'routines') await deliverMain(decision, asked, true);
    else if (kind === 'chat' || (words && !['work', 'routine', 'outside'].includes(kind))) await deliverMain(decision, words ?? choice.label);
  }
  answerDecision(root, id, words ? 'typed' : value, now, { typed: words });
  recordEvent(root, 'decision_answered', { id, source: answerTo?.kind, ms: now - Date.parse(at) });
  // An answer that changes a routine or a template goes to the main agent, which makes the change and says what it did.
  if (asked && answerTo?.kind === 'routines') return { ok: true, handOff: decision, handOffText: asked, message: 'The main agent takes it in Chat, and says what it changed.' };
  return came ?? { ok: true, message: words ? 'Answered in their own words.' : `Answered: ${choice.label}.` };
}

/** `hobkin decisions`: what waits in Decisions, and `answer` for the main agent to answer one the user answered in Chat. */
export async function runDecisionsCommand(root, [action, id, value] = [], { typed = null, now = Date.now() } = {}) {
  if (!action) return { decisions: openDecisions(root).map(decisionRow) };
  if (action !== 'answer' || !id || (!value && !typed)) throw Error(USAGE);
  return carryOutAnswer(root, id, { value, typed }, now);
}
