import { answerDecision, fileDecision, openDecisions } from '../decisions.mjs';
import { mergeItem, reply, requestReview } from './controls.mjs';
import { heldByItsGrade, ratingWords, readyItems, weakEarlierWork } from './reads.mjs';
import { pileOf, shipFirst } from './ship.mjs';
import { localDay, readItems, readMode, readProject, retryItem, runnableStates, updateItem, writeMode } from './store.mjs';
import { readUnmerged } from './unmerged.mjs';

const KEY = 'pair';
const PAIR_SIZE = 2;
const LONGEST_TITLE = 70;
const QUIET_MS = 2 * 3600000;
const MOST_REMEMBERED = 200;
const REBASE_NOTE = 'This branch conflicts with the default branch. Rebase it so both sides\' intent survives, and add nothing else.';
const yesDoes = { land: 'Yes merges it here and pushes nothing', rebase: 'Yes sends an agent to rebase it', review: 'Yes reviews it' };

// Titles come from agents, and these reach the terminal.
const plain = text => String(text).replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ').trim();
const shortTitle = title => (title.length > LONGEST_TITLE ? `${title.slice(0, LONGEST_TITLE - 1).trimEnd()}…` : title);
const timeAt = time => new Date(time).toISOString();
const allRows = root => readyItems(root, Infinity);
const openPair = root => openDecisions(root).find(({ key }) => key === KEY);
const writeShip = (root, change) => writeMode(root, { ship: { ...readMode(root).ship, ...change } });
const rowKey = ({ slug, item }) => `${slug}:${item}`;
const triedKey = ({ slug, item, step, head }) => `${slug}:${item}:${step}:${head}`;

/** Merging a branch brings what it was built on, so earlier work a review held back takes the row's place, for its review, before a yes can land it. */
function rowToMove(row, rows, units) {
  if (heldByItsGrade(row)) return row;
  const weak = weakEarlierWork(row, units);
  if (!weak) return row;
  return rows.find(other => other.slug === row.slug && other.branch === weak.branch) ?? row;
}

/**
 * A grade is information, so work with proof lands whatever its grade, at the commit the survey read. Only what a review rated below safe at this
 * commit, or brings with it, takes a review, because a review run fixes what it finds and grades the result. Work with no proof, or no commit the
 * survey read, has nothing for a yes to stand on, so no pair brings it.
 */
function stepOf(row, units) {
  if (row.conflict) return 'rebase';
  if (heldByItsGrade(row) || weakEarlierWork(row, units)) return 'review';
  if (!row.head || row.proved === false) return null;
  return 'land';
}

const moveFrom = (row, units) => ({ row, slug: row.slug, item: row.item, head: row.head, step: stepOf(row, units) });

/** The top two of the pile that yes can move. A row a yes already took at this commit stays out, so a review that changed nothing is not paid for twice. */
function nextMoves(root, rows, { ship = {} }) {
  const { projects } = readUnmerged(root);
  const unitsOf = ({ slug }) => projects[slug]?.open ?? [];
  const offered = new Set(openDecisions(root).map(({ key }) => key));
  const tried = new Set(ship.tried ?? []);
  const moves = pileOf(rows)
    .filter(row => !offered.has(`offer:${rowKey(row)}`))
    .map(row => rowToMove(row, rows, unitsOf(row)))
    .map(row => moveFrom(row, unitsOf(row)))
    .filter(({ step }) => step)
    .filter(move => !tried.has(triedKey(move)))
    .filter((move, index, all) => all.findIndex(other => rowKey(other) === rowKey(move)) === index);
  return moves.slice(0, PAIR_SIZE);
}

function moveLine({ row, step }) {
  const rating = row.conflict ? 'it conflicts with the default branch' : ratingWords(row);
  return `${plain(row.project)}: ${shortTitle(plain(row.title))}. ${rating[0].toUpperCase()}${rating.slice(1)}. ${yesDoes[step]}.`;
}

function pairDecision(moves, left) {
  const two = moves.length === PAIR_SIZE;
  return {
    key: KEY,
    from: 'Work mode',
    question: [...moves.map(moveLine), `${left} more wait behind ${two ? 'these two' : 'this one'}.`].join('\n'),
    tldr: `Get the next ${two ? 'two' : 'one'} moving, ${left} more behind`,
    choices: [
      { value: 'later', label: 'Later' },
      { value: 'go', label: two ? 'Do these two' : 'Do this one' },
      { value: 'read', label: 'Read them first' },
      { value: 'new', label: 'Start new work anyway' },
    ],
    answerTo: { kind: KEY, rows: moves.map(({ row, ...move }) => move) },
  };
}

/** A yes has moved a row once no agent is on it. Without a yes only the row leaving the list moves it. A project nobody can run on cannot hold up the next pair. */
function hasMoved(root, { slug, item }, saidYes) {
  const project = readProject(root, slug);
  const found = readItems(root, slug).find(({ id }) => id === item);
  if (!found || project?.state !== 'chosen' || project.paused) return true;
  return found.state === 'branch' ? saidYes : !runnableStates.includes(found.state);
}

