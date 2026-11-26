import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askCovers, OUTWARD_KINDS, OUTWARD_VERDICTS, outwardKind, outwardVerdict } from '../src/cli/outward.mjs';

test('the mail and calendar tools that act in the user\'s name each have their kind', () => {
  for (const [name, kind] of [
    ['mcp__gmail__gmail_send', 'send'],
    ['mcp__gmail__gmail_sendDraft', 'send'],
    ['gmail_send', 'send'],
    ['mcp__gmail__calendar_createEvent', 'calendar-write'],
    ['mcp__gmail__calendar_updateEvent', 'calendar-write'],
    ['mcp__gmail__calendar_deleteEvent', 'calendar-write'],
    ['mcp__gmail__calendar_respondToEvent', 'calendar-write'],
    ['mcp__google_calendar__delete_event', 'calendar-write'],
  ]) assert.equal(outwardKind(name, {}), kind, name);
});

test('any tool named to send, reply, post, publish, pay, buy or delete is outward', () => {
  for (const [name, kind] of [
    ['mcp__slack__send_message', 'send'],
    ['mcp__outlook__reply_to_message', 'send'],
    ['mcp__slack__chat_postMessage', 'post'],
    ['mcp__x__post', 'post'],
    ['mcp__blog__publish_draft', 'post'],
    ['mcp__shop__purchase', 'spend'],
    ['mcp__bank__pay_invoice', 'spend'],
    ['mcp__drive__delete_file', 'delete'],
    ['mcp__gmail__gmail_trash', 'delete'],
    ['things_delete', 'delete'],
  ]) assert.equal(outwardKind(name, {}), kind, name);
});

test('reading, searching, drafting and local tools are not outward', () => {
  for (const name of [
    'mcp__gmail__gmail_get', 'mcp__gmail__gmail_search', 'mcp__gmail__gmail_createDraft', 'mcp__gmail__gmail_listLabels',
    'mcp__gmail__gmail_downloadAttachment', 'mcp__gmail__calendar_listEvents', 'mcp__gmail__calendar_getEvent',
    'mcp__gmail__calendar_findFreeTime', 'mcp__gmail__calendar_list', 'mcp__github__list_post_comments',
    'mcp__homeassistant__HassTurnOff', 'read', 'write', 'edit', 'grep', 'find', 'ls', 'execute',
    'hobkin_schedule', 'hobkin_done', 'message_check', 'run_routine', 'ask_question', 'load_skill',
  ]) assert.equal(outwardKind(name, {}), null, name);
  assert.equal(outwardKind(undefined, {}), null);
});

test('a shell command that sends mail or writes over HTTP to another machine is outward', () => {
  for (const [command, kind] of [
    ['echo hi | mail -s "Lunch" someone@example.invalid', 'send'],
    ['/usr/sbin/sendmail -t < message.eml', 'send'],
    ['msmtp someone@example.invalid < note.txt', 'send'],
    ['osascript -e \'tell application "Mail" to send theMessage\'', 'send'],
    ['curl -X POST https://api.example.invalid/messages', 'post'],
    ['curl -XPOST https://api.example.invalid/messages', 'post'],
    ['curl -s --request PUT https://api.example.invalid/doc/1', 'post'],
    ['curl -d \'{"text":"hi"}\' https://hooks.example.invalid/x', 'post'],
    ['curl --json \'{}\' https://api.example.invalid', 'post'],
    ['curl -F file=@a.png https://upload.example.invalid', 'post'],
    ['wget --post-data "a=1" https://example.invalid/form', 'post'],
    ['cd repo && curl -X DELETE https://api.example.invalid/items/4', 'delete'],
  ]) assert.equal(outwardKind('bash', { command }), kind, command);
});

