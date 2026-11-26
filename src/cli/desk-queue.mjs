import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicJson, loadConfig } from './config.mjs';
import { dayLoad, readDay, TOO_FULL } from './day.mjs';
import { deliveryFor, digestDue, learnMoments, learnQuietHours } from './desk.mjs';
import { readEvents, recordEvent } from './events.mjs';
import { readVersioned } from './file-version.mjs';
import { isPresent } from './pending.mjs';

/**
 * The desk's queue (075-chief-of-staff S3 to S5 and S13). Every line new to Chat comes here first. What cannot wait posts now or at the
 * user's next pause, what can wait is held in `runtime/desk.json` for the next digest, and P3 is only logged. A digest is one Chat message.
 * The file holds the lines as they would have posted, so it is the user's own data, never telemetry:
 *
 *   {
 *     "version": 1,
 *     "held": [{ "id", "source", "level", "delivery", "heldAt", "notice" }],  waiting for a digest or a pause
 *     "posting": [notice],               let go and not yet in a saved view, so a crash in between posts them again rather than never
 *     "seen": { "<notice id>": "<when>" },  what the desk took, so a line worked out again on each refresh is taken once
 *     "lastDigestAt": "..."
 *   }
 *
 * `"desk": { "enabled": false }` in config.json turns it off, and Chat posts as before. Without a presence source nothing could time a
 * digest, so the desk stands aside then too. Nothing here throws: when the desk cannot work, the lines post as before.
 */
export const deskPath = root => join(root, 'runtime', 'desk.json');

const MINUTE_MS = 60000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const VERSION = 1;
// The moments and quiet hours move slowly, so the desk learns them again at most once an hour, from two weeks of presence.
const LEARN_EVERY_MS = HOUR_MS;
const LEARN_DAYS = 14;
const SEEN_MS = 14 * DAY_MS;
const LONGEST_LINE = 300;
// Lines that answer what the user just did, and the one that says once what usage upload sends. None of them is an incoming item.
const REPLIES = new Set(['answer', 'brief', 'card', 'feedback', 'memory', 'telemetry-upload']);
// A notice's tone is the triage the desk levels by. A quiet line is news that can wait, never nothing.
const TRIAGE = { critical: 'critical', blocked: 'blocked', useful: 'useful', quiet: 'useful' };
const RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };
// What waiting work takes of the day, as the morning brief counts it: about 15 minutes a review and 5 a decision. P1 work that lands counts as a review.
const MINUTES_FOR = { read: 15, ready: 15, yours: 15, wrong: 15, questions: 5, todo: 5 };
const LANDED_MINUTES = 15;

const plural = (amount, noun, many = `${noun}s`) => `${amount} ${amount === 1 ? noun : many}`;
// What can move to another day, least important first. What went wrong, P1 work and meetings with others never move.
const MOVABLE = [
  ['read', amount => `${plural(amount, 'branch', 'branches')} to read`],
  ['yours', amount => `${plural(amount, 'step')} of your own`],
  ['ready', amount => `${plural(amount, 'change')} ready to land`],
  ['todo', amount => `${plural(amount, 'thing')} to do`],
  ['questions', amount => plural(amount, 'question')],
];

const iso = time => new Date(time).toISOString();
const sourceOf = ({ id }) => String(id ?? '').split(':')[1] ?? '';
// One line whatever was written, so nothing in it can pass for a line of its own.
const flat = text => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, LONGEST_LINE);
const withoutDeskFacts = ({ blocksWork, ...notice }) => notice;
const isItem = notice => ['notice', 'system'].includes(notice.role) && !REPLIES.has(sourceOf(notice));

/** The item the desk levels: its source, its triage, and whether work is stopped until the user acts. */
function itemOf(notice) {
  const source = sourceOf(notice);
  // Work mode stops at its limit until the user answers, and a work run that went critical stops its item.
  const blocksWork = notice.blocksWork === true || (source === 'work-allowance' && notice.tone === 'critical');
  return { source, triage: TRIAGE[notice.tone] ?? 'useful', blocksWork };
}

const savedConfigs = new Map();