function pairDue(root, { pairsAfter, last }, now) {
  if (pairsAfter && Date.parse(pairsAfter) > now) return false;
  if (!last) return true;
  if (last.until && Date.parse(last.until) <= now) return true;
  return last.rows.every(row => hasMoved(root, row, !last.until));
}

/** Brings the next two, one decision at a time, and only once the last two have moved. */
export function bringPair(root, now = Date.now()) {
  const mode = readMode(root);
  if (openPair(root) || !pairDue(root, mode.ship ?? {}, now)) return false;
  const rows = allRows(root);
  if (!shipFirst(rows, mode, now).holding) return false;
  const moves = nextMoves(root, rows, mode);
  if (!moves.length) return false;
  fileDecision(root, pairDecision(moves, Math.max(0, pileOf(rows).length - moves.length)), now);
  return true;
}

/** Turning the mode on over the bar is said by whoever turned it on, so only the pair is left to do here. */
export function fileFirstPair(root, now = Date.now()) {
  const { holding, line } = shipFirst(allRows(root), readMode(root), now);
  if (!holding) return null;
  writeShip(root, { said: timeAt(now) });
  bringPair(root, now);
  return line;
}

/** Each tick with the mode on. Crossing the bar is said once in Chat, and pairs follow for as long as the pile stays. */
export function watchPile(root, { holding, line }, now = Date.now()) {
  const { said } = readMode(root).ship ?? {};
  if (!holding) {
    if (said) writeShip(root, { said: null });
    return;
  }
  if (!said) writeShip(root, { said: timeAt(now), notice: { at: timeAt(now), line } });
  bringPair(root, now);
}

function sendToRebase(root, { slug, item }) {
  updateItem(root, slug, item, { workNote: REBASE_NOTE });
  retryItem(root, slug, item);
  return reply('An agent goes back to rebase it next.');
}

async function moveRow(root, row, now) {
  const { slug, item, head, step } = row;
  // A pair moves through work mode's own queue, as its rebase does, so its reply holds no hand-off to the main agent.
  if (step === 'review') return requestReview(root, slug, item, { toMainAgent: false });
  if (step === 'rebase') return sendToRebase(root, row);
  return mergeItem(root, slug, item, { route: KEY, head, now });
}

// Whatever else a row has become, it either goes or says why it cannot.
function alreadyMoved(root, { slug, item }) {
  const { state } = readItems(root, slug).find(({ id }) => id === item) ?? {};
  return [undefined, 'merged', 'declined', 'dropped'].includes(state);
}

const messageOf = ({ message }) => message;

/** That yes is the user's word on exactly these two. One that cannot go stays where it is and says why, and the other still goes. They run in turn, because a merge can bring the other along. */
async function movePair(root, rows, now) {
  const said = [];
  for (const row of rows) {
    if (alreadyMoved(root, row)) continue;
    said.push(await moveRow(root, row, now).then(messageOf, messageOf));
  }
  const line = said.join(' ') || 'Both had already moved, so nothing changed.';
  const remembered = [...readMode(root).ship?.tried ?? [], ...rows.map(triedKey)];
  writeShip(root, { last: { rows }, tried: remembered.slice(-MOST_REMEMBERED), notice: { at: timeAt(now), line } });
  return reply(line);
}

function startNewWork(root, now) {
  writeShip(root, { newWorkOn: localDay(now), said: null });
  return reply('New work can start until the end of today, and hobkin stays quiet about pairs until then.');
}

/** Carries out the answer, and only code calls this: a pair's rows come from the decision hobkin filed. */
export function answerPair(root, value, rows, now = Date.now()) {
  if (value === 'go') return movePair(root, rows, now);
  if (value === 'new') return startNewWork(root, now);
  if (value === 'read') {
    writeShip(root, { last: { rows, until: timeAt(now + QUIET_MS) } });
    return reply('Done is open. The next two come once these have moved.');
  }
  writeShip(root, { pairsAfter: timeAt(now + QUIET_MS), last: null });
  return reply('The next two come in two hours.');
}

/** `hobkin work ship`. Off is the same as answering `new`, so the open pair closes with it. */
export function setShipFirst(root, word, now = Date.now()) {
  const shipping = shipFirst(allRows(root), readMode(root), now);
  if (word === undefined) return shipping;
  if (!['on', 'off'].includes(word)) throw Error('Say ship on or ship off.');
  if (word === 'on') {
    writeShip(root, { newWorkOn: null, pairsAfter: null });
    const { line } = shipFirst(allRows(root), readMode(root), now);
    return reply(line ?? `Shipping first is on, and new work holds once ${shipping.bar} are finished and waiting. ${shipping.pile} are now.`);
  }
  const open = openPair(root);
  if (open) answerDecision(root, open.id, 'new', now);
  return startNewWork(root, now);
}
