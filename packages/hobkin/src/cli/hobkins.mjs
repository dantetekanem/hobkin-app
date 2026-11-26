import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { canvasSkill, closeCanvas, readCanvases } from './canvas.mjs';
import { loadConfig } from './config.mjs';
import { bindingChange, closeKept, keptCommands } from './harnesses.mjs';
import { turnRunId, turnSchedule } from './hobkin-ids.mjs';
import { answerTell, takeTellRequests, TELL_MAX, TOO_LONG, TURN_HOME, TURN_TOKEN, turnToken } from './hobkin-tell.mjs';
import { MAX_MESSAGE_BYTES } from './runtime.mjs';
import { messagesBrief } from './wake.mjs';
import { imagesProblem } from './paste-image.mjs';
import { efforts, validateBinding } from './schedules.mjs';
import { tierBinding, tierNames } from './tiers.mjs';
import { turnFrom } from './turn-metrics.mjs';
import { keptPrompt } from './prompt-parts.mjs';
import { directionsSection, readDirections } from './directions.mjs';
import { MAIN_INDEX_BYTES, memorySnapshot } from './memories.mjs';
import { memoryHandler } from './memory-tools.mjs';
import { answerMemoryRequest, MEMORY_REQUESTS } from './memory-command.mjs';
import { answerRequest, takeRequests } from './hobkin-tell.mjs';

/**
 * Durable hobkins: the hobkins the user starts with Command+N in the window and talks to directly. Each is one record in
 * the runtime's durable store, beside its runs, and one Pi conversation file under `hobkins/`. A turn is one background
 * run on that file. On Pi, the process a turn ended well in stays up for the next turn while everything it was started
 * with stays the same (`runHarness` in `harnesses.mjs`), and it closes when the hobkin ends, when hobkin closes, or after
 * ten idle minutes. Any other turn starts a process that reopens the file, so a restart loses nothing but the turn in
 * flight. Only the user ends one. See the client's `_specs/034-durable-hobkins`.
 */

export const MOST_HOBKINS = 48;
export const MESSAGE_MAX = 32768;
export const TITLE_MAX = 120;
const MADE_TITLE_MAX = 60;
const SAID_MAX = 600;
// A note to a running job is at most this long (`HobkinRunner.messageCheck`).
const NOTE_MAX = 4096;
// A turn that has just started is not admitted yet, so its run cannot take a message for a moment. This long is waited for it.
const SAY_TRIES = 40;
const SAY_RETRY_MS = 50;
const CUT_OFF = 'It was cut off when hobkin restarted. Send it a message to carry on.';
// What a hobkin is called before anything names it.
const UNNAMED = 'New hobkin';
// Claude Code's model aliases and thinking levels, as the client offers them. `default` is Claude Code's own.
const CLAUDE_MODELS = ['default', 'opus', 'sonnet', 'haiku', 'fable'];
const CLAUDE_EFFORTS = ['default', 'low', 'medium', 'high', 'xhigh', 'max'];
const STOPPED = 'It was stopped before it finished.';

/**
 * One thing the user says allows at most this many messages between hobkins in all. Each turn holds a count: a fresh
 * one when the user's words started it or reached it, and the count of the message that started it otherwise, so every
 * message that follows from one word of the user, however the turns fan out, spends the same three. The counts are
 * kept in hobkin's durable store (`state.hobkinCounts`), so a restart does not reset one.
 */
export const MOST_MESSAGES = 3;
// A count nothing has spent from in this long is dropped. One spent again after that starts full.
const COUNT_KEPT_MS = 30 * 86400000;
// At most this many wait from one sender for one recipient.
const MOST_WAITING = 3;
const MAIN_TITLE = 'the main hobkin';
const TOO_MANY = 'Nothing was sent: what the user last said has already led to three messages between hobkins, which is the most. Say what you wanted to send in your answer to the user instead.';
const NOT_A_TURN = "Nothing was sent: that is not a turn hobkin is running now. hobkin tell works only from a durable hobkin's own turn, while it runs.";
const NO_SUCH = 'Nothing was sent: there is no hobkin with that id.';

const copy = value => JSON.parse(JSON.stringify(value ?? null));
const prompt = name => readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), 'utf8');
const controls = /[\x00-\x1f\x7f]+/g;
const oneLine = text => text.replace(controls, ' ').replace(/\s+/g, ' ').trim();
const clip = text => String(text ?? '').trim().slice(0, SAID_MAX);

export { turnRunId };

/**
 * What a durable hobkin is told each turn: its own directions with the rules for hobkin's memories, the canvas skill,
 * and its id for the canvas commands, then the user's directions with the line that names them, and the index of
 * hobkin's memories when there are any (057-shared-memory).
 */
export function durableDirections(id, { directions = '', memories = '' } = {}) {
  const own = `${prompt('durable').trim()}\n\n${prompt('memories').trim()}\n\n${canvasSkill().trim()}\n\nYour id is ${id}. Pass \`--hobkin ${id}\` to every \`hobkin canvas\` command, so it uses your own canvas.\n`;
  return [own, ...[directions && directionsSection(directions.trim()), memories].filter(Boolean).map(part => `\n${part}\n`)].join('');
}

/** The user's directions as every other agent reads them, or none when they cannot be read: that costs the part, never the turn. */
function usersDirections(root) {
  try {
    return readDirections(root);
  } catch {
    return '';
  }
}

// What a durable hobkin's memory tools say when no turn of it runs.
const NOT_A_MEMORY_TURN = "Nothing was done: that is not a turn hobkin is running now. hobkin memory reads private memories and saves only from a durable hobkin's own turn, while it runs.";

