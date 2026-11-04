import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LOG = 'card-actions.jsonl';
// Well under what a message can carry, and the rest go with the next one.
const MOST_IN_A_NOTE = 10;

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

export const cardActionsToPost = root => readLog(root).filter(({ posted }) => !posted);

/** Everything the user did from a card, oldest first, for counting what got done. */
export const allCardActions = root => readLog(root);

/** A system line, because it says back what the user did, in full. */
export const cardActionNotice = ({ id, line, at }) => ({ id: `notice:card:${id}`, role: 'system', content: line, at });

/** Marked only once the view holding the line is saved, so a crash in between posts it again rather than never. Its id stops a second copy. */
export const markCardActionsPosted = (root, actions) => actions.forEach(({ id }) => append(root, { id, posted: true }));

/** What the main agent has yet to hear, oldest first. */
export const cardActionsToTell = root => readLog(root).filter(({ heard }) => !heard).slice(0, MOST_IN_A_NOTE);

export const markCardActionsHeard = (root, actions) => actions.forEach(({ id }) => append(root, { id, heard: true }));

/** What the main agent hears of, from `since` on, oldest first, whether or not it has heard it yet. */
export const cardActionsSince = (root, since) => readLog(root)
  .filter(action => !action.chatOnly && Date.parse(action.at) >= since);
