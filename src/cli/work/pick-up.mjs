import { answerDecision, fileDecision, openDecisions } from '../decisions.mjs';
import { reply } from './controls.mjs';
import { planWork } from './plan.mjs';
import { ownerView, pickNext, readMode, writeMode } from './store.mjs';

// What turning work mode on asks when auto-pick is off: the next few rows the queue would start, for the user to pick before anything runs.
const KEY = 'pickup';
const PICK_UP_SIZE = 4;
const LONGEST_TITLE = 70;

// Titles come from agents, and these reach the terminal.
const plain = text => String(text ?? '').replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ').trim();
const shortTitle = title => (title.length > LONGEST_TITLE ? `${title.slice(0, LONGEST_TITLE - 1).trimEnd()}…` : title);

/** A row the user already picked starts anyway, and one that waits on something cannot start, so neither is offered. */
const canOffer = ({ skipped, waiting, picked }) => !skipped && !waiting && !picked;

function rowLine({ grade, project, title, why }, index) {
  const reason = why ? ` (${plain(why)})` : '';
  return `${index + 1}. ${[grade, `${plain(project)}:`].filter(Boolean).join(' ')} ${shortTitle(plain(title))}${reason}`;
}

function pickUpQuestion(rows, { left, picked }) {
  const earlier = picked ? [`${picked} you picked earlier start first.`] : [];
  const behind = left ? [`${left} more wait behind ${rows.length === 1 ? 'it' : 'these'}.`] : [];
  return ['Work mode is on, and nothing new starts by itself. Next in the queue:', ...rows.map(rowLine), ...earlier, ...behind].join('\n');
}

/** Not now comes first, because a question left alone takes no action. */
function pickUpChoices(rows) {
  const several = rows.length > 1;
  return [
    { value: 'later', label: 'Not now' },
    { value: 'these', label: several ? `Start these ${rows.length}` : 'Start it' },
    ...(several ? [{ value: 'first', label: 'Start the first one' }] : []),
    { value: 'auto', label: 'Let it run the whole queue' },
  ];
}

/** Turning the mode on with auto-pick off asks what to start, from the queue as it stands. With auto-pick on, the queue runs as it always did. */
export function filePickUp(root, now = Date.now()) {
  const mode = readMode(root);
  if (!mode.enabled || mode.autoPick) return false;

  const { entries } = planWork(root, { ...ownerView(root, now), mode, now });
  const offered = entries.filter(canOffer);
  const rows = offered.slice(0, PICK_UP_SIZE);
  if (!rows.length) return false;

  const counts = { left: offered.length - rows.length, picked: entries.filter(({ picked }) => picked).length };
  fileDecision(root, {
    key: KEY,
    from: 'Work mode',
    question: pickUpQuestion(rows, counts),
    tldr: `Pick what work mode starts: ${offered.length} waiting in the queue`,
    choices: pickUpChoices(rows),
    answerTo: { kind: KEY, keys: rows.map(({ key }) => key) },
  }, now);
  return true;
}

/** A pick-up says nothing new starts by itself, so once auto-pick is on or the mode is off it no longer holds, and it closes as not now. */
export function retirePickUp(root, now = Date.now()) {
  const { enabled, autoPick } = readMode(root);
  if (enabled && !autoPick) return;
  for (const { id, answerTo } of openDecisions(root)) {
    if (answerTo?.kind === KEY) answerDecision(root, id, 'later', now);
  }
}

/** Carries out the answer, and only code calls this: the keys come from the decision hobkin filed. */
export function answerPickUp(root, value, keys) {
  if (value === 'auto') {
    writeMode(root, { autoPick: true });
    return reply('Auto-pick is on, so the queue runs from the top by itself.');
  }

  const picked = { these: keys, first: keys.slice(0, 1) }[value] ?? [];
  for (const key of picked) pickNext(root, key);
  if (!picked.length) return reply('Nothing new starts until you pick from the queue in the Work tab.');
  return reply(picked.length === 1 ? 'It starts next.' : `These ${picked.length} start in turn.`);
}