/** On unless config.json says `"desk": { "enabled": false }`. A configuration that cannot be read turns it off, so Chat posts as before. */
export function deskEnabled(root) {
  const config = readVersioned(savedConfigs, join(root, 'config.json'), () => {
    try {
      return loadConfig(root);
    } catch {
      return null;
    }
  }, 16);
  return Boolean(config) && config.desk?.enabled !== false;
}

/** The queue as saved. No file is an empty desk. A file that cannot be read throws, so the caller posts as before and the file stays as it is. */
function readQueue(root) {
  let text;
  try {
    text = readFileSync(deskPath(root), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { version: VERSION, held: [], posting: [], seen: {}, lastDigestAt: null };
    throw error;
  }
  const saved = JSON.parse(text);
  return {
    version: VERSION,
    held: Array.isArray(saved.held) ? saved.held : [],
    posting: Array.isArray(saved.posting) ? saved.posting : [],
    seen: saved.seen && typeof saved.seen === 'object' ? saved.seen : {},
    lastDigestAt: saved.lastDigestAt ?? null,
  };
}

function writeQueue(root, queue, now) {
  const since = now - SEEN_MS;
  const seen = Object.fromEntries(Object.entries(queue.seen).filter(([, at]) => Date.parse(at) >= since));
  atomicJson(deskPath(root), { ...queue, seen });
}

/** What the desk holds for the next digest, oldest first, for `hobkin pending`. Nothing when it cannot be read. */
export function readHeld(root) {
  try {
    return readQueue(root).held.map(({ level, heldAt, notice }) => ({ level, content: notice?.content ?? '', at: heldAt }));
  } catch {
    return [];
  }
}

const byLevelThenAge = (left, right) => RANK[left.level] - RANK[right.level] || Date.parse(left.heldAt) - Date.parse(right.heldAt);

/**
 * One Chat message for what the desk held: the point first, then one line per item, those for today before those that can wait, oldest
 * first within each. `room`, when P1 work landed on a day too full, is the line that says what to move, right after the point. `digest`
 * marks it as one row, with each item's level and what lets the window act on a line, such as a memory's Undo or the review it names.
 */
export function digestMessage(held, { now, room = null }) {
  const items = held.toSorted(byLevelThenAge);
  const today = items.filter(({ level }) => RANK[level] <= RANK.P1).length;
  const wait = items.length - today;
  const counts = [today && `${today} for today`, wait && `${wait} that can wait`].filter(Boolean).join(', ');
  const content = [`Digest: ${counts}.`, ...(room ? [room] : []), ...items.map(({ notice }) => `- ${flat(notice.content)}`)].join('\n');
  const at = iso(now);
  const levels = {};
  for (const { level } of items) levels[level] = (levels[level] ?? 0) + 1;
  return {
    id: `notice:digest:${at}`,
    role: 'notice',
    tone: today ? 'useful' : 'quiet',
    content,
    digest: {
      levels,
      items: items.map(({ id, level, notice }) => ({
        id, level, content: flat(notice.content), ...(notice.memory ? { memory: notice.memory } : {}), ...(notice.review ? { review: notice.review } : {}),
      })),
    },
    at,
  };
}

const clockIn = (time, timeZone) => new Date(time).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(timeZone ? { timeZone } : {}) });

/**
 * What to move so today fits once P1 work landed (075 S13), as one line, or null when none landed or the day fits. The load is the day's
 * events, what waits in `hobkin pending` (`groups`) and the P1 work that landed, against what the day holds (`dayLoad`). The moves come
 * least important first, until the day fits: the waiting work that can wait, then the user's own blocks that have not begun, latest first.
 */
