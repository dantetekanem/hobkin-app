import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, copyFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { JobActivity, MOST_OUTPUT, MOST_STEPS } from '../src/cli/job-activity.mjs';
import { runSteps, runStepOutput, runStepsBefore } from '../src/cli/run-steps.mjs';

// What a step reads as, without when hobkin or Pi first saw it.
const timeless = ({ at, ...step }) => step;
const ids = steps => steps.map(step => step.id);

/**
 * One durable conversation file with two turns, as Pi saves a kept conversation turn after turn, and the feed hobkin keeps
 * of each turn, which starts anew with the turn. Each turn's start and end are the times its run would have.
 */
async function twoTurns(t) {
  const folder = mkdtempSync(join(tmpdir(), 'hobkin-run-steps-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, 'conversation.jsonl');
  const session = SessionManager.open(file, folder, folder);
  const turn = async (asked, calls) => {
    const feed = new JobActivity({ most: MOST_STEPS, mostOutput: MOST_OUTPUT });
    const say = message => {
      feed.accept({ type: 'message_start', message });
      feed.accept({ type: 'message_end', message });
      session.appendMessage(message);
    };
    const since = Date.now();
    say({ role: 'user', content: asked, timestamp: Date.now() });
    for (const id of calls) {
      const call = { type: 'toolCall', id, name: 'bash', arguments: { command: `npm test -- ${id}` } };
      say({ role: 'assistant', content: [{ type: 'text', text: `Running ${id}.` }, call], stopReason: 'toolUse', timestamp: Date.now() });
      const content = [{ type: 'text', text: `ok ${id}` }];
      feed.accept({ type: 'tool_execution_end', toolCallId: id, toolName: 'bash', result: { content }, isError: false });
      say({ role: 'toolResult', toolCallId: id, toolName: 'bash', content, isError: false, timestamp: Date.now() });
    }
    say({ role: 'assistant', content: [{ type: 'text', text: `Done with ${asked}` }], stopReason: 'stop', timestamp: Date.now() });
    const until = Date.now();
    // The next turn begins later than this one ended, as a turn of one hobkin never starts before the last one ended.
    await sleep(5);
    return { since, until, feed: feed.snapshot() };
  };
  const first = await turn('Fix the build.', ['a', 'b']);
  const second = await turn('Now the docs.', ['c', 'd', 'e']);
  return { file, first, second };
}

test("a turn that shares its conversation with other turns reads only its own steps, numbered as its own feed numbered them", async t => {
  const { file, first, second } = await twoTurns(t);

  const one = runStepsBefore(file, { since: first.since, until: first.until });
  assert.deepEqual(one.steps.map(timeless), first.feed.map(timeless), 'the first turn, as its feed held it');
  assert.equal(one.more, false);
  // The turn in flight has no end yet.
  const two = runStepsBefore(file, { since: second.since });
  assert.deepEqual(two.steps.map(timeless), second.feed.map(timeless), 'the second turn, none of the first');

  // A page before one of the turn's own steps is found by its feed's id, and holds only that turn's steps.
  const page = runStepsBefore(file, { before: second.feed[2].id, since: second.since, until: second.until });
  assert.deepEqual([page.found, ids(page.steps)], [true, ids(second.feed.slice(0, 2))]);
  // A step it cannot find is placed by its time, still within the turn.
  const timed = runStepsBefore(file, { before: 'message:99:0', at: second.until + 1, since: second.since, until: second.until });
  assert.deepEqual([timed.found, ids(timed.steps)], [false, ids(second.feed)]);

  // Read as one run, the conversation numbers the second turn's words as the first turn's, so its feed's ids name other steps.
  const whole = runStepsBefore(file);
  assert.equal(whole.steps.length, first.feed.length + second.feed.length);
  const words = second.feed.find(step => step.kind === 'assistant');
  assert.notEqual(whole.steps.find(step => step.id === words.id)?.text, words.text);
});

const START = Date.parse('2026-11-01T09:00:00.000Z');
const header = (id = 'conversation') => JSON.stringify({ type: 'session', version: 3, id, timestamp: new Date(START).toISOString(), cwd: '/work' });
const text = lines => `${lines.join('\n')}\n`;

/**
 * One turn of a durable conversation as Pi saves it, a minute after the one before: the ask, three tool calls with their results
 * and the answer, an entry a second, each naming the one before. Its bounds are when the turn started and ended.
 */
function turn(number, parent, words = '') {
  const lines = [];
  let at = START + number * 60_000;
  const since = at;
  const save = message => {
    const id = `t${number}-${lines.length}`;
    lines.push(JSON.stringify({ type: 'message', id, parentId: parent, timestamp: new Date(at).toISOString(), message: { ...message, timestamp: at } }));
    parent = id;
    at += 1000;
  };
  save({ role: 'user', content: `Turn ${number}.` });
  for (const call of ['a', 'b', 'c']) {
    const id = `call-${number}-${call}`;
    save({ role: 'assistant', content: [{ type: 'text', text: `Running ${id}.${words}` }, { type: 'toolCall', id, name: 'bash', arguments: { command: `npm test -- ${id}` } }], stopReason: 'toolUse' });
    save({ role: 'toolResult', toolCallId: id, toolName: 'bash', content: [{ type: 'text', text: `ok ${id}` }], isError: number % 2 === 1 });
  }
  save({ role: 'assistant', content: [{ type: 'text', text: `Done with turn ${number}.${words}` }], stopReason: 'stop' });
  return { lines, last: parent, bounds: { since, until: at - 1000 } };
}

/** `count` turns from turn `first`, the first naming `parent`, as the lines of a session and each turn's bounds. */
function turns(first, count, parent = null, words = '') {
  const lines = [];
  const bounds = [];
  for (let number = first; number < first + count; number++) {
    const one = turn(number, parent, words);
    lines.push(...one.lines);
    bounds.push(one.bounds);
    parent = one.last;
  }
  return { lines, bounds, last: parent };
}

/** What `read` gives, and how many lines of a session it parsed to give it, counted where every line is parsed. */
function counting(t) {
  const parse = t.mock.method(JSON, 'parse');
  return read => {
    const before = parse.mock.callCount();
    const value = read();
    return { value, parses: parse.mock.callCount() - before };
  };
}

let copies = 0;
/** Each of `all` bounds of `file` reads as a first read of a copy of the file as it is now reads it, to the byte. */
function sameAsFirstRead(file, all, why) {
  const copy = `${file}.copy-${++copies}`;
  copyFileSync(file, copy);
  for (const bounds of all) assert.equal(JSON.stringify(runSteps(file, bounds)), JSON.stringify(runSteps(copy, bounds)), why);
  rmSync(copy);
}

function folder(t) {
  const made = mkdtempSync(join(tmpdir(), 'hobkin-run-steps-'));
  t.after(() => rmSync(made, { recursive: true, force: true }));
  return made;
}

test("every turn of a conversation is read from one parse of it, and reading another conversation in between keeps it", t => {
  const made = folder(t);
  const [a, b] = [join(made, 'a.jsonl'), join(made, 'b.jsonl')];
  const ofA = turns(0, 25);
  const ofB = turns(100, 25);
  writeFileSync(a, text([header('a'), ...ofA.lines]));
  writeFileSync(b, text([header('b'), ...ofB.lines]));
  const count = counting(t);
  const pagesOf = (file, all) => count(() => all.map(bounds => runStepsBefore(file, bounds)));

  const first = pagesOf(a, [...ofA.bounds, {}]);
  const ofB25 = pagesOf(b, ofB.bounds);
  const again = pagesOf(a, [...ofA.bounds, {}]);
  const output = count(() => runStepOutput(a, 'tool:call-3-b'));

  assert.equal(first.parses, 1 + ofA.lines.length, 'each line once, for all 25 turns and the whole');
  assert.deepEqual(first.value[3].steps.map(step => step.id), [
    'message:3:0', 'tool:call-3-a', 'message:7:0', 'tool:call-3-b', 'message:11:0', 'tool:call-3-c', 'message:15:0',
  ]);
  assert.equal(ofB25.parses, 1 + ofB.lines.length);
  assert.equal(again.parses, 0, "A's turns after B's are read from what A's parse kept");
  assert.deepEqual(again.value, first.value);
  assert.deepEqual(output, { value: { id: 'tool:call-3-b', output: 'ok call-3-b', length: 11 }, parses: 0 });
  const turnSteps = runSteps(a, ofA.bounds[3]);
  assert.ok(Object.isFrozen(turnSteps) && Object.isFrozen(turnSteps[1]), 'what every caller gets cannot be changed');
});

test('a conversation that grows is parsed only for what it added, and reads as a first read of it does', t => {
  const file = join(folder(t), 'grows.jsonl');
  const before = turns(0, 10);
  writeFileSync(file, text([header(), ...before.lines]));
  const count = counting(t);
  // Each turn, the whole conversation, and the turn in flight with no end yet.
  const all = bounds => [...bounds, {}, { since: bounds.at(-1).since }];
  const read = bounds => count(() => all(bounds).map(one => runSteps(file, one)));
  assert.equal(read(before.bounds).parses, 1 + before.lines.length);

  // A new turn.
  const added = turns(10, 1, before.last);
  appendFileSync(file, text(added.lines));
  const bounds = [...before.bounds, ...added.bounds];
  const grown = read(bounds);
  const whole = grown.value.at(-2);
  assert.equal(grown.parses, added.lines.length, 'only the new lines');
  assert.equal(whole.length, 11 * 7, 'the whole conversation, the new turn too');
  sameAsFirstRead(file, all(bounds), 'a grown conversation');

  // A line cut short by a write under way is left out, and read once it is whole.
  const next = turns(11, 1, added.last);
  const [line, ...rest] = next.lines;
  appendFileSync(file, line.slice(0, 40));
  assert.deepEqual(runSteps(file), whole, 'the line cut short is not there yet');
  appendFileSync(file, `${line.slice(40)}\n`);
  sameAsFirstRead(file, all([...bounds, ...next.bounds]), 'the line once whole');

  // A whole last line with no newline yet, then the newline, as Pi mends a file it opens.
  appendFileSync(file, rest.join('\n'));
  sameAsFirstRead(file, all([...bounds, ...next.bounds]), 'a last line with no newline');
  appendFileSync(file, '\n');
  assert.equal(count(() => runSteps(file)).parses, 0, 'the newline adds nothing to parse');
  sameAsFirstRead(file, all([...bounds, ...next.bounds]), 'the newline added');

  // An entry that names an earlier one starts another branch, longer than the one it leaves, and the active branch is the one
  // followed back from the last.
  const fork = turns(12, 3, before.last);
  appendFileSync(file, text(fork.lines));
  const forked = count(() => runSteps(file));
  assert.equal(forked.parses, fork.lines.length);
  assert.equal(forked.value.length, 13 * 7, 'ten turns and the fork, none of the branch it left');
  sameAsFirstRead(file, all([...bounds, ...next.bounds, ...fork.bounds]), 'a fork');
});

test('a conversation written anew is parsed whole again, and a whole line that goes on is no longer whole', t => {
  const made = folder(t);
  const file = join(made, 'rewritten.jsonl');
  const count = counting(t);
  const read = all => count(() => all.map(bounds => runSteps(file, bounds)));
  const old = turns(0, 6);
  writeFileSync(file, text([header(), ...old.lines]));
  read([...old.bounds, {}]);

  // Shorter than it was.
  const shorter = turns(0, 4);
  writeFileSync(file, text([header(), ...shorter.lines]));
  assert.equal(read([...shorter.bounds, {}]).parses, 1 + shorter.lines.length);
  sameAsFirstRead(file, [...old.bounds, {}], 'a shorter file');

  // Longer, from a new start.
  const longer = turns(0, 8);
  writeFileSync(file, text([header('another'), ...longer.lines]));
  assert.equal(read([...longer.bounds, {}]).parses, 1 + longer.lines.length);
  sameAsFirstRead(file, [...longer.bounds, {}], 'a longer file from a new start');

  // Longer, with the same start but other words before where it ended.
  const kept = turns(0, 7);
  const changed = turn(7, kept.last, ' Changed.');
  const more = turns(8, 2, changed.last);
  writeFileSync(file, text([header('another'), ...kept.lines, ...changed.lines, ...more.lines]));
  assert.equal(read([{}]).parses, 1 + kept.lines.length + changed.lines.length + more.lines.length);
  sameAsFirstRead(file, [...longer.bounds, ...more.bounds, {}], 'a longer file with other words before its old end');

  // Another file put in its place, even one that starts with all this one held.
  const moved = join(made, 'moved.jsonl');
  const other = turns(0, 9);
  writeFileSync(moved, text([header('another'), ...other.lines]));
  renameSync(moved, file);
  assert.equal(read([{}]).parses, 1 + other.lines.length);
  sameAsFirstRead(file, [...other.bounds, {}], 'a file put in its place');
  const after = turn(9, other.last);
  writeFileSync(moved, text([header('another'), ...other.lines, ...after.lines]));
  renameSync(moved, file);
  assert.equal(read([{}]).parses, 1 + other.lines.length + after.lines.length);

  // Its first line changed in place to a version no reader knows, the rest the same and as long.
  const unknownVersion = header('another').replace('"version":3', '"version":4');
  writeFileSync(file, text([unknownVersion, ...other.lines, ...after.lines]));
  assert.throws(() => runSteps(file), /Unsupported Pi session format/);

  // A last line read whole with no newline, that the next write goes on from, is a malformed record, as a first read finds.
  const last = turn(10, after.last);
  writeFileSync(file, text([header('another'), ...other.lines, ...after.lines]) + last.lines.slice(0, -1).join('\n'));
  sameAsFirstRead(file, [{}], 'a last line with no newline');
  appendFileSync(file, `${last.lines.at(-1)}\n`);
  assert.throws(() => runSteps(file), /malformed record/);
  assert.throws(() => runSteps(file), /malformed record/, 'and again');
});
