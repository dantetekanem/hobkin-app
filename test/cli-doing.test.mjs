import assert from 'node:assert/strict';
import { test } from 'node:test';
import { doingAfter } from '../src/cli/doing.mjs';

const streamed = type => ({ type: 'message_update', assistantMessageEvent: { type } });
const toolStarted = (toolName, args = {}) => ({ type: 'tool_execution_start', toolName, args });
const delegation = "'/usr/bin/node' '/opt/hobkin/src/cli/main.mjs' session --title 'Fix the login' --wake --home '/Users/someone/.hobkin'";

test('what the model streams says whether it is thinking or writing its reply', () => {
  assert.equal(doingAfter(null, streamed('thinking_delta')), 'thinking');
  assert.equal(doingAfter('thinking', streamed('text_delta')), 'writing');
  assert.equal(doingAfter('writing', streamed('toolcall_delta')), 'working');
});

test('a tool says what kind of work it is, and the step after it is thinking again', () => {
  assert.equal(doingAfter(null, toolStarted('read', { path: 'notes.md' })), 'researching');
  assert.equal(doingAfter(null, toolStarted('web_search', { query: 'inspection dates' })), 'researching');
  assert.equal(doingAfter(null, toolStarted('bash', { command: delegation })), 'delegating');
  assert.equal(doingAfter(null, toolStarted('bash', { command: 'git status' })), 'working');
  assert.equal(doingAfter(null, toolStarted('edit', { path: 'AGENTS.md' })), 'working');

  assert.equal(doingAfter('researching', { type: 'tool_execution_end', toolName: 'read' }), 'thinking');
});

test('a retry and a compaction say so, and anything else keeps the word it had', () => {
  assert.equal(doingAfter('thinking', { type: 'auto_retry_start' }), 'retrying');
  assert.equal(doingAfter('thinking', { type: 'compaction_start' }), 'compacting');
  assert.equal(doingAfter('compacting', { type: 'compaction_end' }), 'thinking');

  assert.equal(doingAfter('writing', { type: 'turn_end' }), 'writing');
  assert.equal(doingAfter('writing', streamed('text_end')), 'writing');
});