function message(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > MESSAGE_MAX || Buffer.byteLength(text) > MAX_MESSAGE_BYTES) {
    throw Error(`Write a message of at most ${MESSAGE_MAX} characters.`);
  }
  return text;
}

/** Words one hobkin sends another: a note, not a document, so a wake holds several. */
function note(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > TELL_MAX) throw Error(TOO_LONG);
  return text;
}

/** Who sent a message, as the one who reads it answers it: `main`, or a durable hobkin's id. */
const senderId = from => (from.kind === 'main' ? 'main' : from.id);
const senderTitle = from => (from.kind === 'main' ? MAIN_TITLE : from.title);

/** What a turn that a message started is asked: the words, with who sent them. */
const messageBlock = (from, text) => `<hobkin-message>\n${JSON.stringify({ from: senderId(from), title: senderTitle(from), text }).replaceAll('</', '<\\/')}\n</hobkin-message>`;

function folder(cwd) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd) || !existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw Error('The folder must be a full path to a folder that exists.');
  }
  return cwd;
}

/** What it runs on, checked once at the start, as a binding is checked anywhere else. */
function engineOf(engine) {
  if (engine?.kind === 'tier') {
    if (!tierNames.includes(engine.tier)) throw Error(`A tier is one of ${tierNames.join(', ')}.`);
    return { kind: 'tier', tier: engine.tier };
  }
  if (engine?.kind === 'claude') {
    // Its own model and thinking, when the user chose them. The host passes them to Claude Code; with none it uses its settings.
    const { model, effort } = engine;
    if (model !== undefined && !CLAUDE_MODELS.includes(model)) throw Error(`A Claude Code model is one of ${CLAUDE_MODELS.join(', ')}.`);
    if (effort !== undefined && !CLAUDE_EFFORTS.includes(effort)) throw Error(`A Claude Code thinking level is one of ${CLAUDE_EFFORTS.join(', ')}.`);
    return { kind: 'claude', ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }) };
  }
  if (engine?.kind === 'pi') {
    const { model, effort } = engine;
    if (typeof model !== 'string' || !/^[^/\s-][^/\s]*\/\S+$/.test(model) || model.length > 200) throw Error('A Pi model is named as provider/model.');
    if (!efforts.pi.includes(effort)) throw Error(`A thinking level is one of ${efforts.pi.join(', ')}.`);
    try {
      validateBinding({ harness: 'pi', model, effort });
    } catch {
      throw Error('That Pi model cannot run.');
    }
    return { kind: 'pi', model, effort };
  }
  throw Error('Choose what it runs on: a tier, Claude Code or a Pi model.');
}

function named(title) {
  if (typeof title !== 'string') throw Error('The name must be text.');
  const name = oneLine(title);
  if (name.length > TITLE_MAX) throw Error(`A name is at most ${TITLE_MAX} characters.`);
  return name;
}

/** A name left out is the first line of the first message, cut at a word when it is long. */
function madeTitle(text) {
  const line = oneLine(text.trim().split('\n', 1)[0]);
  if (line.length <= MADE_TITLE_MAX) return line;
  const cut = line.slice(0, MADE_TITLE_MAX);
  const space = cut.lastIndexOf(' ');
  return (space >= MADE_TITLE_MAX / 2 ? cut.slice(0, space) : cut).trim();
}

/**
 * hobkin's end states as a turn reads them. A job that `incomplete` never gave its answer, so it failed; `no_change` is a
 * job that finished.
 */
const turnStatus = status => {
  if (status === 'running' || status === 'interrupted') return status;
  return status === 'completed' || status === 'no_change' ? 'completed' : 'failed';
};

/** A run stopped by nobody was stopped by hobkin stopping or crashing. */
const cutOff = run => !run || (run.status === 'interrupted' && !run.userStop);

function lastOf(run, at) {
  if (!run) return { status: 'failed', said: 'Its turn could not start.', at };
  const status = turnStatus(run.status);
  if (status === 'completed') return { status, said: clip(run.result?.text) || 'It finished without saying anything.', at };
  if (status === 'failed') return { status, said: clip(run.result?.error ?? run.error) || clip(run.result?.text) || 'It failed without saying why.', at };
  return { status, said: run.userStop ? STOPPED : 'It was cut off before it finished. Send it a message to carry on.', at };
}

function turnOf(run) {
  const status = turnStatus(run.status);
  const failure = status === 'failed' ? String(run.result?.error ?? run.error ?? '') || 'It failed without saying why.' : null;
  return {
    n: run.hobkin.turn,
    run: run.id,
    asked: run.hobkin.asked,
    // A turn that a message started says who sent it. Every other turn is the user's.
    from: run.hobkin.from ?? { kind: 'user' },
    askedAt: run.startedAt,
    status,
    reply: status !== 'running' && run.result?.text?.trim() ? run.result.text : null,
    error: status === 'interrupted' ? (run.userStop ? STOPPED : 'It was cut off before it finished.') : failure,
    endedAt: run.finishedAt ?? null,
    // What the user added to it while it worked, as its run keeps it (`HobkinRunner.keepNotes`).
    ...(run.notes?.length ? { notes: run.notes } : {}),
  };
}

/** A record as the window reads it (`HobkinSummary`). */
const summaryOf = record => ({
  id: record.id,
  title: record.title,
  cwd: record.cwd,
  engine: copy(record.engine),
  state: record.state,
  turns: record.turns,
  run: record.run,
  last: record.last ? { status: record.last.status, said: record.last.said, at: record.last.at } : null,
  waiting: record.waiting ? { since: record.waiting.since, seen: record.waiting.seen } : null,
  createdAt: record.createdAt,
});

function live(state, id) {
  const record = typeof id === 'string' ? state.hobkins?.[id] : undefined;
  if (!record) throw Error('There is no hobkin with that id.');
  if (record.state === 'ended') throw Error('That hobkin has ended.');
  return record;
}

