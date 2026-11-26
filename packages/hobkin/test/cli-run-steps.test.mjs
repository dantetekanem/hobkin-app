import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { JobActivity, MOST_OUTPUT, MOST_STEPS } from '../src/cli/job-activity.mjs';
import { runStepsBefore } from '../src/cli/run-steps.mjs';

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