export function roomLine({ day, groups = [], landed = 0, now }) {
  if (!landed) return null;
  const counts = Object.fromEntries(groups.map(({ name, count }) => [name, count]));
  const waitingMinutes = Object.entries(MINUTES_FOR).reduce((sum, [name, minutes]) => sum + (counts[name] ?? 0) * minutes, 0) + landed * LANDED_MINUTES;
  const load = dayLoad(day, { waitingMinutes });
  if (!load.tooFull) return null;

  const fits = load.capacityMinutes * TOO_FULL;
  const ownBlocks = (day?.events ?? [])
    .filter(({ start, withOthers }) => !withOthers && Date.parse(start) > now)
    .toSorted((left, right) => Date.parse(right.start) - Date.parse(left.start))
    .map(({ start, end }) => ({ words: `your ${clockIn(start, day.timezone)} block`, minutes: (Date.parse(end) - Date.parse(start)) / MINUTE_MS }));
  const candidates = [
    ...MOVABLE.flatMap(([name, words]) => (counts[name] ? [{ words: words(counts[name]), minutes: counts[name] * MINUTES_FOR[name] }] : [])),
    ...ownBlocks,
  ];
  let left = load.loadMinutes;
  const moves = [];
  for (const { words, minutes } of candidates) {
    if (left < fits) break;
    moves.push(words);
    left -= minutes;
  }
  const said = `Today is too full: about ${Math.round(load.loadMinutes / 60)} of ${load.capacityMinutes / 60} hours (${Math.round(load.ratio * 100)}%).`;
  if (!moves.length) return `${said} Nothing waiting on you can move to make room.`;
  return `${said} To make room, move ${moves.join(', then ')}${left >= fits ? ', and it still does not fit' : ''}.`;
}

/**
 * The desk of one running hobkin. `route` takes the lines new to Chat on each refresh, `look` comes on each look for the user's return,
 * and `markPosted` once the view that holds what was let go is saved. `waiting` reads what waits in `hobkin pending`, for the room line.
 */
export class Desk {
  constructor({ root, now = Date.now, waiting = () => null, timeZone } = {}) {
    Object.assign(this, { root, now, waiting, timeZone, posting: [], learned: null });
  }

  /** The digest moments and quiet hours learned from presence, again at most once an hour. */
  learn(now) {
    if (this.learned && now - this.learned.at >= 0 && now - this.learned.at < LEARN_EVERY_MS) return this.learned;
    const presence = readEvents(this.root, { since: now - LEARN_DAYS * DAY_MS }).filter(({ type }) => type === 'presence');
    const options = { now, days: LEARN_DAYS, ...this.zone() };
    this.learned = { at: now, moments: learnMoments(presence, options).moments, quiet: learnQuietHours(presence, options).hours };
    return this.learned;
  }

  zone() {
    return this.timeZone ? { timeZone: this.timeZone } : {};
  }

  /** What every delivery is judged against at `now`. The user is at a pause when they are away, or here with a free screen and an idle chat. */
  context(now, presence, busy) {
    const { moments, quiet } = this.learn(now);
    const present = isPresent(presence, now);
    return { now, moments, quiet, day: readDay(this.root, now), present, atPause: !present || (!presence.occupied && !busy), ...this.zone() };
  }

  /** Each item held for a pause that has now come, or whose wait is over, moves to `posting`. One that must now wait for a digest says so. */
  release(queue, context, events) {
    const kept = [];
    for (const entry of queue.held) {
      if (entry.delivery !== 'breakpoint') {
        kept.push(entry);
        continue;
      }
      const { delivery } = deliveryFor({}, { ...context, level: entry.level });
      if (delivery === 'now' || (delivery === 'breakpoint' && context.atPause)) {
        queue.posting.push({ ...entry.notice, level: entry.level, at: iso(context.now) });
        events.push(['desk_posted', { source: entry.source, level: entry.level, delivery, waitedMs: context.now - Date.parse(entry.heldAt) }]);
      } else {
        kept.push(delivery === entry.delivery ? entry : { ...entry, delivery });
      }
    }
    const changed = kept.length !== queue.held.length || kept.some((entry, index) => entry !== queue.held[index]);
    queue.held = kept;
    return changed;
  }

  /** Writes the queue, then records what it did, so an event never tells of a hold that was not saved. */
  save(queue, events, now) {
    writeQueue(this.root, queue, now);
    for (const [type, facts] of events) recordEvent(this.root, type, facts, now);
  }

