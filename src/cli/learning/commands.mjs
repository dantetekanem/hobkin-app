import { learningEnabled, setLearning } from '../config.mjs';
import { resolveDataRoot } from '../migration/admission.mjs';
import { evidenceText, lessonLine, MAX_TOKENS, renderLessons, requestTokens } from './lessons.mjs';
import { appendAction, learningState, readActions, readState } from './store.mjs';

const USAGE = 'Usage: hobkin learning [on | off | clear <id> | clear all | answer <id> yes|later|no | cover <id> "evidence"]';
const ANSWERS = ['yes', 'later', 'no'];
// A no to work is a no for its whole repo, so the scope `work.<repo>.<kind>` is kept as the repo it names.
const repoOf = scope => (/^work\.[^.]+\./.test(scope) ? scope.split('.').slice(0, 2).join('.') : null);

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;
const plain = text => String(text ?? '').replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ');

function lessonRows(lessons, injected) {
  return lessons.flatMap(lesson => {
    const line = lessonLine(lesson);
    const left = injected.includes(line) ? '' : ', left out by the cap';
    return [`  ${lesson.id}  ${line}`, `          ${lesson.conclusion}: ${evidenceText(lesson)}${left}`];
  });
}

function standing(root, injected, judged) {
  if (!learningEnabled(root)) return 'Learning is off. Nothing is judged, and sessions get nothing. Turn it on with /learning or hobkin learning on.';
  if (injected.length) return `Learning is on. Every session gets ${plural(injected.length - 1, 'lesson')}, about ${requestTokens(injected)} of ${MAX_TOKENS} tokens.`;
  if (judged?.runs) return `Learning is on. ${plural(judged.runs, 'run')} judged, and no pattern has held long enough to teach anything.`;
  return 'Learning is on. Nothing judged yet: it starts the next time Hobkin runs.';
}

/** For a person. Every lesson shows the line agents get, what it rests on and the ID that removes it. */
export function learningView(root) {
  const { lessons, proposals } = learningState(root);
  const injected = renderLessons(lessons);
  const lines = [standing(root, injected, readState(root).judged)];
  if (lessons.length) lines.push('', ...lessonRows(lessons, injected));
  if (proposals.length) {
    lines.push('', 'Proposals, told in Chat one a day:', '');
    for (const proposal of proposals) lines.push(`  ${proposal.id}  ${proposal.kind} ${plain(proposal.title)}: ${evidenceText(proposal)}`);
  }
  if (lessons.length) lines.push('', 'Remove one with hobkin learning clear <id>, or all of them with hobkin learning clear all.');
  return `${lines.join('\n')}\n`;
}

function clear(root, target) {
  if (target === 'all') {
    appendAction(root, { type: 'clear', all: true });
    return { cleared: 'all' };
  }
  const lesson = learningState(root).lessons.find(({ id }) => id === target);
  if (!lesson) throw Error(`No lesson has the ID ${target}. Run hobkin learning to see them.`);
  appendAction(root, { type: 'clear', scope: lesson.scope });
  return { cleared: lesson.id, scope: lesson.scope };
}

/** A yes or a no is the last word. Later only puts the question off, so the answer given when it comes back counts. */
function answer(root, id, choice, now) {
  if (!ANSWERS.includes(choice)) throw Error(USAGE);
  const earlier = readActions(root).answers.find(item => item.id === id && item.answer !== 'later');
  if (earlier) return { id, answer: earlier.answer };

  const proposal = learningState(root).proposals.find(item => item.id === id);
  if (!proposal) throw Error(`No proposal has the ID ${id}. Run hobkin learning to see them.`);
  const { scope, kind, definition } = proposal;
  const repo = choice === 'no' ? repoOf(scope) : null;
  appendAction(root, { type: 'answer', id, answer: choice, scope, kind, definition, ...(repo ? { repo } : {}), at: new Date(now).toISOString() });
  return { id, answer: choice };
}

/** These take no lock: a setting or an appended action is all they write, and the owner picks both up on its next tick. */
export function runLearningCommand(requestedRoot, [action, target, choice, ...extra], { now = Date.now() } = {}) {
  const root = resolveDataRoot(requestedRoot);
  if (extra.length) throw Error(USAGE);
  if (action === undefined) return learningView(root);
  if (action === 'on' || action === 'off') {
    if (target) throw Error(USAGE);
    return setLearning(root, action === 'on');
  }
  if (action === 'cover' && target) {
    if (typeof choice !== 'string' || !choice.trim() || choice.length > 1000) throw Error('Coverage needs evidence of settled scope, up to 1000 characters.');
    const proposal = readState(root).proposals.find(({ id }) => id === target);
    if (!proposal) throw Error('No proposal has that ID.');
    const { scope, kind, definition } = proposal;
    appendAction(root, { type: 'covered', id: target, scope, kind, definition, evidence: choice.trim(), at: new Date(now).toISOString() });
    return { covered: target, scope };
  }
  if (action === 'clear' && target && !choice) return clear(root, target);
  if (action === 'answer' && target) return answer(root, target, choice, now);
  throw Error(USAGE);
}