/** Every hobkin that is not ended, newest first. */
export function hobkinSummaries(state) {
  return Object.values(state.hobkins ?? {})
    .filter(record => record.state !== 'ended')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .map(summaryOf);
}

export class Hobkins {
  // Each hobkin's turn in flight, settled once its record is updated.
  ending = new Map();
  // The records as this process last wrote them. Nothing else writes them, so the wake can read them without waiting.
  records = {};
  // The messages waiting to be delivered, kept the same way.
  mail = {};
  // Each running turn's token and the turn it names. A token names nothing outside its turn.
  tokens = new Map();
  // Each hobkin's token, the same for all its turns while hobkin runs, so a Pi process kept between turns keeps the
  // environment it was started with and `hobkin tell` from it names whichever of its turns is running.
  hobkinTokens = new Map();
  // The main agent's turn and the counts it may spend from: `from` each sender's it was woken for, `own` a fresh one.
  mainChain = null;

  /**
   * `config` gives hobkin's configuration as it was opened; a turn reads the tiers fresh and falls back to it. `warms`
   * says the runner's harness takes a request to start a process ahead of its turn (`warm` below).
   */
  constructor({ runtime, runner, root, config, now = Date.now, warms = false, memoryKeeper }) {
    Object.assign(this, { runtime, runner, root, config, now, warms });
    // What a hobkin's memory tools reach, as that hobkin (057-shared-memory). hobkin's own posts its changes in Chat.
    this.memoryKeeper = memoryKeeper ?? (owner => memoryHandler(root, owner, { now: () => new Date(this.now()).getTime() }));
    // Each hobkin's index of memories as its process was first started with it while hobkin runs, and what it was told since.
    this.memoryPrompts = new Map();
  }

  /**
   * A hobkin's index of memories, private ones too, kept as first written while hobkin runs: its process's start stays
   * the same turn after turn, so a kept process is kept, and what changed since reaches it as a note with its next turn.
   */
  keptMemories(record) {
    let kept = this.memoryPrompts.get(record.id);
    if (!kept) {
      const recall = record.engine?.kind === 'claude' ? 'hobkin memory' : 'hobkin_recall';
      kept = keptPrompt({ memories: () => memorySnapshot(this.root, { private: true, maxBytes: MAIN_INDEX_BYTES, recall, by: 'hobkin' }) });
      this.memoryPrompts.set(record.id, kept);
    }
    return kept;
  }

  at() { return new Date(this.now()).toISOString(); }

  async change(update) {
    const { result, records, mail } = await this.runtime.change(state => {
      state.hobkins ??= {};
      const result = update(state.hobkins, state);
      return { result: copy(result), records: copy(state.hobkins), mail: copy(state.hobkinMail ?? {}) };
    });
    Object.assign(this, { records, mail });
    return result;
  }

  /** After a restart no turn is running, so a hobkin that was working waits, and says it was cut off. */
  open() {
    const at = this.at();
    return this.change((hobkins, state) => {
      for (const record of Object.values(hobkins)) {
        const run = state.runs[record.run];
        if (record.state !== 'working' || run?.status === 'running') continue;
        Object.assign(record, {
          state: 'waiting', run: null,
          last: cutOff(run) ? { status: 'interrupted', said: CUT_OFF, at } : lastOf(run, at),
          waiting: { since: at, seen: false },
        });
      }
    });
  }

  starting() {
    if (this.runner.stopped) throw Error('hobkin is stopping, so it starts nothing now.');
  }

  /**
   * Starts one. With a first message its first turn runs at once. With none it waits, with nothing to tell anybody,
   * and the first message sent to it is its first turn. `titleBy` says where its name came from, so only a name the
   * user gave is never replaced: `none` until something names it, `message` for its first message's first line.
   */
  async start({ text, cwd, engine, title } = {}) {
    const asked = text == null ? null : message(text);
    const given = title == null ? '' : named(title);
    const fields = {
      cwd: folder(cwd),
      engine: engineOf(engine),
      title: given || (asked ? madeTitle(asked) : UNNAMED),
      titleBy: given ? 'user' : asked ? 'message' : 'none',
    };
    this.starting();
    const createdAt = this.at();
    const record = await this.change(hobkins => {
      if (Object.values(hobkins).filter(item => item.state !== 'ended').length >= MOST_HOBKINS) return null;
      let id;
      do id = randomBytes(4).toString('hex'); while (hobkins[id]);
      hobkins[id] = {
        id, ...fields,
        sessionFile: join(this.root, 'hobkins', `${id}.jsonl`),
        engineSession: null,
        createdAt,
        last: null,
        ...(asked
          // The user's words start a fresh count of messages between hobkins.
          ? { turns: 1, run: turnRunId(id, 1), state: 'working', waiting: null, count: randomUUID() }
          // Nothing has happened, so there is nothing to look at.
          : { turns: 0, run: null, state: 'waiting', waiting: { since: createdAt, seen: true } }),
      };
      return hobkins[id];
    });
    if (!record) throw Error(`There are already ${MOST_HOBKINS} hobkins. End one first.`);
    if (asked) this.startTurn(record, asked);
    // The user writes its first message next, so its process starts while they do.
    else this.warm(record);
    return { id: record.id, run: record.run };
  }

  /** A hobkin's token: the same for all its turns while hobkin runs, so a process kept between them keeps its environment. */
  tokenOf(id) {
    const token = this.hobkinTokens.get(id) ?? turnToken();
    this.hobkinTokens.set(id, token);
    return token;
  }

