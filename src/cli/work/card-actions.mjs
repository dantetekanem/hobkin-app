import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LOG = 'card-actions.jsonl';
// Well under what a message can carry, and the rest go with the next one.
const MOST_IN_A_NOTE = 10;
// A merge's line waits for what follows it (`after-merge.mjs`), so Chat says the merge once with its issue's closing in it. That is longer than
// gh may take to read and close the issue, a minute each, and a line whose follow-up never came goes alone after it.
const LONGEST_WAIT_MS = 150000;

const folderOf = root => join(root, 'work');
// A record made already heard, as the line that sums up a group is, was only ever for Chat.
const forChatAlone = ({ at, heard }) => Boolean(at && heard);

function append(root, event) {
  mkdirSync(folderOf(root), { recursive: true, mode: 0o700 });
  appendFileSync(join(folderOf(root), LOG), `${JSON.stringify(event)}\n`, { mode: 0o600 });
}

function readLog(root) {
  const file = join(folderOf(root), LOG);
  if (!existsSync(file)) return [];
  const actions = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    try {
      const event = JSON.parse(line);
      const action = { ...actions.get(event.id), ...event };
      if (forChatAlone(event)) action.chatOnly = true;
      actions.set(event.id, action);
    } catch {
      // A line cut short by a crash costs that line and nothing else.
    }
  }
  return [...actions.values()];
}

/** What the user did from a card. Chat says it once and the main agent hears it once, and both marks outlive a restart. */
export const recordCardAction = (root, told, now = Date.now()) => append(root, { id: randomUUID(), at: new Date(now).toISOString(), ...told });

const waits = ({ follows, followed, at }, now) => Boolean(follows) && !followed && now - Date.parse(at) < LONGEST_WAIT_MS;

/** What Chat has yet to say, in the order it happened, so a line still waiting for what follows it holds back the lines after it. */
export function cardActionsToPost(root, now = Date.now()) {
  const unposted = readLog(root).filter(({ posted }) => !posted);
  const waiting = unposted.findIndex(action => waits(action, now));
  return waiting < 0 ? unposted : unposted.slice(0, waiting);
}

/** The line a card told this merge in, if it did, with `posted` set once Chat has it. `follows` names the merge as `{ slug, item }`. */
export const cardActionFor = (root, { slug, item }) => readLog(root).findLast(({ follows }) => follows?.slug === slug && follows?.item === item);

/** The merge's line with what followed it. A `tone` of its own, as a close that failed has, makes it hobkin's notice in that tone. */
export const followCardAction = (root, id, { line, tone }) => append(root, { id, line, followed: true, ...(tone ? { tone } : {}) });

/** Everything the user did from a card, oldest first, for counting what got done. */
export const allCardActions = root => readLog(root);

/** A system line, because it says back what the user did, in full, unless what followed it gave it a tone of its own. */
export const cardActionNotice = ({ id, line, at, tone }) => ({ id: `notice:card:${id}`, role: tone ? 'notice' : 'system', content: line, ...(tone ? { tone } : {}), at });

/** Marked only once the view holding the line is saved, so a crash in between posts it again rather than never. Its id stops a second copy. */
export const markCardActionsPosted = (root, actions) => actions.forEach(({ id }) => append(root, { id, posted: true }));

/** What the main agent has yet to hear, oldest first. */
export const cardActionsToTell = root => readLog(root).filter(({ heard }) => !heard).slice(0, MOST_IN_A_NOTE);

export const markCardActionsHeard = (root, actions) => actions.forEach(({ id }) => append(root, { id, heard: true }));

/** What the main agent hears of, from `since` on, oldest first, whether or not it has heard it yet. */
export const cardActionsSince = (root, since) => readLog(root)
  .filter(action => !action.chatOnly && Date.parse(action.at) >= since);
