import { learningEnabled, setLearning } from '../config.mjs';
import { resolveDataRoot } from '../migration/admission.mjs';
import { evidenceText, lessonLine, MAX_TOKENS, renderLessons, requestTokens } from './lessons.mjs';
import { appendAction, learningState, readActions, readState } from './store.mjs';

const USAGE = 'Usage: hobkin learning [on | off | clear <id> | clear all | answer <id> yes|no]';

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

function answer(root, id, choice) {
  if (!['yes', 'no'].includes(choice)) throw Error(USAGE);
  const earlier = readActions(root).answers.find(item => item.id === id);
  if (earlier) return { id, answer: earlier.answer };

  const proposal = learningState(root).proposals.find(item => item.id === id);
  if (!proposal) throw Error(`No proposal has the ID ${id}. Run hobkin learning to see them.`);
  const { scope, kind, definition } = proposal;
  appendAction(root, { type: 'answer', id, answer: choice, scope, kind, definition });
  return { id, answer: choice };
}

/** These take no lock: a setting or an appended action is all they write, and the owner picks both up on its next tick. */
export function runLearningCommand(requestedRoot, [action, target, choice, ...extra]) {
  const root = resolveDataRoot(requestedRoot);
  if (extra.length) throw Error(USAGE);
  if (action === undefined) return learningView(root);
  if (action === 'on' || action === 'off') {
    if (target) throw Error(USAGE);
    return setLearning(root, action === 'on');
  }
  if (action === 'clear' && target && !choice) return clear(root, target);
  if (action === 'answer' && target) return answer(root, target, choice);
  throw Error(USAGE);
}