  /**
   * What a hobkin's process is started with on this binding. A turn and a process started ahead of it are both given
   * this, so the turn finds that process started as its own would be.
   */
  processStart(record, { harness, model, effort }) {
    return {
      harness,
      model,
      effort,
      cwd: record.cwd,
      sessionFile: record.sessionFile,
      purpose: 'durable',
      directions: durableDirections(record.id, { directions: usersDirections(this.root), memories: this.keptMemories(record).memories() }),
      // The token says who the process is, and the home is where `hobkin tell` reaches hobkin.
      env: { [TURN_TOKEN]: this.tokenOf(record.id), [TURN_HOME]: this.root },
      // It keeps schedules for itself, which wake it with a turn or a message (056-agent-schedules).
      schedules: true,
      // On Pi it reads and saves hobkin's memories with their tools, the first one too, since the user talks to it
      // (057-shared-memory).
      ...(harness === 'pi' ? { memories: 'keeper' } : {}),
    };
  }

  /**
   * Starts a waiting hobkin's Pi process ahead of its next turn, so the turn only prompts it (`startAhead` in
   * `harnesses.mjs`). Nothing waits for it, no run is recorded and nothing is asked of the model. If it fails nothing is
   * said: the turn starts its own process, as it did before.
   */
  warm(record) {
    if (!this.warms || this.runner.stopped) return;
    try {
      const binding = this.binding(record.engine);
      if (binding.harness !== 'pi') return;

      mkdirSync(join(this.root, 'hobkins'), { recursive: true, mode: 0o700 });
      const request = { ...this.processStart(record, binding), id: randomUUID(), warm: true };
      Promise.resolve(this.runner.runHarness(request)).catch(() => {});
    } catch {
      // A tier that cannot be read now, or a folder that cannot be made: the turn says so when it comes.
    }
  }

  /**
   * A waiting hobkin takes the words as its next turn. A working one hears them in the turn it is on, as `queue` says, the
   * way Pi's keys queue a message: `steer` (the default), `follow-up` once the turn would end, or `interrupt`, which stops
   * the turn for them and gives back what it never read (`unsent`). Either way the user's words give that turn a fresh count
   * of messages between hobkins. `images` are the pictures the user attached, as Pi's image content, and go with the words.
   */
  async say(id, { text, noteId, sentAt, images, queue } = {}) {
    // Where the turn these words start begins: the user's Enter, when the window said when that was.
    const began = turnFrom(sentAt);
    const asked = message(text);
    const unsendable = imagesProblem(images);
    if (unsendable) throw Error(unsendable);
    const pictures = images?.length ? { images } : {};
    for (let tries = 0; tries < SAY_TRIES; tries++) {
      const record = live(await this.runtime.state(), id);
      if (record.state === 'waiting') {
        this.starting();
        const next = await this.change(hobkins => {
          const current = hobkins[id];
          if (current?.state !== 'waiting') return null;
          Object.assign(current, { state: 'working', turns: current.turns + 1, run: turnRunId(id, current.turns + 1), waiting: null, count: randomUUID() });
          // One that nothing has named yet takes its name from the first thing it is asked.
          if (current.titleBy === 'none') Object.assign(current, { title: madeTitle(asked) || current.title, titleBy: 'message' });
          return current;
        });
        if (!next) continue;
        this.startTurn(next, asked, null, began, pictures);
        return { started: true, queued: false, run: next.run };
      }
      if (asked.length > NOTE_MAX) throw Error(`While it works, a message is at most ${NOTE_MAX} characters. Send the rest when it waits.`);
      try {
        const note = {
          scheduleId: turnSchedule(id),
          runId: record.run,
          ...(noteId === undefined ? {} : { noteId }),
          message: asked,
          ...pictures,
          ...(queue === undefined ? {} : { queue }),
        };
        const { status, unsent } = await this.runner.messageCheck(note, { durable: true });
        await this.change(hobkins => {
          if (hobkins[id]?.run === record.run) hobkins[id].count = randomUUID();
        });
        return { started: false, queued: status === 'queued', run: record.run, ...(unsent ? { unsent } : {}) };
      } catch (error) {
        // Either the turn has not begun yet, and the words wait for it, or it ended between the look and the message,
        // and they start the next one. A moment settles which.
        if (!/not running|has finished/.test(error.message)) throw error;
        await Promise.race([this.ending.get(id), wait(SAY_RETRY_MS)]);
      }
    }
    throw Error('That hobkin is between turns. Send the message again.');
  }

  /** Pi's Alt+Up on a working hobkin: what waits for its turn comes back as the user typed it, and the turn goes on. */
  async takeBack(id) {
    const record = live(await this.runtime.state(), id);
    if (record.state !== 'working') return { unsent: [] };
    try {
      const { unsent } = await this.runner.takeBack({ scheduleId: turnSchedule(id), runId: record.run }, { durable: true });
      return { unsent };
    } catch (error) {
      // A turn that ended meanwhile has nothing left waiting.
      if (/not running|has finished/.test(error.message)) return { unsent: [] };
      throw error;
    }
  }

  /**
   * A schedule this hobkin keeps woke it (056-agent-schedules), with `text`, the block of what it found, `short`, the
   * same cut to what a message to a working turn may be, and `from`, the schedule as the turn names its sender. A
   * waiting hobkin takes it as a turn of its own, with a fresh count of messages between hobkins, and a working one
   * hears it in the turn it is on, as the user's words would reach it. Answers how,
   * `{ gone: true }` for a hobkin that ended, or null when it cannot take it now, as between turns, to be tried again.
   */
  async wake(id, { text, short = text, from }) {
    const record = this.records[id];
    if (!record || record.state === 'ended') return { gone: true };
    if (this.runner.stopped) return null;
    if (record.state === 'waiting') {
      const next = await this.change(hobkins => {
        const current = hobkins[id];
        if (current?.state !== 'waiting') return null;
        Object.assign(current, { state: 'working', turns: current.turns + 1, run: turnRunId(id, current.turns + 1), waiting: null, count: randomUUID() });
        return current;
      });
      if (!next) return null;
      this.startTurn(next, text, from);
      return { started: true, run: next.run };
    }
    try {
      const { status } = await this.runner.messageCheck({ scheduleId: turnSchedule(id), runId: record.run, message: short }, { durable: true });
      return { steered: status, run: record.run };
    } catch (error) {
      if (/not running|has finished/.test(error.message)) return null;
      throw error;
    }
  }

