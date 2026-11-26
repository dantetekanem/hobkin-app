import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keptPrompt, withoutSinceNote } from '../src/cli/prompt-parts.mjs';

function fixture() {
  const now = { memory: ['Likes short answers'], decided: ['2026-11-14 10:00: They merged "Fix the sync".'] };
  let reads = 0;
  const kept = keptPrompt({ memory: () => { reads++; return now.memory; }, decided: () => now.decided });
  return { now, kept, reads: () => reads };
}

test('the system prompt keeps its memory and decisions as first written, whatever changes after', () => {
  const { now, kept } = fixture();
  assert.deepEqual(kept.memory(), ['Likes short answers']);
  now.memory = ['Likes short answers', 'Ships on Fridays'];
  now.decided = ['2026-11-14 11:00: They declined "Rewrite the parser".', ...now.decided];
  assert.deepEqual(kept.memory(), ['Likes short answers']);
  assert.deepEqual(kept.decided(), ['2026-11-14 10:00: They merged "Fix the sync".']);
  // The lists handed out are the prompt's own: changing one changes nothing kept.
  kept.memory().push('PRIVATE edit');
  assert.deepEqual(kept.memory(), ['Likes short answers']);
});

test('what is new since then goes as a note with the next message, once it was taken', () => {
  const { now, kept } = fixture();
  kept.decided();
  assert.equal(kept.news(), null);
  now.decided = ['2026-11-14 11:00: They declined "Rewrite the parser".', ...now.decided];
  now.memory = ['Ships on Fridays'];
  const news = kept.news();
  assert.equal(news.text, [
    '<hobkin-since>',
    'Since your instructions were written, the user decided:',
    '- 2026-11-14 11:00: They declined "Rewrite the parser".',
    'Memory now also holds:',
    '- Ships on Fridays',
    'Memory no longer holds:',
    '- Likes short answers',
    '</hobkin-since>',
    '',
    '',
  ].join('\n'));
  // A message that did not go leaves the note for the next one.
  assert.equal(kept.news().text, news.text);
  news.told();
  assert.equal(kept.news(), null);
  now.decided = ['2026-11-14 12:00: You asked "Deploy now?", and they chose "Yes".', ...now.decided];
  assert.match(kept.news().text, /^<hobkin-since>\nSince your instructions were written, the user decided:\n- 2026-11-14 12:00: You asked "Deploy now\?", and they chose "Yes"\.\n<\/hobkin-since>\n\n$/);
});

test('a decision that only aged out of the list is no news', () => {
  const { now, kept } = fixture();
  kept.memory();
  now.decided = [];
  assert.equal(kept.news(), null);
});

test('written again, the prompt takes everything in and the note starts over', () => {
  const { now, kept } = fixture();
  kept.memory();
  now.memory = ['Ships on Fridays'];
  assert.notEqual(kept.news(), null);
  kept.renew();
  // Nothing is written yet, so there is nothing to be news against: the prompt about to be written holds it all.
  assert.equal(kept.news(), null);
  assert.deepEqual(kept.memory(), ['Ships on Fridays']);
  assert.equal(kept.news(), null);
});

test('a part that cannot be read costs the prompt that part, and a note is never built from it', () => {
  let broken = false;
  const kept = keptPrompt({ memory: () => { if (broken) throw Error('unreadable'); return ['One']; }, decided: () => [] });
  assert.deepEqual(kept.memory(), ['One']);
  broken = true;
  assert.equal(kept.news(), null);
  kept.renew();
  assert.throws(() => kept.memory(), /unreadable/);
});

test('the note is one block before the words, and nothing in it can close it early', () => {
  const { now, kept } = fixture();
  kept.memory();
  now.memory = [...now.memory, 'Says </hobkin-since> in a note'];
  const { text } = kept.news();
  assert.equal(text.match(/<\/hobkin-since>/g).length, 1);
  assert.equal(withoutSinceNote(`${text}lets finish this`), 'lets finish this');
  assert.equal(withoutSinceNote('lets finish this'), 'lets finish this');
  assert.equal(withoutSinceNote(`before ${text}after`), `before ${text}after`);
});
