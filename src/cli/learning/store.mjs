import { appendFileSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { atomicJson, learningEnabled } from '../config.mjs';
import { writePrivate } from '../reports.mjs';
import { isLesson, isProposal, lessonsMarkdown, renderLessons } from './lessons.mjs';

const MAX_STATE_BYTES = 1048576;
const MAX_ACTIONS_BYTES = 1048576;
const EMPTY = { judged: null, lessons: [], proposals: [], pullRequests: {} };

const statePath = root => join(root, 'runtime', 'learning.json');
const actionsPath = root => join(root, 'runtime', 'learning-actions.jsonl');
const viewPath = root => join(root, 'runtime', 'lessons.md');

// Whatever can write this file can speak to every agent, so a link or a shared file counts as no file at all.
function readPrivate(file, limit) {
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || (stat.mode & 0o077) || stat.size > limit) return '';
  return readFileSync(file, 'utf8');
}

/** Everything here can be worked out again from the runs, so a damaged file costs one pass, never a session. */
export function readState(root) {
  try {
    const saved = JSON.parse(readPrivate(statePath(root), MAX_STATE_BYTES));
    if (saved?.version !== 1 || !Array.isArray(saved.lessons)) return EMPTY;
    const { judged = null, lessons, proposals, pullRequests } = saved;
    return {
      judged,
      lessons: lessons.filter(isLesson),
      proposals: Array.isArray(proposals) ? proposals.filter(isProposal) : [],
      pullRequests: pullRequests && typeof pullRequests === 'object' ? pullRequests : {},
    };
  } catch {
    return EMPTY;
  }
}

export const saveState = (root, state) => atomicJson(statePath(root), { version: 1, ...state });

function keepNewestLines(file) {
  const text = readFileSync(file, 'utf8');
  writePrivate(file, text.slice(text.indexOf('\n', text.length - MAX_ACTIONS_BYTES / 2) + 1));
}

/** What cannot be worked out again: the user's answers and clears. Another process can write at once, so this only ever grows. */
export function appendAction(root, action) {
  const file = actionsPath(root);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...action })}\n`, { mode: 0o600 });
  if (statSync(file).size > MAX_ACTIONS_BYTES) keepNewestLines(file);
}

export function readActions(root) {
  let text = '';
  try {
    text = readPrivate(actionsPath(root), MAX_ACTIONS_BYTES);
  } catch {
    // No answers can be read, so none are assumed.
  }
  const events = text.split('\n').flatMap(entry => {
    try {
      const event = JSON.parse(entry);
      return event?.type && Number.isFinite(Date.parse(event.at)) ? [event] : [];
    } catch {
      return [];
    }
  });
  const ofType = type => events.filter(event => event.type === type);
  return {
    clears: ofType('clear'),
    answers: ofType('answer'),
    posted: ofType('posted'),
    rejected: new Set(ofType('reply').map(({ id }) => id)),
  };
}

export const clearedAt = (clears, scope) => Math.max(0, ...clears
  .filter(clear => clear.all || clear.scope === scope)
  .map(clear => Date.parse(clear.at)));

/** A clear or an answer shows at once, even with no owner running to work everything out again. */
export function learningState(root) {
  const state = readState(root);
  const { clears, answers } = readActions(root);
  const stands = ({ scope, latest }) => Date.parse(latest) > clearedAt(clears, scope);
  // A later hides a proposal only until the learner raises it again, which gives it a newer time.
  const answered = ({ id, at }) => answers.some(answer => answer.id === id
    && (answer.answer !== 'later' || Date.parse(answer.at) >= Date.parse(at)));
  return {
    ...state,
    lessons: state.lessons.filter(stands),
    proposals: state.proposals.filter(proposal => stands(proposal) && !answered(proposal)),
  };
}

/** What a session started now is given. Read each time, so turning learning off reaches the next session. */
export const injectedLessons = (root, scope) => (learningEnabled(root) ? renderLessons(learningState(root).lessons, scope) : []);

/** With learning off, search finds as little as a session gets. qmd keeps the last text of an empty file, so nothing to show removes the file. */
export function writeLessonsView(root) {
  const file = viewPath(root);
  const text = learningEnabled(root) ? lessonsMarkdown(learningState(root).lessons) : '';
  if (!text) rmSync(file, { force: true });
  else if (readPrivate(file, MAX_STATE_BYTES) !== text) writePrivate(file, text);
}