  /** The binding of a turn about to start. A tier is read now, so a tier the user just changed is used at once. */
  binding(engine) {
    if (engine.kind === 'pi') return { harness: 'pi', model: engine.model, effort: engine.effort };
    let config = this.config();
    try {
      config = loadConfig(this.root);
    } catch {
      // A configuration that cannot be read just now leaves the tiers as hobkin last knew them.
    }
    // The host runs Claude Code with its own settings, so the main binding only fills the run's record.
    if (engine.kind === 'claude') return { harness: 'claude', model: config.main.model, effort: config.main.effort };
    const { model, effort, tier } = tierBinding(config, engine.tier);
    return { harness: 'pi', model, effort, tier };
  }

  /**
   * One turn as one of the runner's background jobs, started as `startSessionJob` starts a session. A turn that a
   * message started has `from`, who sent it. Its process is given the hobkin's token, which names this turn while it
   * runs, so `hobkin tell` from it is sent as this hobkin and spends the turn's count (`record.count`), and the home to
   * reach hobkin through. `images` are what the user attached to the words, as `{ images }`, or nothing.
   */
  startTurn(record, asked, from = null, began = { since: Date.now(), origin: 'run', marks: {} }, images = {}) {
    const n = record.turns;
    const runId = turnRunId(record.id, n);
    const { harness, model, effort, tier } = this.binding(record.engine);
    const token = this.tokenOf(record.id);
    this.tokens.set(token, { id: record.id, run: runId });
    const resume = record.engine.kind === 'claude' && record.engineSession ? record.engineSession : undefined;
    // What the user chose for Claude Code, for the host that runs it. None when they chose nothing.
    const { model: claudeModel, effort: claudeEffort } = record.engine.kind === 'claude' ? record.engine : {};
    const claude = {
      ...(claudeModel === undefined ? {} : { model: claudeModel }),
      ...(claudeEffort === undefined ? {} : { effort: claudeEffort }),
    };
    const harnessId = randomUUID();
    const inbox = Promise.withResolvers();
    inbox.promise.catch(() => {});
    this.runner.inboxes.set(runId, inbox);
    const request = {
      id: runId, kind: 'background', scheduleId: turnSchedule(record.id), title: record.title,
      harness, model, effort, ...(tier ? { tier } : {}), cwd: record.cwd, harnessId,
      hobkin: { id: record.id, turn: n, asked, ...(from ? { from } : {}) },
    };
    const { work } = this.runner.startTracked(request, async signal => {
      const admitted = Date.now();
      // An end that came before this run was admitted had nothing to stop, so the turn stops itself.
      if ((await this.runtime.state()).hobkins?.[record.id]?.run !== runId) {
        return { status: 'interrupted', noModel: true, error: 'The hobkin ended before this turn began.' };
      }
      mkdirSync(join(this.root, 'hobkins'), { recursive: true, mode: 0o700 });
      const start = this.processStart(record, { harness, model, effort });
      // What changed in hobkin's memories since its index was written goes ahead of the words, once (057-shared-memory).
      // The user's slash command goes in as typed, so Pi runs it, and the news waits for the next turn.
      const news = !from && asked.startsWith('/') ? null : this.keptMemories(record).news();
      news?.told();
      // A schedule's wake is its own block already (`scheduleWakeBlock`).
      const words = from && from.kind !== 'schedule' ? messageBlock(from, asked) : asked;
      return this.runner.runHarness({
        ...start,
        id: harnessId,
        prompt: news ? `${news.text}${words}` : words,
        ...images,
        ...(resume ? { resume } : {}),
        ...(Object.keys(claude).length ? { claude } : {}),
        signal,
      }, { onEvent: event => this.runner.onActivity(runId, event), onReady: send => inbox.resolve(send),
        // When the turn began and what it has passed, for whichever engine times its stages.
        turn: { ...began, kind: 'durable', marks: { ...began.marks, admitted } } });
    });
    const ended = work.then(run => this.finishTurn(record.id, runId, run)).catch(() => {});
    this.ending.set(record.id, ended);
    void ended.then(() => {
      if (this.ending.get(record.id) === ended) this.ending.delete(record.id);
      // The hobkin's next turn may already name its own run with the same token.
      if (this.tokens.get(token)?.run === runId) this.tokens.delete(token);
      // A message that waited for this turn to end starts the next one.
      return this.deliver(record.id);
    }).catch(() => {});
  }

  /** The turn is over, so the hobkin waits, unseen, with how it ended. One the user ended stays ended. */
  finishTurn(id, runId, run) {
    const at = this.at();
    // hobkin stopping cuts the turn off, as a crash does, and the next start reads it the same way.
    const stopping = this.runner.stopped && cutOff(run);
    return this.change(hobkins => {
      const record = hobkins[id];
      if (record?.state !== 'working' || record.run !== runId) return;
      Object.assign(record, {
        state: 'waiting', run: null,
        last: stopping ? { status: 'interrupted', said: CUT_OFF, at } : lastOf(run, at),
        waiting: { since: at, seen: false },
        ...(typeof run?.result?.sessionId === 'string' ? { engineSession: run.result.sessionId } : {}),
      });
    });
  }