  /**
   * What of `fresh`, the lines new to Chat in this refresh, posts now, with what the desk let go since and is not `inChat` already. Each
   * line the desk lets through carries its `level`. With the desk off, or no `presence` to time a digest, everything posts as before,
   * and so does what it held. When anything here goes wrong, `fresh` posts as before and the queue stays as it was.
   */
  route(fresh, { presence, busy = false, inChat = new Set() } = {}) {
    const plain = fresh.map(withoutDeskFacts);
    try {
      const now = this.now();
      const queue = readQueue(this.root);
      const events = [];
      const post = [];
      let changed = false;
      if (!presence || !deskEnabled(this.root)) {
        changed = queue.held.length > 0;
        queue.posting.push(...queue.held.map(({ notice }) => ({ ...notice, at: iso(now) })));
        queue.held = [];
        post.push(...plain);
      } else {
        const context = this.context(now, presence, busy);
        changed = this.release(queue, context, events);
        const taken = new Set([...Object.keys(queue.seen), ...queue.held.map(({ id }) => id)]);
        fresh.forEach((notice, index) => {
          const line = plain[index];
          if (!isItem(line)) {
            post.push(line);
            return;
          }
          if (taken.has(line.id)) return;
          const item = itemOf(notice);
          const { delivery, level } = deliveryFor(item, context);
          if (delivery === 'now' || (delivery === 'breakpoint' && context.atPause)) {
            post.push({ ...line, level });
            events.push(['desk_posted', { source: item.source, level, delivery, waitedMs: 0 }]);
            return;
          }
          taken.add(line.id);
          queue.seen[line.id] = iso(now);
          if (delivery !== 'log') queue.held.push({ id: line.id, source: item.source, level, delivery, heldAt: iso(now), notice: line });
          events.push(['desk_held', { source: item.source, level, delivery }]);
        });
      }
      if (changed || events.length) this.save(queue, events, now);
      this.posting = queue.posting.map(({ id }) => id);
      return [...post, ...queue.posting.filter(({ id }) => !inChat.has(id))];
    } catch {
      this.posting = [];
      return plain;
    }
  }

  /** What `route` let go is in a saved view now, so it leaves the queue. */
  markPosted() {
    if (!this.posting.length) return;
    const posted = new Set(this.posting);
    this.posting = [];
    try {
      const queue = readQueue(this.root);
      queue.posting = queue.posting.filter(({ id }) => !posted.has(id));
      writeQueue(this.root, queue, this.now());
    } catch {
      // It posts again on the next refresh, and its id keeps Chat from showing it twice.
    }
  }

  /**
   * A look for the user, as each look for their return makes one: a digest when one is due, at a learned moment, on a return after a gap
   * (`returned` is the presence the look recorded, if any) or at a pause once what is held can wait no longer, and each held item whose
   * pause came. Answers whether Chat has something new.
   */
  look({ presence, returned = null, busy = false } = {}) {
    try {
      if (!presence || !deskEnabled(this.root)) return false;
      const now = this.now();
      const queue = readQueue(this.root);
      const context = this.context(now, presence, busy);
      const events = [];
      let changed = this.release(queue, context, events);
      if (queue.held.length) {
        const lastDigest = Date.parse(queue.lastDigestAt ?? '');
        const due = digestDue({ ...context, lastDigest: Number.isFinite(lastDigest) ? lastDigest : -Infinity, awayMs: returned?.awayMs, held: queue.held });
        if (due.due) {
          const held = queue.held;
          const landed = held.filter(({ level }) => RANK[level] <= RANK.P1).length;
          const digest = digestMessage(held, { now, room: landed ? this.room(context, landed) : null });
          queue.posting.push(digest);
          queue.held = [];
          queue.lastDigestAt = iso(now);
          events.push(['digest_posted', { items: held.length, ...digest.digest.levels, why: due.why }]);
          changed = true;
        }
      }
      if (changed) this.save(queue, events, now);
      return changed;
    } catch {
      return false;
    }
  }

  /** The room line for this digest. Trouble reading what waits costs the digest that line and nothing else. */
  room({ day, now }, landed) {
    try {
      return roomLine({ day, groups: (this.waiting()?.groups ?? []).filter(({ name }) => name !== 'held'), landed, now });
    } catch {
      return null;
    }
  }
}