test('reading over HTTP, a request to this machine and a word that only names mail are not outward', () => {
  for (const command of [
    'curl -fsSL https://example.invalid/install.sh',
    'curl -X GET https://api.example.invalid/items',
    'curl -X POST http://localhost:5199/reload',
    'curl -d x=1 http://127.0.0.1:3000/test',
    'wget -d https://example.invalid/file.tar.gz',
    'grep -rn mail src/',
    'cat ~/Library/Mail/V10/note.txt',
    'node mail.mjs --dry-run',
    'git log --oneline',
  ]) assert.equal(outwardKind('bash', { command }), null, command);
  assert.equal(outwardKind('bash', {}), null);
  assert.equal(outwardKind('bash', undefined), null);
});

test('a standing rule for exactly that outward kind allows it, and nothing else does', () => {
  const rule = (kind, match, then = 'allow') => ({ id: `r-${String(match)}`, kind, match, then, said: 'x', savedAt: '2026-11-26T00:00:00.000Z', by: 'user' });

  assert.equal(outwardVerdict({ kind: 'send', rules: [rule('outward', 'send')], askCovered: false }), 'allowed-by-rule');
  assert.equal(outwardVerdict({ kind: 'send', rules: [rule('outward', { kind: 'send' })], askCovered: false }), 'allowed-by-rule');
  for (const rules of [[], [rule('outward', 'post')], [rule('answer', 'send')], [rule('outward', 'send', 'ask')], [null], undefined, 'send']) {
    assert.equal(outwardVerdict({ kind: 'send', rules, askCovered: false }), 'would-block', JSON.stringify(rules));
  }
  assert.equal(outwardVerdict({ kind: 'send', rules: [], askCovered: true }), 'allowed-by-ask');
  assert.equal(outwardVerdict({ kind: 'send', rules: [rule('outward', 'send')], askCovered: true }), 'allowed-by-rule');
  assert.deepEqual(OUTWARD_VERDICTS, ['allowed-by-rule', 'allowed-by-ask', 'would-block']);
  assert.deepEqual(OUTWARD_KINDS, ['send', 'calendar-write', 'spend', 'delete', 'post']);
});

test('the user\'s own words ask for a kind of action; "continue", "yes" and what hobkin added around them do not', () => {
  assert.equal(askCovers('send', 'Send Sam the notes from today.'), true);
  assert.equal(askCovers('send', 'reply to the landlord and say yes'), true);
  assert.equal(askCovers('calendar-write', 'Book a slot with the dentist next week'), true);
  assert.equal(askCovers('delete', 'delete the old drafts'), true);
  assert.equal(askCovers('post', 'post this in the team channel'), true);
  assert.equal(askCovers('spend', 'buy the cheaper one'), true);

  for (const said of ['continue', 'Continue', 'yes', 'ok go ahead', 'Help me do this.', '']) {
    for (const kind of OUTWARD_KINDS) assert.equal(askCovers(kind, said), false, `${kind}: ${said}`);
  }
  assert.equal(askCovers('send', 'Read the draft.'), false);
  // A turn hobkin starts is one block, and its notes ride ahead of the user's words.
  assert.equal(askCovers('send', '<hobkin-wake>\n{"schedules":[{"said":"send the weekly email"}]}\n</hobkin-wake>'), false);
  assert.equal(askCovers('send', '<hobkin-work>\n{"sessions":[{"name":"send report"}]}\n</hobkin-work>\n\nContinue'), false);
  assert.equal(askCovers('send', '<hobkin-since>\nposted\n</hobkin-since>\n\nsend it to Sam'), true);
  assert.equal(askCovers('unknown', 'send it'), false);
  assert.equal(askCovers('send', undefined), false);
});

test('a plain negation asks for nothing: don\'t, do not, never and not yet', () => {
  for (const [kind, said] of [
    ['send', 'don\'t send it'],
    ['send', 'Don’t send it yet, I want to read it first.'],
    ['send', 'Dont email them'],
    ['send', 'Do not reply to the landlord.'],
    ['post', 'Never post this in the team channel.'],
    ['send', 'Send it, but not yet.'],
    ['delete', 'not yet, delete them tomorrow'],
  ]) assert.equal(askCovers(kind, said), false, said);
  assert.equal(askCovers('send', 'Don\'t send it to Sam. Reply to the landlord instead.'), true, 'a negation covers only its own sentence');
});