  /**
   * The user's alone. It stops the turn in flight, closes the process kept for its next turn and closes the canvas, and
   * the conversation file stays. Messages waiting for it go with it.
   */
  async end(id) {
    const { sessionFile } = live(await this.runtime.state(), id);
    const endedAt = this.at();
    const ended = await this.change((hobkins, state) => {
      const record = hobkins[id];
      if (!record || record.state === 'ended') return null;
      const { run } = record;
      Object.assign(record, { state: 'ended', run: null, waiting: null, endedAt });
      for (const mail of Object.values(state.hobkinMail ?? {})) if (mail.to === id) delete state.hobkinMail[mail.id];
      return { run };
    });
    if (!ended) throw Error('That hobkin has ended.');
    if (ended.run) await this.runner.kill(ended.run, { source: 'user', reason: 'The user ended this hobkin.' });
    await this.ending.get(id);
    this.hobkinTokens.delete(id);
    this.memoryPrompts.delete(id);
    await closeKept(sessionFile);
    try {
      if (readCanvases(this.root)[id]?.open) closeCanvas(this.root, id);
    } catch {
      // The window stops drawing an ended hobkin's canvas either way.
    }
    return { ok: true };
  }

  /**
   * Changes the model or thinking level a hobkin works on. It is saved as a Pi engine for every later turn, so one that
   * waits starts its next turn with it, and only what changed is passed to the turn in flight, which takes it from its
   * next step (`HobkinRuntime.changeRun`). A turn that ends meanwhile leaves the change for the next one and says why it
   * did not take it. A hobkin on Claude Code keeps what Claude Code runs on.
   */
  async changeEngine(id, change) {
    const state = await this.runtime.state();
    const record = live(state, id);
    if (record.engine.kind === 'claude') throw Error('A hobkin on Claude Code keeps the model and thinking level Claude Code runs on.');
    const asked = bindingChange(change);
    const turn = record.state === 'working' && record.run ? state.runs[record.run] : null;
    // What it works on now: the turn in flight's, which a change may have moved, else what its next turn would start with.
    const now = turn?.status === 'running' ? { model: turn.model, effort: turn.effort } : this.binding(record.engine);
    if (!asked.model && !now.model) throw Error('Name the model too: this hobkin has no model of its own yet.');
    const engine = engineOf({ kind: 'pi', model: asked.model ?? now.model, effort: asked.effort ?? now.effort });

    const saved = await this.change(hobkins => {
      const current = hobkins[id];
      if (!current || current.state === 'ended') return null;
      current.engine = engine;
      return { run: current.state === 'working' ? current.run : null };
    });
    if (!saved) throw Error('That hobkin has ended.');
    if (!saved.run) return { engine, turn: null };

    const passed = {
      ...(engine.model === now.model ? {} : { model: engine.model }),
      ...(engine.effort === now.effort ? {} : { effort: engine.effort }),
    };
    if (!Object.keys(passed).length) return { engine, turn: { run: saved.run, took: true, model: now.model, effort: now.effort } };
    try {
      return { engine, turn: { run: saved.run, took: true, ...await this.runtime.changeRun(saved.run, passed) } };
    } catch (error) {
      return { engine, turn: { run: saved.run, took: false, reason: String(error?.message ?? error) } };
    }
  }

  async rename(id, title) {
    live(await this.runtime.state(), id);
    const name = named(title);
    if (!name) throw Error('Give it a name.');
    const record = await this.change(hobkins => {
      const current = hobkins[id];
      if (!current || current.state === 'ended') return null;
      Object.assign(current, { title: name, titleBy: 'user' });
      return current;
    });
    if (!record) throw Error('That hobkin has ended.');
    return summaryOf(record);
  }

  /**
   * The hobkins named only by their first message, with the words a better title is made from: what the user first
   * asked, and what it first answered, once it has. One the user named, or that has a title already, is not listed.
   */
  async toTitle() {
    // The host asks every few seconds, and most of the time no hobkin is still named by its first message.
    const index = await this.runtime.runIndex?.();
    if (index?.toTitle === false) return [];
    const state = await this.runtime.state();
    return Object.values(state.hobkins ?? {})
      .filter(record => record.state !== 'ended' && record.titleBy === 'message')
      .flatMap(record => {
        const first = state.runs[turnRunId(record.id, 1)];
        const asked = first?.hobkin?.asked;
        if (typeof asked !== 'string' || !asked.trim()) return [];
        const reply = first.result?.text?.trim();
        return [{ id: record.id, words: [asked, ...(reply ? [reply] : [])] }];
      });
  }

  /** A title made for it, taken once and only while its name is still its first message's. Answers with the hobkin as it is now. */
  async retitle(id, title) {
    live(await this.runtime.state(), id);
    const name = named(title);
    const record = await this.change(hobkins => {
      const current = hobkins[id];
      if (!current || current.state === 'ended') return null;
      if (name && current.titleBy === 'message') Object.assign(current, { title: name, titleBy: 'agent' });
      return current;
    });
    if (!record) throw Error('That hobkin has ended.');
    return summaryOf(record);
  }

  /**
   * The window says this hobkin's page is on screen, so its next message may come soon. One that waits on Pi gets its
   * process started ahead of that turn, or the one kept for it kept for another ten idle minutes (`warm`). A working one
   * and one on Claude Code start nothing.
   */
  async pageShown(id) {
    const record = live(await this.runtime.state(), id);
    if (record.state === 'waiting') this.warm(record);
    return { ok: true };
  }

  /**
   * What Pi offers this hobkin's own session as slash commands: its turn in flight's process, or while it waits the
   * process kept for its next turn (`keptCommands`), which its page starts. None while no process holds it; asking
   * starts nothing.
   */
  async commands(id) {
    const record = live(await this.runtime.state(), id);
    if (record.state === 'working' && record.run) return this.runtime.runCommands(record.run);
    return (await keptCommands(record.sessionFile)) ?? [];
  }

  /** The user looked at it, so the window stops marking this wait. */
  async seen(id) {
    live(await this.runtime.state(), id);
    await this.change(hobkins => {
      const record = hobkins[id];
      if (record?.state === 'waiting' && record.waiting) record.waiting.seen = true;
    });
    return { ok: true };
  }

  /** The hobkin and its turns, oldest first, from the runs that were its turns. */
  async read(id) {
    const state = await this.runtime.state();
    const record = live(state, id);
    const turns = Object.values(state.runs)
      .filter(run => run.hobkin?.id === id)
      .sort((a, b) => a.hobkin.turn - b.hobkin.turn)
      .map(turnOf);
    return { hobkin: summaryOf(record), turns };
  }

  /**
   * The main agent's message to a durable hobkin, through its `client` tool. While it waits the words start its next
   * turn; while it works they wait for the turn in flight to end. `queued` says they wait.
   */
  async tell(id, { text } = {}) {
    const sent = await this.send({ kind: 'main' }, this.mainCounts(id), id, text);
    return { started: sent.started, queued: !sent.started, run: sent.run };
  }

  /** Who the main agent can message: every durable hobkin, newest first. */
  async reach() {
    return { hobkins: await this.reachFrom(null) };
  }

  /** Who a sender can reach: the main hobkin and every other durable hobkin, each with whether it works or waits. */
  async reachFrom(self) {
    const others = hobkinSummaries(await this.runtime.state())
      .filter(record => record.id !== self)
      .map(({ id, title, state }) => ({ id, title, state }));
    if (self === null) return others;
    return [{ id: 'main', title: MAIN_TITLE, state: this.runtime.mainFree ? 'waiting' : 'working' }, ...others];
  }

  /**
   * The counts the main agent's message to `to` may spend. A turn woken for messages holds each sender's count:
   * an answer to one of them spends that sender's, so another's spent count never holds it back, and a message to anyone
   * else spends whichever has most left. A turn the user's words started or reached holds a fresh count of its own, and
   * so does a message from no turn at all, as from the window.
   */
  mainCounts(to) {
    const turn = this.runtime.mainTurn?.id;
    if (!turn) return [randomUUID()];
    if (this.mainChain?.turn !== turn) this.mainChain = { turn, from: {}, own: randomUUID() };
    const { from, own } = this.mainChain;
    const woken = Object.values(from).flat();
    return from[to]?.length ? from[to] : woken.length ? woken : [own];
  }

  /** The id of a main turn hobkin is about to start for these messages, holding each sender's count. */
  mainTurnFor(messages) {
    const turn = randomUUID();
    const from = {};
    for (const message of messages) if (message.count) (from[message.from] ??= []).push(message.count);
    this.mainChain = { turn, from, own: randomUUID() };
    return turn;
  }

  /** The user's words reached the main agent's turn, a wake's included, so what it sends from now on counts from them. */
  userWrote() {
    const turn = this.runtime.mainTurn?.id;
    this.mainChain = turn ? { turn, from: {}, own: randomUUID() } : null;
  }

  /**
   * Keeps a message in the durable store, then delivers what it can now: a waiting durable hobkin starts its turn at
   * once, and the main agent's wake goes on the application's next tick. The message spends one from whichever of
   * `counts` has most left, and the turn it starts holds that count.
   */
  async send(from, counts, to, text) {
    const words = note(text);
    if (to === senderId(from)) throw Error('Nothing was sent: that is you.');
    const at = this.at();
    const kept = await this.change((hobkins, state) => {
      if (to !== 'main') {
        if (typeof to !== 'string' || !Object.hasOwn(hobkins, to)) return { refused: NO_SUCH };
        if (hobkins[to].state === 'ended') return { refused: 'Nothing was sent: that hobkin has ended.' };
      }
      state.hobkinMail ??= {};
      const title = to === 'main' ? MAIN_TITLE : hobkins[to].title;
      const waiting = Object.values(state.hobkinMail).filter(mail => mail.to === to && senderId(mail.from) === senderId(from));
      if (waiting.length >= MOST_WAITING) return { refused: `Nothing was sent: three messages from you already wait for ${title}. Wait for it to take them.` };
      state.hobkinCounts ??= {};
      const spent = state.hobkinCounts;
      for (const [id, count] of Object.entries(spent)) if (Date.parse(at) - Date.parse(count.at) > COUNT_KEPT_MS) delete spent[id];
      // A count not in the store yet is full.
      const [count] = counts.map(id => ({ id, left: spent[id]?.left ?? MOST_MESSAGES })).sort((a, b) => b.left - a.left);
      if (!count || count.left <= 0) return { refused: TOO_MANY };
      spent[count.id] = { left: count.left - 1, at };
      state.hobkinMailNext = (state.hobkinMailNext ?? 0) + 1;
      const id = randomUUID();
      state.hobkinMail[id] = { id, n: state.hobkinMailNext, from, to, text: words, at, count: count.id };
      return { id, title };
    });
    if (kept.refused) throw Error(kept.refused);
    const turn = to === 'main' ? null : (await this.deliver(to)).find(({ mail }) => mail.id === kept.id);
    return { to, title: kept.title, started: Boolean(turn), run: turn?.record.run ?? null };
  }

  /**
   * Each waiting durable hobkin with a message for it starts a turn with the oldest one, as the user's message would.
   * One that works keeps its messages until its turn ends. Answers with each turn it started and the message it took.
   */
  async deliver(only) {
    if (this.runner.stopped) return [];
    const targets = [...new Set(Object.values(this.mail).map(mail => mail.to))]
      .filter(to => to !== 'main' && (only === undefined || to === only) && this.records[to]?.state === 'waiting');
    const started = [];
    for (const to of targets) {
      const next = await this.change((hobkins, state) => {
        const record = hobkins[to];
        const [mail] = Object.values(state.hobkinMail ?? {}).filter(item => item.to === to).sort((a, b) => a.n - b.n);
        if (record?.state !== 'waiting' || !mail || this.runner.stopped) return null;
        delete state.hobkinMail[mail.id];
        // The turn holds the message's count, so what it sends follows from the same word of the user.
        Object.assign(record, { state: 'working', turns: record.turns + 1, run: turnRunId(to, record.turns + 1), waiting: null, count: mail.count });
        if (record.titleBy === 'none') Object.assign(record, { title: madeTitle(mail.text) || record.title, titleBy: 'message' });
        return { record, mail };
      });
      if (!next) continue;
      this.startTurn(next.record, next.mail.text, next.mail.from);
      started.push(next);
    }
    return started;
  }

  /**
   * Messages waiting for the main agent, oldest first, as many as one wake holds, each with how to answer its sender.
   * The wake is measured as it is sent, escapes and all. One message always fits, since it is at most `TELL_MAX`
   * characters, so the oldest one is never held back by its size and the rest follow in the next wakes.
   */
  forMain() {
    const waiting = Object.values(this.mail).filter(mail => mail.to === 'main').sort((a, b) => a.n - b.n);
    const taken = [];
    for (const mail of waiting) {
      const next = { id: mail.id, from: senderId(mail.from), title: senderTitle(mail.from), text: mail.text, at: mail.at, count: mail.count };
      if (taken.length && Buffer.byteLength(messagesBrief([...taken, next])) > MAX_MESSAGE_BYTES) break;
      taken.push(next);
    }
    return taken;
  }

  /** The main agent took them, so they are delivered and leave the store. */
  heardByMain(messages) {
    return this.change((_, state) => {
      for (const { id } of messages) delete state.hobkinMail?.[id];
    });
  }

  /**
   * What `hobkin tell` asked from a turn's shell, each answered once. The sender is the turn its token names, never
   * anything the request says about itself.
   */
  async takeTells() {
    for (const { id, request } of takeTellRequests(this.root)) {
      let answer;
      try {
        answer = { ok: true, value: await this.fromTurn(request) };
      } catch (error) {
        answer = { ok: false, error: String(error?.message ?? error) };
      }
      try {
        answerTell(this.root, id, answer);
      } catch {
        // The command then says hobkin did not answer.
      }
    }
  }

  async fromTurn(request) {
    const turn = typeof request?.token === 'string' ? this.tokens.get(request.token) : undefined;
    const record = turn && this.records[turn.id];
    if (!record || record.state === 'ended') throw Error(NOT_A_TURN);
    if (request.to === undefined) return { hobkins: await this.reachFrom(turn.id) };
    // A record from before counts were kept has none, so its turn counts on its own.
    const count = record.count ?? `turn:${turn.run}`;
    const sent = await this.send({ kind: 'hobkin', id: turn.id, title: record.title }, [count], request.to, request.text);
    const busy = sent.to === 'main' ? !this.runtime.mainFree : !sent.started;
    const arrives = sent.to === 'main'
      ? (busy ? 'The main hobkin is busy, so it hears it as soon as its turn ends.' : 'The main hobkin hears it now, in a turn of its own.')
      : (busy ? 'It is working, so this starts its next turn as soon as the one in flight ends.' : 'It started a turn there now.');
    return { sent: true, to: sent.to, title: sent.title, note: `${arrives} Nothing waits for an answer: one, if it comes, starts a turn of yours.` };
  }

  /**
   * What `hobkin memory` asked from a turn's shell (057-shared-memory), each answered once as the hobkin its token
   * names, with private memories, while that turn runs. The folder is looked in only once a command has made it.
   */
  takeMemoryRequests() {
    if (!existsSync(join(this.root, 'runtime', MEMORY_REQUESTS))) return;
    for (const { id, request } of takeRequests(this.root, MEMORY_REQUESTS)) {
      let answer;
      try {
        const turn = typeof request?.token === 'string' ? this.tokens.get(request.token) : undefined;
        const record = turn && this.records[turn.id];
        if (!record || record.state === 'ended') throw Error(NOT_A_MEMORY_TURN);
        const handler = this.memoryKeeper({ kind: 'hobkin', id: record.id, ...(record.title ? { title: record.title } : {}) });
        answer = { ok: true, value: answerMemoryRequest(this.root, handler, request, { now: new Date(this.now()).getTime(), private: true }) };
      } catch (error) {
        answer = { ok: false, error: String(error?.message ?? error) };
      }
      try {
        answerRequest(this.root, MEMORY_REQUESTS, id, answer);
      } catch {
        // The command then says hobkin did not answer.
      }
    }
  }

  /** Each tick: what `hobkin tell` and `hobkin memory` asked, then messages for durable hobkins that wait. Trouble costs this tick only. */
  async tick() {
    try {
      await this.takeTells();
      this.takeMemoryRequests();
      await this.deliver();
    } catch {
      // Nothing is taken from the store before it is delivered, so the next tick looks again.
    }
  }

  /** Resolves once every turn that has ended has its record updated. */
  idle() {
    return Promise.all([...this.ending.values()]);
  }

  /** hobkin is closing, so every process kept for a hobkin's next turn closes. Resolves once they have exited. */
  closeKept() {
    return Promise.all(Object.values(this.records).map(record => closeKept(record.sessionFile)));
  }
}
