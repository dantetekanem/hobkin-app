import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';
import {
  CURSOR_MARKER, getCapabilities, getCellDimensions, getKeybindings, resetCapabilitiesCache, setCapabilities,
  setCapabilityOverrides, setCellDimensions, stripTerminalSequences, visibleWidth,
} from '@earendil-works/pi-tui';
import { FaceImages } from '../src/cli/face-images.mjs';
import { IMAGE_ONLY_TEXT } from '../src/cli/paste-image.mjs';
import { createDashboard, startDashboard } from '../src/cli/ui.mjs';
import { savePresentationState } from '../src/cli/view.mjs';

const snapshot = {
  config: { background: { harness: 'pi', model: null, effort: 'medium' } },
  counts: { daily: 2, weekly: 1, monthly: 0 },
  schedules: [{ id: 'recap', title: 'Morning recap', cadence: 'daily', at: '09:00', enabled: true }],
  reports: [
    { id: 'one', title: 'First report', at: '2026-10-26', body: 'Initial observations', outcome: 'findings' },
    { id: 'two', title: 'Second report', at: '2026-10-27', body: '你好 👋\nNext line', outcome: 'no_change' },
  ],
  messages: [],
  connection: 'offline',
  runs: [],
  usage: null,
};

class FakeTerminal {
  columns = 120;
  rows = 40;
  writes = [];
  start(input, resize) {
    this.input = input;
    this.resize = resize;
  }
  stop() {}
  drainInput() { return Promise.resolve(); }
  write(data) { this.writes.push(data); }
  moveBy() {}
  hideCursor() {}
  showCursor() {}
  clearLine() {}
  clearFromCursor() {}
  clearScreen() {}
  setTitle() {}
  setProgress() {}
  get kittyProtocolActive() { return false; }
}

const screen = (controller, width, height) => stripTerminalSequences(controller.render(width, height).join('\n'));
// The logo reads the same as the chat's author label, so anything about the label has to skip the logo's row.
const belowLogo = text => text.split('\n').slice(1).join('\n');

test('report selection, detail scroll and refresh preserve identity; separate conversation is reachable', () => {
  const ui = createDashboard(snapshot);
  assert.equal(ui.state().focus, 'composer');
  assert.equal(ui.state().view, 'conversation');
  ui.input('\x1b[C');
  assert.match(screen(ui, 120, 40), /First report/);
  ui.input('\x1b[B');
  ui.input('\r');
  assert.match(screen(ui, 120, 40), /你好 👋/);
  ui.input('\x1b[6~');
  const selected = ui.state();
  ui.update({ ...snapshot, reports: [{ id: 'new', title: 'New', at: '', body: '', outcome: '' }, ...snapshot.reports] });
  assert.equal(ui.state().selectedId, 'two');
  assert.equal(ui.state().scroll, selected.scroll);
  ui.input('\x1b[D');
  assert.equal(ui.state().view, 'conversation');
  assert.equal(ui.state().focus, 'composer');
});

test('invalid schedules remain discoverable and scrollable at every supported layout', () => {
  const runs = Array.from({ length: 20 }, (_, index) => ({
    state: 'invalid',
    title: `/tmp/home/schedules/daily/broken-${index}.md: expected JSON metadata between --- lines`,
  }));
  const ui = createDashboard({ ...snapshot, connection: 'connected', runs, schedules: [] });

  for (const [width, height] of [[120, 40], [80, 24], [60, 18]]) {
    assert.match(screen(ui, width, height), /20.*invalid|invalid.*20/i);
    ui.input('\x1b[D');
    assert.equal(ui.state().view, 'schedules');
    assert.match(screen(ui, width, height), /broken-0\.md/);
    assert.match(screen(ui, width, height), /expected\s+JSON\s+metadata/);
    for (let page = 0; page < 20; page++) ui.input('\x1b[6~');
    assert.match(screen(ui, width, height), /broken-19\.md/);
    const lastPage = screen(ui, width, height);
    ui.input('\x1b[5~');
    assert.notEqual(screen(ui, width, height), lastPage);
    assert.ok(ui.render(width, height).every(line => visibleWidth(line) <= width));
    ui.input('\x1b');
    assert.equal(ui.state().view, 'conversation');
  }

  ui.update(snapshot);
  ui.input('\x1b[D');
  assert.match(screen(ui, 60, 18), /Morning recap/);
});

test('while it connects the input is grey, says Connecting… and takes nothing, and once connected a draft survives Escape and a failed send', async () => {
  const ui = createDashboard({ ...snapshot, connection: 'connecting' });
  ui.input('q');
  ui.input('🌍');
  assert.equal(ui.state().draft, '', 'nothing can be typed before the main conversation connects');
  const connecting = ui.render(80, 24).join('\n');
  assert.match(stripTerminalSequences(connecting), /❯\s+Connecting…/);
  assert.match(stripTerminalSequences(connecting), /○ connecting/);
  assert.doesNotMatch(stripTerminalSequences(connecting), /Offline|send unavailable|enter send/i);
  assert.ok(!connecting.includes(CURSOR_MARKER), 'and it shows no cursor');
  ui.input('\x1b[C');
  assert.equal(ui.state().view, 'reports', 'the views still turn');
  ui.input('\x1b[D');

  let sent = 0;
  ui.update({ ...snapshot, connection: 'connected' });
  ui.setHandlers({
    send: async () => {
      sent++;
      throw Error('failed');
    },
  });
  ui.input('q');
  ui.input('🌍');
  ui.input('\x1b[D');
  ui.input('好');
  assert.equal(ui.state().draft, 'q好🌍');
  assert.ok(ui.render(80, 24).join('\n').includes(`q好${CURSOR_MARKER}`));
  ui.input('\x1b[C');
  assert.ok(ui.render(80, 24).join('\n').includes(`q好🌍${CURSOR_MARKER}`));
  ui.input('\x1b');
  assert.equal(ui.state().draft, 'q好🌍');
  ui.input('\r');
  await ui.pending();
  assert.equal(sent, 1);
  assert.equal(ui.state().draft, 'q好🌍');
  assert.match(screen(ui, 80, 24), /failed/i);
});

const lineWith = (ui, text) => ui.render(80, 24).find(value => stripVTControlCharacters(value).includes(text));
const soon = () => new Date(Date.now() + 1000).toISOString();

test('your messages sit under You, the way replies sit under Hobkin', () => {
  const at = '2026-05-04T15:00:00Z';
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages: [
    { id: 'one', role: 'user', content: 'hello', at },
    { id: 'two', role: 'assistant', content: 'hi', at },
  ] });

  const lines = screen(ui, 80, 24).split('\n');
  const you = lines.findIndex(value => /◆ You/.test(value));

  assert.match(lines[you], /\d$|\d\s*[│|]?\s*$/);
  assert.match(lines[you + 1], /^\s+hello/);
});

test('a sent message shows at once in gray, and reads normally when the agent has it', async () => {
  const accepted = Promise.withResolvers();
  const busy = { ...snapshot, connection: 'connected', busy: true, messages: [] };
  const ui = createDashboard(busy, { send: () => accepted.promise });

  ui.input('are you there?');
  ui.input('\r');

  assert.equal(ui.state().draft, '');
  assert.match(screen(ui, 80, 24), /◆ You/);
  const gray = lineWith(ui, 'are you there?');

  accepted.resolve();
  await ui.pending();
  ui.update(busy);
  assert.equal(lineWith(ui, 'are you there?'), gray, 'accepted is not delivered: it stays gray until the agent has it');

  ui.update({ ...busy, messages: [{ id: 'one', role: 'user', content: 'are you there?', at: soon() }] });

  const shown = ui.render(80, 24).filter(value => stripVTControlCharacters(value).includes('are you there?'));
  assert.equal(shown.length, 1);
  assert.notEqual(shown[0], gray);
});

test('a repeated message stays gray until its own copy arrives', async () => {
  const busy = { ...snapshot, connection: 'connected', busy: true, messages: [] };
  const ui = createDashboard(busy, { send: async () => {} });
  const first = { id: 'one', role: 'user', content: 'yes', at: soon() };
  ui.input('yes');
  ui.input('\r');
  ui.input('yes');
  ui.input('\r');
  await ui.pending();

  ui.update({ ...busy, messages: [first] });
  ui.update({ ...busy, messages: [first] });

  assert.equal(screen(ui, 80, 24).match(/◆ You/g).length, 2);

  ui.update({ ...busy, messages: [first, { ...first, id: 'two' }] });

  assert.equal(screen(ui, 80, 24).match(/◆ You/g).length, 2);
  assert.equal(new Set(ui.render(80, 24).filter(value => /yes/.test(stripVTControlCharacters(value)))).size, 1);
});

test('a message the conversation never shows leaves when the turn ends', async () => {
  const busy = { ...snapshot, connection: 'connected', busy: true, messages: [] };
  const ui = createDashboard(busy, { send: async () => {} });
  ui.input('handled by an extension');
  ui.input('\r');
  await ui.pending();
  ui.update(busy);
  assert.match(screen(ui, 80, 24), /handled by an extension/);

  ui.update({ ...busy, busy: false });

  assert.doesNotMatch(screen(ui, 80, 24), /handled by an extension/);
});

test('a message that fails leaves Chat and comes back to the composer', async () => {
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages: [] }, { send: async () => { throw Error('no route'); } });

  ui.input('hello');
  ui.input('\r');
  await ui.pending();

  assert.equal(ui.state().draft, 'hello');
  assert.doesNotMatch(screen(ui, 80, 24), /◆ You/);
  assert.match(screen(ui, 80, 24), /no route/);
});

test('a failed message never overwrites what was typed since', async () => {
  const failing = Promise.withResolvers();
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages: [] }, { send: () => failing.promise });
  ui.input('first');
  ui.input('\r');
  ui.input('second');

  failing.reject(Error('no route'));
  await ui.pending();

  assert.equal(ui.state().draft, 'second');
  assert.match(screen(ui, 80, 24), /no route/);
});

test('Hobkin sits left of the input bar in Chat, and typing still works', () => {
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages: [] }, { send: async () => {} });

  const rows = screen(ui, 100, 30).split('\n');
  const input = rows.findIndex(value => value.includes('Message hobkin'));
  assert.ok(rows[input].indexOf('Message hobkin') > 14, 'the input moves right to make room');
  assert.ok(rows.slice(input - 1, input + 4).some(value => /[^\s]/.test(value.slice(0, 14))), 'the face fills the left side');

  ui.input('hello');

  assert.equal(ui.state().draft, 'hello');
  assert.match(screen(ui, 100, 30), /❯ hello/);
});

test('the footer is no taller with the face, so nothing jumps when it comes and goes', () => {
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages: [] }, { send: async () => {} });

  const beside = screen(ui, 100, 30).split('\n').findIndex(value => value.includes('Message hobkin'));
  const without = screen(ui, 60, 30).split('\n').findIndex(value => value.includes('Message hobkin'));

  assert.equal(beside, without);
});

test('with image support the design\'s own face and wordmark show, and nothing else moves', () => {
  const live = { ...snapshot, connection: 'connected', messages: [] };
  const written = [];
  const images = new FaceImages({ write: data => written.push(data) });
  const plain = createDashboard(live, { send: async () => {} });
  const ui = createDashboard(live, { send: async () => {} }, { images });
  const rows = screen(ui, 120, 30).split('\n');
  const placeholder = '\u{10EEEE}';

  assert.ok(rows[0].includes(placeholder), 'the wordmark is a picture');
  assert.doesNotMatch(rows[0], /hobkin/);
  const input = rows.findIndex(value => value.includes('Message hobkin'));
  assert.ok(rows[input].startsWith(placeholder) === false && rows[input].includes(placeholder), 'the face sits on the input row');
  assert.ok(rows[input].indexOf(placeholder) < rows[input].indexOf('Message hobkin'), 'left of the input');
  const [, ...faceOffsets] = rows.flatMap((value, index) => (value.includes(placeholder) ? [index - input] : []));
  assert.deepEqual(faceOffsets, [-1, 0, 1, 2, 3], 'after the wordmark, five rows of face exactly beside the input block');
  assert.deepEqual(
    [rows.findIndex(value => /next check/.test(value)), rows.length],
    (plainRows => [plainRows.findIndex(value => /next check/.test(value)), plainRows.length])(screen(plain, 120, 30).split('\n')),
    'the footer is the same height with the picture',
  );
  assert.ok(rows[input + 4].includes('─') && !rows[input + 4].includes(placeholder), 'the divider has its row to itself, below the face');
  assert.ok(written.join('').includes('a=T'), 'the frames went to the terminal');
});

test('a 90-column pane still gets the face, left of the input and clear of the divider', () => {
  const live = { ...snapshot, connection: 'connected', messages: [] };
  const images = new FaceImages({ write: () => {} });
  const plain = createDashboard(live, { send: async () => {} });
  const ui = createDashboard(live, { send: async () => {} }, { images });
  const placeholder = '\u{10EEEE}';

  const rows = screen(ui, 90, 30).split('\n');
  const plainRows = screen(plain, 90, 30).split('\n');

  assert.equal(rows.filter(value => value.includes(placeholder)).length, 6, 'five rows of face and the wordmark');
  const input = rows.findIndex(value => value.includes('Message hobkin'));
  assert.ok(rows[input].includes(placeholder), 'the face sits on the input row');
  assert.ok(rows[input].indexOf(placeholder) < rows[input].indexOf('Message hobkin'), 'left of the input');
  const nextCheck = rows.findIndex(value => /next check/.test(value));
  assert.equal(nextCheck, plainRows.findIndex(value => /next check/.test(value)), 'the footer is the same height with the picture');
  assert.ok(rows[nextCheck - 1].includes('─'), 'the divider is still there');
  assert.equal(rows[nextCheck - 1], plainRows[nextCheck - 1], 'and whole, because the face stops above it');
  assert.ok(rows.every(value => visibleWidth(value) <= 90));
});

test('a terminal too narrow for the face keeps the whole input', () => {
  const images = new FaceImages({ write: () => {} });
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages: [] }, { send: async () => {} }, { images });

  const rows = screen(ui, 60, 30).split('\n');

  assert.equal(rows.filter(value => value.includes('\u{10EEEE}')).length, 1, 'only the wordmark');
});

test('Tab finishes a slash command, and cycles when several fit', () => {
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages: [] }, { send: async () => {} });
  const typed = text => {
    ui.input(text);
    return ui.state().draft;
  };

  typed('/w');
  assert.equal(typed('\t'), '/work');
  assert.equal(typed(' ~/Projects'), '/work ~/Projects', 'the cursor ends up after the command');
});

test('Tab on a bare slash walks every command and comes back round', () => {
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages: [] }, { send: async () => {} });
  const tab = () => {
    ui.input('\t');
    return ui.state().draft;
  };

  ui.input('/');

  assert.deepEqual(Array.from({ length: 7 }, tab), ['/help', '/setup', '/clear', '/reset', '/work', '/learning', '/help']);
});

test('Ctrl+C clears what is typed and does not quit', () => {
  let quits = 0;
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages: [] }, { onQuit: () => { quits++; } });

  ui.input('half a thought');
  ui.input('\x03');

  assert.equal(ui.state().draft, '');
  assert.equal(quits, 0);
});

test('Ctrl+C with nothing to clear warns first, and quits on the second press', () => {
  let quits = 0;
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages: [] }, { onQuit: () => { quits++; } });

  ui.input('\x03');

  assert.equal(quits, 0);
  assert.match(ui.state().notice, /again to quit/i);
  ui.input('\x03');
  assert.equal(quits, 1);
});

test('a second Ctrl+C long after the first only warns again', () => {
  let quits = 0;
  let clock = 1000;
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages: [] }, { onQuit: () => { quits++; } }, { now: () => clock });

  ui.input('\x03');
  clock += 10000;
  ui.input('\x03');

  assert.equal(quits, 0);
  ui.input('\x03');
  assert.equal(quits, 1);
});

test('clearing a draft does not count towards quitting', () => {
  let quits = 0;
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages: [] }, { onQuit: () => { quits++; } });

  ui.input('x');
  ui.input('\x03');
  ui.input('\x03');

  assert.equal(quits, 0);
});

test('Ctrl+C on a tab with no input takes two presses too', () => {
  let quits = 0;
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages: [] }, { onQuit: () => { quits++; } });
  ui.input('\x1b[C');

  ui.input('\x03');
  assert.equal(quits, 0);
  ui.input('\x03');

  assert.equal(quits, 1);
});

test('Ctrl+Q quits at once, even with a draft', () => {
  let quits = 0;
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages: [] }, { onQuit: () => { quits++; } });

  ui.input('half a thought');
  ui.input('\x11');

  assert.equal(quits, 1);
});

test('a slash command comes back with the up arrow', () => {
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages: [] }, { send: async () => {} });

  ui.input('/help');
  ui.input('\r');
  ui.input('\x1b[A');

  assert.equal(ui.state().draft, '/help');
});

test('a command with a folder comes back whole', async () => {
  const ui = createDashboard(
    { ...snapshot, connection: 'connected', messages: [], work: { enabled: false } },
    { send: async () => {}, workAction: async () => ({}) },
  );

  ui.input('/work ~/Projects');
  ui.input('\r');
  await ui.pending();
  ui.input('\x1b[A');

  assert.equal(ui.state().draft, '/work ~/Projects');
});

test('Tab leaves a path alone while Hobkin is asking for a folder', () => {
  const ui = createDashboard(
    { ...snapshot, connection: 'connected', messages: [], work: { enabled: false } },
    { send: async () => {}, workAction: async () => ({}) },
  );
  ui.input('/work');
  ui.input('\r');

  ui.input('/w');
  ui.input('\t');

  assert.notEqual(ui.state().draft, '/work');
});

test('Tab on a command you typed yourself narrows from what you typed', () => {
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages: [] }, { send: async () => {} });

  ui.input('/r');
  ui.input('\t');
  ui.input('\t');

  assert.equal(ui.state().draft, '/reset');
});

test('Tab outside a slash command does what it did before', () => {
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages: [] }, { send: async () => {} });

  ui.input('/nothing');
  ui.input('\t');
  assert.equal(ui.state().draft.trim(), '/nothing');
});

test('the shortcut row narrows to the commands that still fit', () => {
  const betweenTips = 60000;
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages: [] }, { send: async () => {} }, { now: () => betweenTips });

  ui.input('/w');

  const text = screen(ui, 120, 30);
  assert.match(text, /\/work/);
  assert.doesNotMatch(text, /\/reset/);
});

const askForHelp = ui => {
  ui.input('/help');
  ui.input('\r');
};

test('/help adds one message from Hobkin at the end of Chat and leaves you in the composer', () => {
  const earlier = { id: 'one', role: 'user', content: 'hello', at: new Date(Date.now() - 60000).toISOString() };
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages: [earlier] }, { send: async () => {} });

  askForHelp(ui);

  assert.equal(ui.state().view, 'conversation');
  assert.equal(ui.state().focus, 'composer');
  assert.equal(ui.state().draft, '');
  const text = screen(ui, 120, 40);
  assert.match(text, /◆ You[\s\S]*◆ hobkin/);
  assert.equal(belowLogo(text).match(/◆ hobkin/g).length, 1);
});

test('/help sends nothing to the agent', async () => {
  const sent = [];
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages: [] }, { send: async text => { sent.push(text); } });

  ui.input('/help');
  ui.input('\r');
  await ui.pending();

  assert.deepEqual(sent, []);
});

test('what arrives after /help lands below the guide', () => {
  const live = { ...snapshot, connection: 'connected', messages: [] };
  const ui = createDashboard(live, { send: async () => {} });
  askForHelp(ui);

  ui.update({ ...live, messages: [{ id: 'later', role: 'user', content: 'a later question', at: soon() }] });

  assert.match(belowLogo(screen(ui, 120, 40)), /◆ hobkin[\s\S]*a later question/);
});

test('/help lands below a message still waiting for the agent', async () => {
  const ui = createDashboard({ ...snapshot, connection: 'connected', busy: true, messages: [] }, { send: async () => {} });
  ui.input('still waiting');
  ui.input('\r');
  await ui.pending();

  askForHelp(ui);

  assert.match(screen(ui, 120, 40), /still waiting[\s\S]*◆ hobkin/);
});

test('/help shows the guide even when Chat was scrolled back', () => {
  const messages = Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: `Message ${i}` }));
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages }, { send: async () => {} });
  ui.input('\x1b[5~');
  ui.input('\x1b[5~');

  askForHelp(ui);

  assert.match(belowLogo(screen(ui, 120, 40)), /◆ hobkin/);
});

test('/clear hides the guide, and /help can still show a new one', async t => {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-ui-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages: [] }, {
    send: async () => {},
    clear: ids => savePresentationState(root, ids),
  });
  askForHelp(ui);

  ui.input('/clear');
  ui.input('\r');
  await ui.pending();

  assert.match(ui.state().notice, /cleared/);
  assert.doesNotMatch(belowLogo(screen(ui, 120, 40)), /◆ hobkin/);

  askForHelp(ui);

  assert.match(belowLogo(screen(ui, 120, 40)), /◆ hobkin/);
});

test('an unknown command points at /help and keeps the draft', () => {
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages: [] }, { send: async () => {} });

  ui.input('/nope');
  ui.input('\r');

  assert.match(ui.state().notice, /\/help/);
  assert.equal(ui.state().draft, '/nope');
});

test('the face moves at the design\'s own speed', () => {
  const written = [];
  const images = new FaceImages({ write: data => written.push(data) });
  let clock = 1000;
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages: [] }, { send: async () => {} }, { images, now: () => clock });
  const frameAt = time => {
    clock = time;
    return ui.render(120, 30).filter(value => value.includes('\u{10EEEE}\u0305')).at(-1);
  };

  const first = frameAt(1000);
  const uploads = written.length;

  assert.notEqual(frameAt(2500), first);
  assert.equal(written.length, uploads, 'no image data moves after the first upload');
});

test('Pi\'s screen code is kept away from the pictures, at first paint, on resize and on exit', async t => {
  const terminal = new FakeTerminal();
  const protocol = process.env.PI_IMAGE_PROTOCOL;
  process.env.PI_IMAGE_PROTOCOL = 'kitty';
  t.after(() => {
    if (protocol === undefined) delete process.env.PI_IMAGE_PROTOCOL;
    else process.env.PI_IMAGE_PROTOCOL = protocol;
    setCapabilityOverrides({});
  });
  const images = new FaceImages({ write: data => terminal.write(data) });

  const ui = startDashboard({ ...snapshot, connection: 'connected', messages: [] }, { send: async () => {} }, { terminal, images });
  await new Promise(resolve => { setTimeout(resolve, 40); });
  terminal.columns = 130;
  terminal.resize();
  await new Promise(resolve => { setTimeout(resolve, 40); });
  ui.stop();

  const output = terminal.writes.join('');
  assert.match(output, /a=T/);
  assert.doesNotMatch(output, /d=A/);
  assert.match(output, /a=d,d=I/);
});

test('the face starts moving as soon as it is drawn', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let redraws = 0;
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages: [] }, { send: async () => {} }, { onChange: () => { redraws++; } });

  ui.render(100, 30);
  t.mock.timers.tick(1000);

  assert.ok(redraws > 1, `redrew ${redraws} times`);
  ui.stop();
});

test('a narrow or short terminal keeps the whole input instead of the face', () => {
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages: [] }, { send: async () => {} });
  const leftOf = (width, height) => {
    const rows = screen(ui, width, height).split('\n');
    return rows[rows.findIndex(value => value.includes('Message hobkin'))].indexOf('Message hobkin');
  };

  assert.ok(leftOf(100, 30) > 14);
  assert.ok(leftOf(60, 30) < 14);
  assert.ok(leftOf(100, 14) < 14);
});

test('the face follows the work: thinking on a turn, working while a check or work mode runs', () => {
  const live = { ...snapshot, connection: 'connected', messages: [] };
  const running = { id: 'one', kind: 'background', state: 'running', scheduleId: 'check', title: 'Check', startedAt: new Date().toISOString() };
  const ui = createDashboard(live);
  assert.equal(ui.state().mood, 'idle');

  ui.update({ ...live, busy: true });
  assert.equal(ui.state().mood, 'thinking');

  ui.update({ ...live, runs: [running] });
  assert.equal(ui.state().mood, 'working');

  ui.update({ ...live, work: { enabled: true, discovering: true, projects: [] } });
  assert.equal(ui.state().mood, 'working');

  ui.update(live);
  assert.equal(ui.state().mood, 'idle');
});

test('a reaction the application chose shows on the face', () => {
  const live = { ...snapshot, connection: 'connected', messages: [] };
  const ui = createDashboard({ ...live, mood: { mood: 'celebrating', until: Date.now() + 60000 } });

  assert.equal(ui.state().mood, 'celebrating');
});

test('chat opens at the latest message and pages through history while input remains active', () => {
  const messages = Array.from({ length: 20 }, (_, i) => ({ role: 'assistant', content: `Message ${i} ` + 'hello '.repeat(20) }));
  const ui = createDashboard({ ...snapshot, messages });
  assert.match(screen(ui, 60, 18), /Message 19/);
  for (let i = 0; i < 20; i++) ui.input('\x1b[5~');
  assert.match(screen(ui, 60, 18), /Message 0\b/);
  for (let i = 0; i < 20; i++) ui.input('\x1b[6~');
  assert.match(screen(ui, 60, 18), /Message 19/);
  ui.input('draft');
  assert.equal(ui.state().focus, 'composer');
  assert.equal(ui.state().draft, 'draft');
});

test('arrow keys cycle views with an empty composer and keep editing nonempty drafts native', () => {
  const ui = createDashboard(snapshot);
  for (const [input, view] of [
    ['\x1b[C', 'reports'], ['\x1b[C', 'schedules'], ['\x1b[C', 'conversation'],
    ['\x1b[D', 'schedules'], ['\x1b[D', 'reports'], ['\x1b[D', 'conversation'],
  ]) {
    ui.input(input);
    assert.equal(ui.state().view, view);
  }
  ui.input('unsent');
  ui.input('\x1b[D');
  ui.input('X');
  ui.input('\x1b[C');
  ui.input('!');
  assert.equal(ui.state().draft, 'unsenXt!');
  assert.equal(ui.state().view, 'conversation');
});

test('accepted sends clear draft and reveal conversation', async () => {
  const sent = [];
  const ui = createDashboard({ ...snapshot, connection: 'connected' }, {
    send: async text => { sent.push(text); },
  });
  ui.input('こんにちは');
  ui.input('\r');
  await ui.pending();
  assert.deepEqual(sent, ['こんにちは']);
  assert.equal(ui.state().draft, '');
  assert.equal(ui.state().view, 'conversation');
  assert.equal(ui.state().focus, 'composer');
});

test('Unicode, paste and terminal controls are bounded across wide, narrow and resize layouts', () => {
  const ui = createDashboard({
    ...snapshot,
    reports: [{
      id: 'evil',
      title: '\x1b[2J题',
      body: '\x1b]8;;https://bad\x07unsafe\x1b]8;;\x07 ' + '🌍'.repeat(100),
      outcome: 'findings',
    }],
  });
  ui.input('\x1b[C');
  ui.input('\r');
  for (const [width, height] of [[120, 40], [80, 24], [60, 18], [30, 8]]) {
    const lines = ui.render(width, height);
    assert.ok(lines.length <= height);
    assert.ok(lines.every(line => visibleWidth(line) <= width));
    assert.doesNotMatch(lines.join(''), /\x1b\[2J|\x1b\]|https:\/\/bad/);
  }
  ui.input('\x1b[D');
  ui.input('\x1b[200~hello 🌍\x1b[201~');
  assert.match(ui.state().draft, /hello 🌍/);
});

test('fullscreen input reaches dashboard pagination and composer boundaries', t => {
  const terminal = new FakeTerminal();
  const bindings = getKeybindings().getUserBindings();
  const runs = Array.from({ length: 20 }, (_, index) => ({
    state: 'invalid',
    title: `broken-${index}.md: invalid routine`,
  }));
  const ui = startDashboard({ ...snapshot, runs }, {}, { terminal });
  t.after(() => ui.stop());

  terminal.input('\x1b[D');
  terminal.input('\x1b[6~');
  assert.equal(ui.state().scroll, 8);
  terminal.input('\x1b[5~');
  assert.equal(ui.state().scroll, 0);
  for (let page = 0; page < 20; page++) terminal.input('\x1b[6~');
  assert.match(screen(ui, 60, 18), /broken-19\.md/);

  terminal.input('\x1b[C');
  terminal.input('middle');
  terminal.input('\x1b[H');
  terminal.input('start-');
  terminal.input('\x1b[F');
  terminal.input('-end');
  assert.equal(ui.state().draft, 'start-middle-end');
  terminal.input('\x1b[6~');
  assert.equal(ui.state().draft, 'start-middle-end');

  ui.stop();
  assert.deepEqual(getKeybindings().getUserBindings(), bindings);
});

test('view arrows preserve an open question and its selected choice', async t => {
  const terminal = new FakeTerminal();
  const ui = startDashboard(snapshot, {}, { terminal });
  t.after(() => ui.stop());
  for (const view of ['schedules', 'reports', 'conversation']) {
    terminal.input('\x1b[D');
    assert.equal(ui.state().view, view);
  }
  terminal.input('\x1b[C');
  const answer = ui.askQuestion({
    question: 'Continue?',
    choices: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }],
  });
  terminal.input('\x1b[B');
  terminal.input('\x1b[C');
  terminal.input('\x1b[D');
  assert.equal(ui.state().view, 'reports');
  assert.equal(ui.state().focus, 'question');
  assert.match(screen(ui, 120, 40), /→ Yes/);
  terminal.input('\x1b');
  assert.equal(await answer, null);
});

test('real TUI routes mouse wheels to the chat, not the editor or outer screen', async t => {
  const terminal = new FakeTerminal();
  const messages = Array.from({ length: 30 }, (_, i) => ({ role: 'assistant', content: `Message ${i}` }));
  const ui = startDashboard({ ...snapshot, messages }, {}, { terminal });
  t.after(() => ui.stop());
  terminal.input('draft');
  await new Promise(resolve => setImmediate(resolve));
  for (const [columns, rows] of [[120, 40], [80, 24], [60, 18]]) {
    terminal.columns = columns;
    terminal.rows = rows;
    terminal.resize();
    const latest = screen(ui, columns, rows);
    terminal.input('\x1b[<64;10;8M');
    assert.equal(ui.state().scroll, 3);
    assert.notEqual(screen(ui, columns, rows), latest);
    terminal.input(`\x1b[<65;10;${rows - 1}M`); // Wheel over composer does not scroll history.
    assert.equal(ui.state().scroll, 3);
    terminal.input('\x1b[<65;10;8M');
    assert.equal(ui.state().scroll, 0);
    assert.equal(ui.state().draft, 'draft');
    assert.equal(ui.state().focus, 'composer');
  }
  ui.stop();
  assert.ok(terminal.writes.some(value => value.includes('\x1b[?1006h')));
  assert.ok(terminal.writes.some(value => value.includes('\x1b[?1006l')));
});

test('terminal cell-size replies invalidate the mounted component without losing input or reports', t => {
  const terminal = new FakeTerminal();
  const dimensions = getCellDimensions();
  const ui = startDashboard(snapshot, {}, { terminal });
  t.after(() => {
    ui.stop();
    setCellDimensions(dimensions);
  });
  terminal.input('\x1b[C');
  terminal.input('\r');
  ui.update({ ...snapshot, reports: [{ ...snapshot.reports[0], body: 'Updated report' }] });
  assert.match(screen(ui, 120, 40), /Updated report/);
  terminal.input('\x1b[D');
  terminal.input('draft');

  terminal.input('\x1b[6;20;10t');
  assert.deepEqual(getCellDimensions(), { widthPx: 10, heightPx: 20 });
  assert.equal(ui.state().draft, 'draft');
  terminal.columns = 60;
  terminal.rows = 18;
  terminal.resize();
  terminal.input('\x1b[6;24;12t');
  terminal.input('!');

  assert.equal(ui.state().draft, 'draft!');
});

test('fullscreen lifecycle preserves the draft and restores the parent terminal', t => {
  const terminal = new FakeTerminal();
  let quits = 0;
  const ui = startDashboard(snapshot, { onQuit: () => { quits++; } }, { terminal });
  t.after(() => ui.stop());
  terminal.input('hello');
  terminal.input('\x1b');
  ui.update({ ...snapshot, reports: [...snapshot.reports, { id: 'three', title: 'Third', body: '', at: '', outcome: '' }] });
  terminal.columns = 60;
  terminal.rows = 18;
  terminal.resize();
  assert.equal(ui.state().draft, 'hello');
  terminal.input('\x1b[D');
  assert.equal(ui.state().view, 'conversation');
  terminal.input('\x11');
  assert.equal(quits, 1);
  assert.ok(terminal.writes[0].startsWith('\x1b[?1049h'));
  assert.ok(terminal.writes.every(data => !data.includes('\x1b[?1049l')));
  ui.stop();
  const restored = terminal.writes.find(data => data.includes('\x1b[?1049l'));
  assert.ok(restored);
  assert.equal(stripVTControlCharacters(restored.split('\x1b[?1049l')[1]), '');
});

test('native editing supports word/line shortcuts, undo, multiline submission and history', async () => {
  const sent = [];
  const ui = createDashboard({ ...snapshot, connection: 'connected' }, { send: async text => sent.push(text) });
  ui.input('first second');
  ui.input('\x17'); // Ctrl+W
  assert.equal(ui.state().draft, 'first ');
  ui.input('\x19'); // Ctrl+Y
  ui.input('\x1bb'); // Alt+B
  ui.input('new ');
  assert.equal(ui.state().draft, 'first new second');
  ui.input('\x01'); // Ctrl+A
  ui.input('\x0b'); // Ctrl+K
  assert.equal(ui.state().draft, '');
  ui.input('\x1f'); // Ctrl+- / undo
  assert.equal(ui.state().draft, 'first new second');
  ui.input('\x05'); // Ctrl+E
  ui.input('\n'); // Ctrl+J
  ui.input('next line');
  ui.input('\r');
  await ui.pending();
  assert.deepEqual(sent, ['first new second\nnext line']);
  ui.input('\x1b[A');
  assert.equal(ui.state().draft, sent[0]);
});

test('typing carries on while a message goes out, and long multiline drafts remain within the terminal', async () => {
  const gate = Promise.withResolvers();
  const ui = createDashboard({ ...snapshot, connection: 'connected' }, { send: () => gate.promise });
  ui.input('first');
  ui.input('\r');
  ui.input('second');
  gate.resolve();
  await ui.pending();
  assert.equal(ui.state().draft, 'second');
  for (let i = 0; i < 20; i++) {
    ui.input('\n');
    ui.input(`line ${i}`);
  }
  for (const [width, height] of [[120, 40], [80, 24], [60, 18]]) {
    const lines = ui.render(width, height);
    assert.ok(lines.length <= height);
    assert.ok(lines.every(value => visibleWidth(value) <= width));
    assert.ok(lines.some(value => value.includes(CURSOR_MARKER)));
  }
});

test('only visible chat entries have author blocks', () => {
  const messages = [
    { role: 'user', content: 'Question' },
    { role: 'assistant', content: '' },
    { role: 'assistant', content: '  ' },
    { role: 'assistant', content: 'Reply' },
  ];
  const ui = createDashboard({ ...snapshot, messages, busy: true, connection: 'connected', memoryBytes: 2048 });

  const rendered = screen(ui, 80, 24).split('\n');
  assert.equal(rendered.slice(1).filter(value => /^\s*◆ hobkin\b/.test(value)).length, 1);
  assert.match(rendered[0], /● connected/);
});

test('while the main agent works, the row above the input says what it is doing and for how long', () => {
  const messages = [{ role: 'user', content: 'Question' }];
  let now = Date.parse('2026-10-29T18:08:00Z');
  const ui = createDashboard({ ...snapshot, messages, busy: true, doing: 'researching', connection: 'connected' }, {}, { now: () => now });
  now += 15000;

  const rendered = screen(ui, 80, 24).split('\n');
  const working = rendered.findIndex(value => /hobkin is researching… +15s\s*$/.test(value));
  assert.ok(working > 0, rendered.join('\n'));
  assert.match(rendered[working + 1], /─{20,}\s*$/, 'the input starts on the next row');

  ui.update({ ...snapshot, messages, busy: true, connection: 'connected' });
  assert.match(screen(ui, 80, 24), /hobkin is thinking…/, 'before it says anything, it is thinking');

  ui.update({ ...snapshot, messages, busy: false, connection: 'connected' });
  assert.doesNotMatch(screen(ui, 80, 24), /hobkin is /, 'and the row goes when the turn ends');
});

test('busy or live-job activity animates only while work runs and never after stop', async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const busy = { ...snapshot, connection: 'connected', busy: true };
  const idle = { ...snapshot, connection: 'connected', busy: false };
  const runningJob = { ...idle, runs: [{ id: 'a', title: 'Check', state: 'running', kind: 'background', scheduleId: 'mail' }] };
  let frames = 0;
  const ui = createDashboard(busy, {}, { onChange: () => { frames++; } });

  await wait(350);
  assert.ok(frames >= 2, `expected animation frames while busy, got ${frames}`);

  ui.update(idle);
  const idleFrames = frames;
  await wait(250);
  assert.equal(frames, idleFrames);

  ui.update(runningJob);
  const jobFrames = frames;
  await wait(350);
  assert.ok(frames >= jobFrames + 2, 'expected animation frames while a live job runs');

  ui.stop();
  const stoppedFrames = frames;
  await wait(250);
  assert.equal(frames, stoppedFrames);
});

test('fullscreen editor loads namespaced Pi typing bindings without changing the file', t => {
  const agentDir = mkdtempSync(join(tmpdir(), 'hobkin-keybindings-'));
  t.after(() => rmSync(agentDir, { recursive: true, force: true }));
  writeFileSync(join(agentDir, 'keybindings.json'), JSON.stringify({ 'tui.editor.cursorLineStart': 'ctrl+g' }));
  const terminal = new FakeTerminal();
  const ui = startDashboard(snapshot, {}, { terminal, agentDir });
  t.after(() => ui.stop());
  terminal.input('end');
  terminal.input('\x07');
  terminal.input('start ');
  assert.equal(ui.state().draft, 'start end');
});

test('fullscreen dashboard follows the saved Pi theme and switches live when the setting changes', async t => {
  const agentDir = mkdtempSync(join(tmpdir(), 'hobkin-theme-'));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const terminal = new FakeTerminal();
  let ui;
  t.after(() => {
    ui?.stop();
    resetCapabilitiesCache();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(agentDir, { recursive: true, force: true });
  });
  process.env.PI_CODING_AGENT_DIR = agentDir;
  setCapabilities({ ...getCapabilities(), trueColor: true });
  const piDark = new URL('modes/interactive/theme/dark.json', import.meta.resolve('@earendil-works/pi-coding-agent'));
  const base = JSON.parse(readFileSync(piDark, 'utf8'));
  const saveTheme = (name, accent) => writeFileSync(join(agentDir, 'themes', `${name}.json`),
    JSON.stringify({ ...base, name, colors: { ...base.colors, accent, mdHeading: accent } }));
  const chooseTheme = name => writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ theme: name }));
  const brandRow = () => ui.render(120, 40)[0];
  const authorRow = () => ui.render(120, 40).slice(1).find(value => value.includes('◆ hobkin'));
  mkdirSync(join(agentDir, 'themes'));
  saveTheme('ocean', '#0a84ff');
  saveTheme('ember', '#ff6a00');
  chooseTheme('ocean');

  const messages = [{ id: 'one', role: 'assistant', content: 'Hello' }];
  ui = startDashboard({ ...snapshot, messages }, {}, { terminal, theme: { cwd: agentDir } });
  assert.match(brandRow(), /\x1b\[38;2;10;132;255m◆/);
  assert.match(authorRow(), /\x1b\[38;2;10;132;255m/);

  // macOS can drop a write made in the same moment a file watch starts.
  await new Promise(resolve => setTimeout(resolve, 50));
  chooseTheme('ember');
  for (const deadline = Date.now() + 3000; !brandRow().includes('\x1b[38;2;255;106;0m◆') && Date.now() < deadline;) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.match(brandRow(), /\x1b\[38;2;255;106;0m◆/);
  assert.match(authorRow(), /\x1b\[38;2;255;106;0m/, 'a message does not keep the rows of the old theme');

  ui.stop();
  assert.match(createDashboard(snapshot).render(120, 40)[0], /\x1b\[38;2;255;121;198m◆/);
});

test('selectable questions preserve drafts, require confirmation, and cancel on Escape or shutdown', async t => {
  const terminal = new FakeTerminal();
  const ui = startDashboard({ ...snapshot, connection: 'connected', messages: [{ id: 'main', role: 'assistant', content: 'Retained main chat' }] }, {}, { terminal });
  t.after(() => ui.stop());
  const request = {
    question: 'Keep these routines paused?',
    choices: Array.from({ length: 6 }, (_, i) => ({
      value: `choice-${i}`,
      label: `Choice ${i}: ${'a long readable answer '.repeat(2)}`,
    })),
  };
  terminal.input('my draft');
  const answer = ui.askQuestion(request);
  let settled = false;
  answer.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(await ui.askQuestion(request), undefined); // No competing question replaces it.
  for (let i = 0; i < 5; i++) terminal.input('\x1b[B');
  for (const [width, height] of [[120, 40], [80, 24], [60, 18]]) {
    const lines = ui.render(width, height);
    assert.ok(lines.length <= height);
    assert.match(stripTerminalSequences(lines.join('\n')), /Choice 5/);
    assert.match(stripTerminalSequences(lines.join('\n')), /Retained main chat/);
    assert.ok(lines.every(value => visibleWidth(value) <= width));
  }
  terminal.input('\r');
  assert.equal(await answer, 'choice-5');
  assert.equal(ui.state().draft, 'my draft');
  assert.equal(ui.state().focus, 'composer');
  const cancelled = ui.askQuestion(request);
  terminal.input('\x1b');
  assert.equal(await cancelled, null);
  assert.equal(ui.state().draft, 'my draft');
  const pending = ui.askQuestion(request);
  ui.stop();
  assert.equal(await pending, null);
});

const UP = '\x1b[A';
const DOWN = '\x1b[B';
const ESCAPE = '\x1b';
const abc = { question: 'Which one?', other: true, choices: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Bravo' }, { value: 'c', label: 'Charlie' }] };
const typing = (ui, text) => { for (const letter of text) ui.input(letter); };

test('Other takes a typed answer, Enter waits for one, and moving away keeps it', async () => {
  const ui = createDashboard(snapshot);
  const answer = ui.askQuestion(abc);
  assert.match(screen(ui, 80, 24), /Other/);

  ui.input(UP);
  ui.input('\r');
  assert.equal(ui.state().focus, 'question', 'an empty Other is not an answer');

  typing(ui, 'neither');
  ui.input(DOWN);
  ui.input(UP);
  assert.match(screen(ui, 80, 24), /> neither/);

  ui.input('\r');
  assert.deepEqual(await answer, { typed: 'neither' });
  assert.equal(ui.state().focus, 'composer');
  ui.stop();
});

test('what the user was typing as a question opened never becomes an answer', async () => {
  const ui = createDashboard(snapshot);
  const answer = ui.askQuestion(abc);

  typing(ui, 'half a thought');
  ui.input(UP);
  assert.doesNotMatch(screen(ui, 80, 24), /half a thought/);

  ui.input(DOWN);
  ui.input('\r');
  assert.equal(await answer, 'a');
  ui.stop();
});

test('Esc chooses none, even with an answer half typed', async () => {
  const ui = createDashboard(snapshot);
  const answer = ui.askQuestion(abc);
  ui.input(UP);
  typing(ui, 'nei');

  ui.input(ESCAPE);

  assert.equal(await answer, null);
  ui.stop();
});

test('a question that did not ask for Other stays a closed list', async () => {
  const ui = createDashboard(snapshot);
  const answer = ui.askQuestion({ ...abc, other: false });

  assert.doesNotMatch(screen(ui, 80, 24), /Other/);

  ui.input(UP);
  ui.input('\r');
  assert.equal(await answer, 'c');
  ui.stop();
});

test('a question nobody needs right now waits for the user to stop typing', async () => {
  const ui = createDashboard(snapshot);
  typing(ui, 'half a thought');

  assert.equal(await ui.askQuestion({ ...abc, whenQuiet: true }), undefined);
  assert.equal(ui.state().focus, 'composer');
  assert.equal(ui.state().draft, 'half a thought');

  for (const _letter of 'half a thought') ui.input('\x7f');
  const answer = ui.askQuestion({ ...abc, whenQuiet: true });
  assert.equal(ui.state().focus, 'question');

  ui.input(ESCAPE);
  assert.equal(await answer, null);
  ui.stop();
});

test('typing past a question nobody needs dismisses it, and the letter lands in the composer', async () => {
  const ui = createDashboard(snapshot);
  const answer = ui.askQuestion({ ...abc, other: false, whenQuiet: true });

  ui.input('/');

  assert.equal(await answer, null);
  assert.equal(ui.state().focus, 'composer');
  assert.equal(ui.state().draft, '/');
  ui.stop();
});

test('arrows and Enter still answer a question nobody needs', async () => {
  const ui = createDashboard(snapshot);
  const answer = ui.askQuestion({ ...abc, other: false, whenQuiet: true });

  ui.input(DOWN);
  ui.input('\r');

  assert.equal(await answer, 'b');
  ui.stop();
});

const cardRequest = {
  question: '9 waiting. How do you want to tackle them?',
  groups: [
    { name: 'ready', count: 3, label: 'ready', fact: 'safe A, about 120 lines' },
    { name: 'questions', count: 6, label: 'questions', fact: 'oldest 3 days' },
  ],
  choices: [{ value: 'later', label: 'Not now' }, { value: 'ready', label: 'Start with the 3 ready' }, { value: 'walk', label: 'Walk it all' }],
  other: true,
  whenQuiet: true,
};

test('a card shows its rows and its numbered choices, and Enter takes Not now', async () => {
  const ui = createDashboard(snapshot);
  const answer = ui.askPending(cardRequest);

  const shown = screen(ui, 80, 24);
  assert.match(shown, /9 waiting\. How do you want to tackle them\?/);
  assert.match(shown, /● 3 ready\s+safe A, about 120 lines/);
  assert.match(shown, /\? 6 questions\s+oldest 3 days/);
  assert.match(shown, /1 Not now/);
  assert.match(shown, /2 Start with the 3 ready/);

  ui.input('\r');

  assert.equal(await answer, 'later');
  ui.stop();
});

test('a digit answers a card at once, and a digit with no choice is typing past it', async () => {
  const ui = createDashboard(snapshot);

  const answer = ui.askPending(cardRequest);
  ui.input('3');
  assert.equal(await answer, 'walk');

  const typedPast = ui.askPending(cardRequest);
  ui.input('7');
  assert.equal(await typedPast, null);
  assert.equal(ui.state().draft, '7');
  ui.stop();
});

test('the Other row on a card takes words, however quiet the card is', async () => {
  const ui = createDashboard(snapshot);
  const answer = ui.askPending(cardRequest);

  for (const _row of cardRequest.choices) ui.input(DOWN);
  typing(ui, 'drop 2 of them');
  ui.input('\r');

  assert.deepEqual(await answer, { typed: 'drop 2 of them' });
  ui.stop();
});

test('a card left alone goes by itself, and using it keeps it open', async () => {
  const ui = createDashboard(snapshot);
  assert.equal(await ui.askPending({ ...cardRequest, waitMs: 5 }), null);

  const answer = ui.askPending({ ...cardRequest, waitMs: 5 });
  ui.input(DOWN);
  await new Promise(resolve => { setTimeout(resolve, 20); });
  ui.input('\r');

  assert.equal(await answer, 'ready');
  ui.stop();
});

test('a card takes no screen from a draft', async () => {
  const ui = createDashboard(snapshot);
  typing(ui, 'half a thought');

  assert.equal(await ui.askPending(cardRequest), undefined);
  ui.stop();
});

test('a key or a click says the user is there, and a screen in use is not free', () => {
  let clock = 1000;
  const ui = createDashboard(snapshot, {}, { now: () => clock });
  assert.deepEqual(ui.presence(), { seenAt: 1000, away: false, occupied: false });

  clock = 2000;
  ui.input('h');
  assert.deepEqual(ui.presence(), { seenAt: 2000, away: false, occupied: true });

  clock = 3000;
  ui.input('\x7f');
  ui.handleMouse({ type: 'press', button: 'left', x: 0, y: 30 });
  assert.deepEqual(ui.presence(), { seenAt: 3000, away: false, occupied: false });

  clock = 4000;
  ui.handleMouse({ type: 'move', button: 'none', x: 0, y: 30 });
  assert.equal(ui.presence().seenAt, 3000);
  ui.stop();
});

test('a question on screen, or the Decisions tab or Done in use, leaves no room for a card', async () => {
  const ui = createDashboard({ ...snapshot, decisions: [{ id: 'one', tldr: 'One', from: 'Mail', question: 'One?', choices: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }] });

  const answer = ui.askQuestion(abc);
  assert.equal(ui.presence().occupied, true);
  ui.input(ESCAPE);
  await answer;
  assert.equal(ui.presence().occupied, false);

  ui.showRow({ tab: 'decisions' });
  assert.equal(ui.presence().occupied, true);
  ui.stop();
});

test('hobkin reads the focus reports pi-tui turns on and keeps to itself', t => {
  const terminal = new FakeTerminal();
  let clock = 1000;
  const ui = startDashboard(snapshot, {}, { terminal, now: () => clock, motion: false });
  t.after(() => ui.stop());
  assert.ok(terminal.writes.some(data => data.includes('\x1b[?1004h')));

  clock = 2000;
  terminal.input('\x1b[O');
  assert.deepEqual([ui.presence().seenAt, ui.presence().away], [1000, true]);

  clock = 3000;
  terminal.input('\x1b[I');
  assert.deepEqual([ui.presence().seenAt, ui.presence().away], [3000, false]);

  terminal.input('\x1b[O');
  clock = 4000;
  terminal.input('x');
  assert.deepEqual([ui.presence().seenAt, ui.presence().away], [4000, false], 'with no focus reports, a key is enough');
});

test('a card opens the row it was about', () => {
  const report = { id: 'bad', title: 'Site is down', at: '2026-10-27', body: 'The site is down.', outcome: 'completed' };
  const ui = createDashboard({ ...snapshot, reports: [...snapshot.reports, report], work: { enabled: true, projects: [], ready: [] } });

  ui.showRow({ tab: 'reports', report: 'bad' });
  assert.deepEqual([ui.state().view, ui.state().focus, ui.state().selectedId], ['reports', 'detail', 'bad']);
  assert.match(screen(ui, 80, 24), /The site is down\./);

  ui.showRow({ tab: 'work' });
  assert.deepEqual([ui.state().view, ui.state().focus], ['work', 'work']);

  ui.showRow({ tab: 'done' });
  assert.equal(ui.state().view, 'work');
  assert.match(screen(ui, 80, 24), /Nothing is waiting/);

  ui.showRow({ tab: 'chat' });
  assert.deepEqual([ui.state().view, ui.state().focus], ['conversation', 'composer']);
  ui.stop();
});

test('every choice shows at once when the terminal has room, and a small one still fits', async () => {
  const ui = createDashboard(snapshot);
  const labels = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];
  const answer = ui.askQuestion({ question: 'Which?', other: true, choices: labels.map(label => ({ value: label, label })) });

  for (const [width, height] of [[120, 40], [80, 24]]) {
    const shown = screen(ui, width, height);
    for (const label of [...labels, 'Other']) assert.match(shown, new RegExp(`\\b${label}\\b`), `${label} at ${width}x${height}`);
  }

  const lines = ui.render(60, 18);
  assert.ok(lines.length <= 18);
  assert.ok(lines.every(line => visibleWidth(line) <= 60));

  ui.input(ESCAPE);
  await answer;
  ui.stop();
});

test('footer questions retain the main view and scroll while paging long text independently', async () => {
  for (const [width, height] of [[120, 40], [80, 24], [60, 18]]) {
    const ui = createDashboard({ ...snapshot, messages: [{ id: 'main', role: 'assistant', content: 'Main conversation retained' }] });
    ui.input('\x1b[C');
    ui.input('\r');
    ui.input('\x1b[6~');
    const before = ui.state();
    const abort = new AbortController();
    const answer = ui.askQuestion({
      question: 'Footer question ' + 'long question '.repeat(50),
      choices: [{ value: 'yes', label: 'Yes ' + 'long choice '.repeat(50) + 'CHOICE END' }],
    }, abort.signal);
    let rendered = screen(ui, width, height);
    assert.equal(ui.state().view, before.view);
    assert.match(rendered, /Initial observations/);
    assert.match(rendered, /Footer question/);
    assert.match(rendered, /→ Yes/);
    for (let i = 0; i < 40; i++) { ui.input('\x1b[6~'); screen(ui, width, height); }
    rendered = screen(ui, width, height);
    assert.match(rendered, /CHOICE END/);
    assert.equal(ui.state().scroll, before.scroll);
    assert.ok(ui.render(width, height).length <= height);
    assert.ok(ui.render(width, height).every(value => visibleWidth(value) <= width));
    abort.abort();
    assert.equal(await answer, null);
    assert.deepEqual(ui.state(), before);
  }
});

test('page keys read the conversation behind a question that fits, and answering puts it back', async () => {
  const plan = Array.from({ length: 30 }, (_, index) => `Plan line ${index}`).join('\n\n');
  const ui = createDashboard({ ...snapshot, messages: [{ id: 'plan', role: 'assistant', content: plan }] });
  const answer = ui.askQuestion({ question: 'Go ahead?', choices: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }] });

  const rendered = screen(ui, 80, 24);
  assert.match(rendered, /Plan line 29/);
  assert.doesNotMatch(rendered, /Plan line 0\b/);

  for (let i = 0; i < 20; i++) { ui.input('\x1b[5~'); screen(ui, 80, 24); }
  assert.match(screen(ui, 80, 24), /Plan line 0\b/);
  assert.match(screen(ui, 80, 24), /Go ahead\?/);

  ui.input('\x1b[6~');
  assert.doesNotMatch(screen(ui, 80, 24), /Plan line 0\b/, 'it comes back as soon as the keys turn around');
  ui.input('\r');
  assert.equal(await answer, 'no');
  assert.equal(ui.state().scroll, 0);
  assert.match(screen(ui, 80, 24), /Plan line 29/);
});

test('page keys still read a question too long for its box, in Chat too', async () => {
  const ui = createDashboard({ ...snapshot, messages: [{ id: 'main', role: 'assistant', content: 'Main conversation' }] });
  const abort = new AbortController();
  const answer = ui.askQuestion({
    question: `Footer question ${'long question '.repeat(30)}QUESTIONEND`,
    choices: [{ value: 'yes', label: 'Yes' }],
  }, abort.signal);
  assert.doesNotMatch(screen(ui, 60, 18), /QUESTIONEND/);

  for (let i = 0; i < 20; i++) { ui.input('\x1b[6~'); screen(ui, 60, 18); }

  assert.match(screen(ui, 60, 18), /QUESTIONEND/);
  abort.abort();
  await answer;
});

test('the wheel reads the conversation behind a question, and over the box a question too long for it', async () => {
  const plan = Array.from({ length: 30 }, (_, index) => `Plan line ${index}`).join('\n\n');
  const ui = createDashboard({ ...snapshot, messages: [{ id: 'plan', role: 'assistant', content: plan }] });
  const short = new AbortController();
  const fits = ui.askQuestion({ question: 'Go ahead?', choices: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }] }, short.signal);
  assert.doesNotMatch(screen(ui, 80, 24), /Plan line 0\b/);

  for (let i = 0; i < 40; i++) { ui.handleMouse({ type: 'wheel', x: 10, y: 5, wheelDelta: -3 }); screen(ui, 80, 24); }

  assert.match(screen(ui, 80, 24), /Plan line 0\b/);
  short.abort();
  await fits;

  const long = new AbortController();
  const tooLong = ui.askQuestion({ question: `Go ahead? ${'long question '.repeat(30)}QUESTIONEND`, choices: [{ value: 'yes', label: 'Yes' }] }, long.signal);
  assert.doesNotMatch(screen(ui, 60, 18), /QUESTIONEND/);

  for (let i = 0; i < 20; i++) { ui.handleMouse({ type: 'wheel', x: 10, y: 16, wheelDelta: 3 }); screen(ui, 60, 18); }

  assert.match(screen(ui, 60, 18), /QUESTIONEND/);
  long.abort();
  await tooLong;
});

test('page up reads the conversation behind a question too long for its box, once its own text is at the top', async () => {
  const plan = Array.from({ length: 30 }, (_, index) => `Plan line ${index}`).join('\n\n');
  const ui = createDashboard({ ...snapshot, messages: [{ id: 'plan', role: 'assistant', content: plan }] });
  const abort = new AbortController();
  const answer = ui.askQuestion({ question: `Go ahead? ${'long question '.repeat(30)}QUESTIONEND`, choices: [{ value: 'yes', label: 'Yes' }] }, abort.signal);

  for (let i = 0; i < 30; i++) { ui.input('\x1b[5~'); screen(ui, 60, 18); }

  assert.match(screen(ui, 60, 18), /Plan line 0\b/);
  abort.abort();
  await answer;
});

test('/reset waits for backend acceptance and retains draft and chat on failure or unavailable callback', async () => {
  for (const reset of [undefined, () => { throw Error('busy'); }]) {
    const ui = createDashboard(snapshot, { reset });
    ui.input('/reset');
    ui.input('\r');
    await ui.pending();
    assert.equal(ui.state().draft, '/reset');
    assert.match(ui.state().notice, /Reset failed/);
  }
  const gate = Promise.withResolvers();
  let calls = 0;
  const ui = createDashboard(snapshot, { reset: () => { calls++; return gate.promise; } });
  ui.input('/reset');
  ui.input('\r');
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(ui.state().draft, '/reset');
  gate.resolve();
  await ui.pending();
  assert.equal(ui.state().draft, '');
  assert.match(ui.state().notice, /reset/i);
});

test('entered text while busy or awaiting acceptance is forwarded through the normal send callback', async () => {
  const gate = Promise.withResolvers();
  const sent = [];
  const ui = createDashboard({ ...snapshot, connection: 'connected', busy: true }, {
    send: text => { sent.push(text); return sent.length === 1 ? gate.promise : Promise.resolve(); },
  });
  ui.input('first');
  ui.input('\r');
  await Promise.resolve();
  ui.input('\x01');
  ui.input('\x0b');
  ui.input('steer');
  ui.input('\r');
  await Promise.resolve();
  gate.resolve();
  await ui.pending();
  assert.deepEqual(sent, ['first', 'steer']);
});

test('/clear hides only visible chat across refreshes while local commands never become prompts', async () => {
  const messages = [{ id: 'old', role: 'assistant', content: 'Old answer' }];
  const initial = { ...snapshot, messages, busy: true, context: { tokens: 100, contextWindow: 1000, percent: 10 } };
  let calls = 0;
  const ui = createDashboard(initial, { send: () => { calls++; } });
  const submit = async text => {
    ui.input(text);
    ui.input('\r');
    await ui.pending();
  };
  await submit('/clear'); // Available even offline.
  assert.equal(ui.state().draft, '');
  assert.doesNotMatch(screen(ui, 80, 24), /Old answer/);
  ui.update({ ...initial, messages: [...messages, { id: 'new', role: 'assistant', content: 'New answer' }] });
  assert.match(screen(ui, 80, 24), /New answer/);
  assert.doesNotMatch(screen(ui, 80, 24), /Old answer/);
  assert.equal(initial.messages.length, 1);
  await submit('/not-a-command');
  assert.match(ui.state().notice, /Unknown command/);
  assert.equal(calls, 0);
});

test('/clear persists exact visible IDs and never resurrects them from an older refresh', async () => {
  const messages = [
    { id: 'already-hidden', role: 'assistant', content: 'Already hidden' },
    { id: 'visible', role: 'assistant', content: 'Visible answer' },
    { id: 'blank', role: 'assistant', content: '  ' },
  ];
  const cleared = [];
  const ui = createDashboard({ ...snapshot, messages, presentation: { hiddenMessageIds: ['already-hidden'] } }, {
    clear: ids => {
      cleared.push(ids);
      return { hiddenMessageIds: ['already-hidden', 'visible'] };
    },
  });
  ui.input('/clear');
  ui.input('\r');
  await ui.pending();
  assert.deepEqual(cleared, [['visible']]);
  assert.equal(ui.state().draft, '');
  assert.doesNotMatch(screen(ui, 80, 24), /Visible answer/);

  ui.update({ ...snapshot, messages: [...messages, { id: 'new', role: 'assistant', content: 'New answer' }], presentation: { hiddenMessageIds: ['already-hidden'] } });
  assert.doesNotMatch(screen(ui, 80, 24), /Visible answer/);
  assert.match(screen(ui, 80, 24), /New answer/);
});

test('/clear keeps the draft and visible chat when persistence fails', async () => {
  const ui = createDashboard({ ...snapshot, messages: [{ id: 'old', role: 'assistant', content: 'Old answer' }] }, {
    clear: () => { throw Error('disk full'); },
  });
  ui.input('/clear');
  ui.input('\r');
  await ui.pending();
  assert.equal(ui.state().draft, '/clear');
  assert.match(screen(ui, 80, 24), /Old answer/);
  assert.match(ui.state().notice, /Clear failed.*disk full/);
});

test('/clear confirmation disappears after 3 seconds and redraws', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let renders = 0;
  const ui = createDashboard(snapshot, {}, { onChange: () => { renders++; } });

  ui.input('/clear');
  ui.input('\r');
  await ui.pending();

  t.mock.timers.tick(2999);
  assert.match(ui.state().notice, /Visible chat cleared/);

  const rendersBeforeTimeout = renders;
  t.mock.timers.tick(1);
  assert.equal(ui.state().notice, '');
  assert.ok(renders > rendersBeforeTimeout);
});

test('a newer notice outlives the /clear confirmation timer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ui = createDashboard(snapshot);
  const submit = async text => {
    ui.input(text);
    ui.input('\r');
    await ui.pending();
  };
  await submit('/clear');
  await submit('/not-a-command');

  t.mock.timers.tick(3000);
  assert.match(ui.state().notice, /Unknown command/);
});

test('/learning turns learning on and off from the composer and never becomes a prompt', async () => {
  const answers = [{ enabled: true }, { enabled: false }];
  const sent = [];
  const ui = createDashboard({ ...snapshot, connection: 'connected' }, {
    send: text => { sent.push(text); },
    toggleLearning: async () => answers.shift(),
  });
  const submit = async () => {
    ui.input('/lea');
    ui.input('\t');
    assert.equal(ui.state().draft, '/learning');
    ui.input('\r');
    await ui.pending();
  };

  await submit();
  assert.equal(ui.state().draft, '');
  assert.match(ui.state().notice, /^Learning on\./);

  await submit();
  assert.equal(ui.state().draft, '');
  assert.match(ui.state().notice, /^Learning off\./);

  assert.deepEqual(answers, []);
  assert.deepEqual(sent, []);
  ui.stop();
});

test('a failed /learning keeps the draft and shows why', async () => {
  const ui = createDashboard({ ...snapshot, connection: 'connected' }, {
    toggleLearning: async () => { throw Error('The configuration is read-only.'); },
  });
  ui.input('/learning');
  ui.input('\r');
  await ui.pending();

  assert.equal(ui.state().draft, '/learning');
  assert.match(ui.state().notice, /Learning failed: The configuration is read-only\./);
  ui.stop();
});

test('/help says what /learning is for', () => {
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages: [] });

  ui.input('/help');
  ui.input('\r');

  assert.match(screen(ui, 120, 40), /\/learning/);
  ui.stop();
});

test('Schedules groups live background jobs, sorts active schedules first and keeps offline truth', () => {
  const now = () => Date.parse('2026-10-28T00:03:00Z');
  const schedules = [
    {
      id: 'later',
      title: 'Later check',
      cadence: 'daily',
      at: '09:00',
      enabled: true,
      nextRun: { state: 'scheduled', at: '2026-10-29T09:00:00Z' },
    },
    {
      id: 'recap',
      title: 'Morning recap',
      cadence: 'daily',
      at: '08:00',
      enabled: true,
      nextRun: { state: 'running' },
    },
  ];
  const runs = [
    {
      id: 'main',
      title: 'Main turn',
      state: 'running',
      kind: 'main',
      harness: 'pi',
      model: 'fixture/local',
      effort: 'high',
      cwd: '/tmp/main',
      startedAt: '2026-10-28T00:00:00Z',
    },
    {
      id: 'run-active',
      title: 'Morning recap',
      state: 'running',
      kind: 'background',
      scheduleId: 'recap',
      harness: 'pi',
      model: 'fixture/local',
      effort: 'high',
      cwd: '/tmp/job-1',
      startedAt: '2026-10-28T00:00:00Z',
    },
    {
      id: 'run-orphan',
      title: 'Removed check',
      state: 'running',
      kind: 'background',
      scheduleId: 'missing',
      harness: 'pi',
      model: 'fixture/local',
      effort: 'medium',
      cwd: '/tmp/job-2',
      startedAt: '2026-10-28T00:01:00Z',
    },
  ];
  const initial = {
    ...snapshot,
    counts: { daily: 2, weekly: 0, monthly: 0 },
    schedules,
    connection: 'connected',
    runs,
  };
  const ui = createDashboard(initial, {}, { now });
  ui.input('\x1b[C');
  ui.input('\x1b[C');
  let rendered = screen(ui, 120, 40);
  assert.match(rendered, /connected · 2 running/);
  assert.ok(rendered.indexOf('Morning recap') < rendered.indexOf('Later check'));
  assert.match(rendered, /pi.*fixture\/local.*high/);
  for (const [width, height] of [[120, 40], [80, 24], [60, 18]]) {
    screen(ui, width, height);
    assert.ok(ui.render(width, height).length <= height);
    assert.ok(ui.render(width, height).every(line => visibleWidth(line) <= width));
    while (ui.state().scroll > 0) ui.input('\x1b[5~');
  }
  assert.match(rendered, /Orphan scheduled job.*missing/);

  ui.update({ ...initial, runs: runs.map(run => ({ ...run, state: 'completed' })), schedules: schedules.map(schedule => ({ ...schedule, nextRun: { state: 'scheduled', at: '2026-10-29T09:00:00Z' } })) });
  rendered = screen(ui, 80, 24);
  assert.equal(ui.state().view, 'schedules');
  assert.doesNotMatch(rendered, /run-active|Orphan scheduled job/);

  ui.update({ ...initial, connection: 'offline' });
  rendered = screen(ui, 120, 40);
  assert.match(rendered, /Activity unavailable/);
  assert.doesNotMatch(rendered, /Orphan scheduled job/);
  ui.input('\x1b[C');
  assert.equal(ui.state().view, 'conversation');
});

test('the report list keeps every report a page at a time, fits each size and opens the item past a page', () => {
  let now = Date.parse('2026-10-28T00:02:00Z');
  const reports = Array.from({ length: 80 }, (_, i) => ({ id: String(i), title: `Report ${i}`, at: new Date(now - i * 60000).toISOString(), body: `Detail ${i}` }));
  const ui = createDashboard({ ...snapshot, reports }, {}, { now: () => now });
  ui.input('\x1b[C');
  for (const [width, height] of [[120, 40], [80, 24], [60, 18]]) {
    ui.input('\x1b[5~');
    for (let i = 0; i < 24; i++) ui.input('\x1b[B');
    assert.equal(ui.state().selectedId, '24');
    const rendered = ui.render(width, height).join('\n');
    assert.equal(ui.state().view, 'reports');
    assert.match(rendered, /\x1b\[38;2;255;121;198m\x1b\[1mReport 24/);
    assert.ok(rendered.split('\n').every(value => visibleWidth(value) <= width));
    ui.input('\x1b[B');
    assert.equal(ui.state().selectedId, '25');
    ui.input('\r');
    assert.match(screen(ui, width, height), /Detail 25/);
    ui.input('\x1b');
  }
  ui.input('\r');
  assert.match(screen(ui, 120, 40), /25 minutes ago/);
  now += 86400000;
  assert.match(screen(ui, 120, 40), /1 day ago/);
});

test('schedule lifecycle survives snapshot refreshes without inventing completion', () => {
  const ui = createDashboard({ ...snapshot, connection: 'connected', usage: { usd: 1.25 } });
  assert.match(screen(ui, 120, 40), /\$1\.25 est\./);
  ui.input('\x1b[D');
  for (const [state, reason, label] of [
    ['blocked', 'missing_final_receipt', 'missing final receipt'],
    ['blocked', 'interrupted_attempt', 'interrupted attempt'],
    ['pending', 'awaiting_scheduler', 'awaiting scheduler'],
    ['completed', undefined, 'Completed'],
    ['failed', undefined, 'Failed'],
    ['cancelled', undefined, 'Cancelled'],
    ['expired', undefined, 'Expired'],
  ]) {
    ui.update({ ...snapshot, connection: 'connected', schedules: [{
      ...snapshot.schedules[0], nextRun: { state, reason, at: null },
    }] });
    assert.match(screen(ui, 120, 40), new RegExp(label));
    assert.equal(ui.state().view, 'schedules');
  }
});

test('a held schedule reads as held, not as an ordinary upcoming check', () => {
  const ui = createDashboard({ ...snapshot, connection: 'connected', schedules: [{
    ...snapshot.schedules[0],
    nextRun: { state: 'held', at: new Date(Date.now() + 86400000).toISOString(), reason: 'Gmail tools are unavailable.' },
  }] });
  ui.input('\x1b[D');

  assert.match(screen(ui, 120, 40), /held, retries in/i);
});

test('Schedules shows once files with their date and count', () => {
  const once = {
    id: 'dentist', title: 'Dentist reminder', cadence: 'once', date: '2026-05-04', at: '15:00', timezone: 'UTC', enabled: true,
    nextRun: { state: 'expired', at: null },
  };
  const ui = createDashboard({ ...snapshot, connection: 'connected', counts: { ...snapshot.counts, once: 1 }, schedules: [once] });
  ui.input('\x1b[D');
  assert.equal(ui.state().view, 'schedules');
  const text = screen(ui, 120, 40);
  assert.match(text, /1 once/);
  assert.match(text, /once · 2026-05-04 · 15:00/);
});

test('Schedules labels weekday lists as a range or a list', () => {
  const weekly = (id, weekday) => ({
    id, title: id, cadence: 'weekly', weekday, at: '09:00', timezone: 'UTC', enabled: true,
    nextRun: { state: 'scheduled', at: '2026-05-04T09:00:00.000Z' },
  });
  const ui = createDashboard({ ...snapshot, connection: 'connected', schedules: [weekly('workdays', [5, 1, 2, 3, 4]), weekly('split', [1, 3])] });
  ui.input('\x1b[D');
  const text = screen(ui, 120, 40);
  assert.match(text, /weekly · Mon–Fri · 09:00/);
  assert.match(text, /weekly · Mon, Wed · 09:00/);
});

test('a running hourly check stays the next check, and Schedules still says it is running', () => {
  const inTwentyMinutes = new Date(Date.now() + 20 * 60000).toISOString();
  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  const schedules = [
    { ...snapshot.schedules[0], id: 'mail', title: 'Email follow-ups', nextRun: { state: 'running', at: inTwentyMinutes } },
    { ...snapshot.schedules[0], id: 'fincol', title: 'Morning fincol', nextRun: { state: 'scheduled', at: tomorrow } },
  ];
  const runs = [{ id: 'a', title: 'Email follow-ups', state: 'running', kind: 'background', scheduleId: 'mail' }];
  const ui = createDashboard({ ...snapshot, connection: 'connected', schedules, runs });

  assert.match(screen(ui, 120, 40), /next check\s+Email follow-ups\s+in 20m/);

  ui.input('\x1b[C');
  ui.input('\x1b[C');
  assert.equal(ui.state().view, 'schedules');
  assert.match(screen(ui, 120, 40), /Email follow-ups.*running now/);
  ui.stop();
});

const liveJob = id => ({ id, title: 'E-mail follow-ups', state: 'running', kind: 'background', scheduleId: 'mail' });
const liveSnapshot = { ...snapshot, connection: 'connected', runs: [liveJob('a'), liveJob('b')] };

test('live tabs keep run identity without stealing focus and ignore composer input', () => {
  const ui = createDashboard(liveSnapshot);
  ui.input('draft');
  ui.update({ ...liveSnapshot, runs: [liveJob('c'), ...liveSnapshot.runs] });
  assert.equal(ui.state().draft, 'draft');
  assert.equal(ui.state().view, 'conversation');
  ui.input('\x01');
  ui.input('\x0b'); // Clear the draft with native editing before view navigation.
  ui.input('\x1b[D');
  assert.equal(ui.state().view, 'job:b');
  assert.ok(!ui.render(80, 24).join('').includes(CURSOR_MARKER));
  ui.input('not a prompt');
  ui.input('\r');
  assert.equal(ui.state().draft, '');
  ui.update({ ...liveSnapshot, runs: [liveJob('b'), liveJob('a')] });
  assert.equal(ui.state().view, 'job:b');
  ui.input('\x1b[C');
  assert.equal(ui.state().view, 'job:a');
  ui.update({ ...liveSnapshot, connection: 'offline' });
  assert.equal(ui.state().view, 'conversation');
  ui.input('\x1f');
  assert.equal(ui.state().draft, 'draft');
});

test('k cancels only the selected live job, reports outcomes honestly and stays normal Chat input', async () => {
  const killed = [];
  let result = true;
  const ui = createDashboard(liveSnapshot, {
    kill: async id => {
      killed.push(id);
      if (result instanceof Error) throw result;
      return result;
    },
  });

  ui.input('k');
  assert.equal(ui.state().draft, 'k');
  assert.deepEqual(killed, []);

  ui.input('\x1b');
  ui.input('\x01');
  ui.input('\x0b');
  ui.input('\x1b[D');
  ui.input('k');
  await ui.pending();
  assert.deepEqual(killed, ['b']);
  assert.equal(ui.state().view, 'job:b');
  assert.match(ui.state().notice, /accepted/i);

  result = false;
  ui.input('\x1b[D');
  ui.input('k');
  await ui.pending();
  assert.deepEqual(killed, ['b', 'a']);
  assert.match(ui.state().notice, /no owned running job/i);

  result = Error('Cancellation refused');
  ui.input('k');
  await ui.pending();
  assert.match(ui.state().notice, /Kill failed: Cancellation refused/);
  assert.match(screen(ui, 80, 24), /Kill failed: Cancellation refused/);
  assert.equal(ui.state().view, 'job:a');

  ui.update({ ...liveSnapshot, runs: [] });
  assert.equal(ui.state().view, 'conversation');
});

test('selected live completion retains its exact filtered report across later updates and questions', async () => {
  const ui = createDashboard(liveSnapshot);
  ui.input('\x1b[D');
  const answer = ui.askQuestion({ question: 'Continue?', choices: [{ value: 'yes', label: 'Yes' }] });
  const completed = { id: 'b', title: 'Exact saved report', body: 'Authoritative no-change summary', outcome: 'no_change' };
  ui.update({ ...liveSnapshot, runs: [liveJob('a')], completedJobReports: { b: completed } });
  ui.input('\x1b');
  assert.equal(await answer, null);
  assert.equal(ui.state().view, 'reports');
  assert.equal(ui.state().focus, 'detail');
  assert.equal(ui.state().selectedId, 'b');
  ui.update({ ...liveSnapshot, runs: [], reports: [] });
  assert.match(screen(ui, 80, 24), /Authoritative no-change summary/);
  ui.input('\x1b');
  assert.equal(ui.state().focus, 'reports');
  const other = createDashboard(liveSnapshot);
  other.update({ ...liveSnapshot, runs: [], completedJobReports: { b: completed } });
  assert.equal(other.state().view, 'conversation');
  other.update(liveSnapshot);
  other.input('\x1b[D');
  const cancelled = other.askQuestion({ question: 'Stay?', choices: [{ value: 'yes', label: 'Yes' }] });
  other.update({ ...snapshot, runs: [] });
  other.input('\x1b');
  assert.equal(await cancelled, null);
  assert.equal(other.state().view, 'conversation');
});

test('live parent activity follows the bottom, pages and wheels safely at all supported sizes', () => {
  const blocks = Array.from({ length: 30 }, (_, i) => ({ id: String(i), kind: 'assistant', text: `Progress ${i}\n\nReadable paragraph` }));
  const initial = { ...liveSnapshot, jobActivity: { b: blocks } };
  const ui = createDashboard(initial);
  ui.input('\x1b[D');
  for (const [width, height] of [[120, 40], [80, 24], [60, 18]]) {
    assert.match(screen(ui, width, height), /Progress 29/);
    for (let i = 0; i < 30; i++) ui.input('\x1b[5~');
    assert.match(screen(ui, width, height), /Progress 0\b/);
    for (let i = 0; i < 30; i++) ui.input('\x1b[6~');
    screen(ui, width, height);
    ui.handleMouse({ type: 'wheel', y: 9, wheelDelta: -3 });
    assert.equal(ui.state().scroll, 3);
    ui.handleMouse({ type: 'wheel', y: 9, wheelDelta: 3 });
    assert.equal(ui.state().scroll, 0);
    const lines = ui.render(width, height);
    assert.ok(lines.length <= height);
    assert.ok(lines.every(value => visibleWidth(value) <= width));
  }
  ui.update({ ...initial, jobActivity: { b: [...blocks, { id: 'tool', kind: 'tool', name: '\x1b[2Jsearch', state: 'completed', input: '{"query":"term"}', output: 'Matched file.txt\nFinal result' }] } });
  assert.match(screen(ui, 60, 18), /search.*completed/);
  assert.match(screen(ui, 60, 18), /"query":"term"/);
  assert.match(screen(ui, 60, 18), /Matched file.txt\n\s+Final result/);
  assert.doesNotMatch(ui.render(60, 18).join(''), /\x1b\[2J/);
});

test('crowded job headers keep the selected tab visible without overflowing the viewport', () => {
  const runs = Array.from({ length: 16 }, (_, i) => ({ ...liveJob(String(i)), title: `Check ${i}` }));
  const ui = createDashboard({ ...liveSnapshot, runs });
  ui.input('\x1b[D');
  for (const [width, height] of [[120, 40], [80, 24], [60, 18]]) {
    const lines = ui.render(width, height);
    assert.ok(lines.some(value => value.includes('\x1b[38;2;255;121;198m\x1b[1mCheck 15')));
    assert.ok(lines.length <= height);
    assert.ok(lines.every(value => visibleWidth(value) <= width));
  }
});

test('reading a report is timed from open to close, however it ends', () => {
  let clock = 1000;
  const reads = [];
  const ui = createDashboard(snapshot, { reportRead: event => reads.push(event) }, { now: () => clock });

  ui.input('\x1b[C');
  clock += 60000;
  assert.deepEqual(reads, [], 'selecting a row is not reading it');

  ui.input('\r');
  clock += 12000;
  ui.input('\x1b');
  assert.deepEqual(reads, [{ id: 'one', dwellMs: 12000 }]);

  ui.input('\r');
  clock += 4000;
  ui.update({ ...snapshot });
  assert.equal(reads.length, 1, 'a refresh keeps the same read open');
  clock += 1000;
  ui.input('\x1b[D');
  assert.deepEqual(reads[1], { id: 'one', dwellMs: 5000 });

  ui.input('\x1b[C');
  ui.input('\r');
  clock += 7000;
  ui.stop();
  assert.deepEqual(reads[2], { id: 'one', dwellMs: 7000 });
});

test('m in a report moves to the composer with that report attached, and sending carries it once', async () => {
  const sent = [];
  const ui = createDashboard({ ...snapshot, connection: 'connected' }, {
    send: async (text, report) => { sent.push([text, report?.id]); },
  });
  ui.input('\x1b[C');
  ui.input('\r');

  ui.input('m');

  assert.deepEqual([ui.state().view, ui.state().focus, ui.state().draft], ['conversation', 'composer', '']);
  assert.match(screen(ui, 120, 40), /↳ First report/);
  assert.match(screen(ui, 120, 40), /Ask about this report/);

  ui.input('why');
  ui.input('\r');
  await ui.pending();
  assert.deepEqual(sent, [['why', 'one']]);
  assert.match(screen(ui, 120, 40), /Message hobkin/);

  ui.input('next');
  ui.input('\r');
  await ui.pending();
  assert.deepEqual(sent[1], ['next', undefined]);
  ui.stop();
});

test('a report reference survives a failed send and Escape drops it, keeping the draft', async () => {
  const ui = createDashboard({ ...snapshot, connection: 'connected' }, {
    send: async () => { throw Error('failed'); },
  });
  ui.input('\x1b[C');
  ui.input('\r');
  ui.input('m');
  ui.input('why');

  ui.input('\r');
  await ui.pending();
  assert.match(screen(ui, 120, 40), /↳ First report/);
  assert.equal(ui.state().draft, 'why');

  ui.input('\x1b');
  assert.doesNotMatch(screen(ui, 120, 40), /↳ First report/);
  assert.equal(ui.state().draft, 'why');
  ui.stop();
});

test('r in a report replies the way m does, and the footer says so', async () => {
  const sent = [];
  const ui = createDashboard({ ...snapshot, connection: 'connected' }, {
    send: async (text, report) => { sent.push([text, report?.id]); },
  });
  ui.input('\x1b[C');
  ui.input('\r');
  assert.match(screen(ui, 120, 40), /r m\s+reply/);

  ui.input('r');

  assert.equal(ui.state().view, 'conversation');
  assert.equal(ui.state().focus, 'composer');
  assert.equal(ui.state().draft, '', 'the key opens the reply, it is not part of it');
  ui.stop();
});

test('the main agent\'s question opens in Chat under the message it is about, and the answer goes back to where the user was', async () => {
  const messages = [{ id: 'plan', role: 'assistant', content: 'Proposed refactor: stop saving empty reports.', at: '2026-11-03T22:20:32Z' }];
  const ui = createDashboard({ ...snapshot, connection: 'connected', messages });
  ui.input('\x1b[C');
  assert.equal(ui.state().view, 'reports');
  const choices = [{ value: 'hold', label: 'Keep the plan only' }, { value: 'apply', label: 'Apply it' }];

  const answer = ui.askQuestion({ question: 'Apply this refactor?', choices, inChat: true });

  assert.equal(ui.state().view, 'conversation');
  assert.match(screen(ui, 120, 40), /Proposed refactor: stop saving empty reports\.[\s\S]*Apply this refactor\?/);
  ui.input('\r');
  assert.equal(await answer, 'hold');
  assert.equal(ui.state().view, 'reports');

  const elsewhere = ui.askQuestion({ question: 'Stay here?', choices });
  assert.equal(ui.state().view, 'reports', 'a question from anywhere else opens where the user is');
  ui.input('\r');
  assert.equal(await elsewhere, 'hold');
  ui.stop();
});

test('r is an ordinary letter outside a report', () => {
  const ui = createDashboard({ ...snapshot, connection: 'connected' });

  ui.input('r');

  assert.equal(ui.state().draft, 'r');
  ui.stop();
});

test('m means message only inside a report', () => {
  const ui = createDashboard({ ...snapshot, connection: 'connected' });

  ui.input('m');
  assert.equal(ui.state().draft, 'm');
  ui.input('\x7f');

  ui.input('\x1b[C');
  ui.input('m');
  assert.equal(ui.state().view, 'reports');
  assert.equal(ui.state().focus, 'reports');
  ui.stop();
});

test('chat shows which report a message was about', () => {
  const messages = [{ id: 'a', role: 'user', content: 'why did this fail?', about: 'Email follow-ups', at: '2026-10-30T12:26:00' }];
  const ui = createDashboard({ ...snapshot, messages });

  assert.match(screen(ui, 120, 40), /↳ Email follow-ups[\s\S]*why did this fail\?/);
  ui.stop();
});

test('a report opened for the user by a finishing job is timed too', () => {
  let clock = 1000;
  const reads = [];
  const running = {
    ...snapshot,
    connection: 'connected',
    runs: [{ id: 'job', title: 'Check', state: 'running', kind: 'background', scheduleId: 'recap' }],
  };
  const ui = createDashboard(running, { reportRead: event => reads.push(event) }, { now: () => clock });
  ui.input('\x1b[D');
  assert.equal(ui.state().view, 'job:job');

  ui.update({ ...running, runs: [], completedJobReports: { job: { id: 'job', title: 'Check', at: '', body: 'Done', outcome: 'completed' } } });
  assert.equal(ui.state().focus, 'detail');
  clock += 9000;
  ui.input('\x1b');
  assert.deepEqual(reads, [{ id: 'job', dwellMs: 9000 }]);
});

test('the day stays pinned above a chat that overflows, and follows scrolling', () => {
  const day = date => Array.from({ length: 30 }, (_, index) => ({
    id: `${date}-${index}`, role: 'assistant', content: `Note ${date} ${index}`, at: `${date}T12:00:00`,
  }));
  const clock = Date.parse('2026-10-30T18:00:00');
  const ui = createDashboard({ ...snapshot, messages: [...day('2026-10-29'), ...day('2026-10-30')] }, {}, { now: () => clock });
  const headingRow = () => screen(ui, 80, 30).split('\n')[3];

  assert.match(headingRow(), /TODAY\s+60 messages/);
  for (let page = 0; page < 4; page++) ui.input('\x1b[5~');
  assert.match(headingRow(), /TODAY/);
  for (let page = 0; page < 20; page++) ui.input('\x1b[5~');
  assert.match(headingRow(), /YESTERDAY\s+60 messages/);
  ui.stop();
});

test('tips come and go on the clock, and mention checks that go unread', () => {
  const attention = [{ scheduleId: 'recap', title: 'Morning recap', reports: 7, read: 0, ignored: true }];
  const period = 180000;
  const rowAboveShortcuts = ui => [...screen(ui, 120, 40).split('\n').at(-5)].slice(14).join('');
  let clock = period * 5;
  const ui = createDashboard({ ...snapshot, reportAttention: attention, memoryBytes: 2436 }, {}, { now: () => clock });
  const seen = new Set();

  for (let turn = 0; turn < 60; turn++) {
    clock = period * (turn + 5);
    seen.add(rowAboveShortcuts(ui).match(/tip\s+(.*?)\s*$/)?.[1]);
    clock += 60000;
    assert.equal(rowAboveShortcuts(ui).trim(), '', 'most of the time the row stays blank');
  }

  assert.match(screen(ui, 120, 40), /next check.*memory 2\.4kb/);

  assert.ok(seen.size >= 4, `expected variety, saw ${seen.size}`);
  assert.ok([...seen].some(tip => /Morning recap: 0 of 7 reports opened/.test(tip)));
  assert.ok([...seen].some(tip => /model or thinking effort/.test(tip)));
  ui.stop();
});

test('the tip that suggests Hex shows only to someone who does not have it', () => {
  const period = 180000;
  const tipsSeen = hexInstalled => {
    let clock = period * 5;
    const ui = createDashboard({ ...snapshot }, {}, { now: () => clock, hexInstalled });
    const seen = new Set();
    for (let turn = 0; turn < 80; turn++) {
      clock = period * (turn + 5);
      seen.add(screen(ui, 120, 40).match(/tip\s+(.*?)\s*$/m)?.[1]);
    }
    ui.stop();
    return [...seen].filter(Boolean);
  };

  assert.ok(tipsSeen(false).some(tip => /Install Hex/.test(tip)));
  assert.ok(!tipsSeen(true).some(tip => /Install Hex/.test(tip)));
});

test('/setup asks the agent to walk through setting up, the same way a typed message would', async () => {
  const sent = [];
  const ui = createDashboard({ ...snapshot, connection: 'connected' }, { send: async text => { sent.push(text); } });

  ui.input('/setup');
  ui.input('\r');
  await ui.pending();

  assert.deepEqual(sent, ['Help me set up hobkin.']);
  assert.equal(ui.state().draft, '');
  ui.stop();
});

test('a new person is pointed at /setup until they have a schedule', () => {
  const ui = createDashboard({ ...snapshot, reports: [], schedules: [] });
  assert.match(stripTerminalSequences(ui.render(120, 40).join('\n')), /New here\? Type \/setup/);

  ui.update({ ...snapshot, reports: [] });
  assert.doesNotMatch(stripTerminalSequences(ui.render(120, 40).join('\n')), /New here/);
  ui.stop();
});

test('a schedule\'s report wears the blue dot of the Schedules tab, and work mode\'s stays green', () => {
  const at = new Date().toISOString();
  const report = (id, title, scheduleId, outcome = 'completed') => ({ id, title, scheduleId, at, body: 'Useful: Done.', outcome });
  const reports = [
    report('top', 'Selected row', 'recap'),
    report('mail', 'Email follow-ups', 'recap'),
    report('work', 'pi-intro: Fix it', 'work.pi-intro.do'),
    report('bad', 'Calendar deadlines', 'recap', 'failed'),
  ];
  const schedules = [{ ...snapshot.schedules[0], nextRun: { at: new Date(Date.now() + 3600000).toISOString() } }];
  const ui = createDashboard({ ...snapshot, reports, schedules });
  const mark = title => /\x1b\[[0-9;]*m[●✕]/.exec(ui.render(120, 40).find(value => value.includes(title)))[0];

  ui.input('\x1b[C');
  const [mail, work, failed] = ['Email follow-ups', 'pi-intro: Fix it', 'Calendar deadlines'].map(mark);
  ui.input('\x1b[C');

  assert.equal(mail, mark('Morning recap'));
  assert.notEqual(mail, work);
  assert.match(failed, /✕/);
  ui.stop();
});

test('the /learning tip comes up only while learning is off', () => {
  const tipShows = view => {
    const period = 180000;
    let clock = 0;
    const ui = createDashboard(view, {}, { now: () => clock });
    const shown = Array.from({ length: 60 }, (_, turn) => {
      clock = period * turn;
      return screen(ui, 120, 40).includes('Type /learning');
    });
    ui.stop();
    return shown.some(Boolean);
  };

  assert.equal(tipShows({ ...snapshot, learning: false }), true);
  assert.equal(tipShows({ ...snapshot, learning: true }), false);
});

test('an idle dashboard redraws often enough for tips and countdowns, then stops with it', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let frames = 0;
  const ui = createDashboard({ ...snapshot, connection: 'connected' }, {}, { onChange: () => { frames++; } });

  t.mock.timers.tick(60000);
  assert.ok(frames >= 6, `expected idle redraws, got ${frames}`);

  ui.stop();
  const stopped = frames;
  t.mock.timers.tick(60000);
  assert.equal(frames, stopped);
});

test('non-TTY status stays finite, local and ANSI-free', t => {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-ui-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = (...args) => spawnSync(process.execPath, ['src/cli/main.mjs', ...args, '--home', root], { encoding: 'utf8', timeout: 5000 });
  assert.equal(run('init').status, 0);
  const status = run('status');
  assert.equal(status.status, 0);
  assert.match(status.stdout, /Main not connected/);
  assert.doesNotMatch(status.stdout, /\x1b/);
});

test('a slide rewrites the rows that moved and never the whole screen', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const terminal = new FakeTerminal();
  let clock = Date.parse('2026-10-28T12:00:00.000Z');
  const message = index => ({ id: `m${index}`, role: index % 2 ? 'assistant' : 'user', content: `Message ${index}\n\n- one\n- two`, at: '2026-10-28T10:00:00.000Z' });
  const messages = Array.from({ length: 200 }, (_, index) => message(index));
  const ui = startDashboard({ ...snapshot, connection: 'connected', messages }, {}, { terminal, now: () => clock });
  t.after(() => ui.stop());
  const wait = async ms => {
    for (let elapsed = 0; elapsed < ms; elapsed += 16) {
      clock += 16;
      t.mock.timers.tick(16);
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));
    }
  };
  await wait(160);
  terminal.writes.length = 0;
  ui.update({ ...snapshot, connection: 'connected', messages: [...messages, message(200)] });
  await wait(480);
  const sizes = terminal.writes.map(frame => Buffer.byteLength(frame));
  t.diagnostic(`${sizes.length} frames, ${sizes.toSorted((a, b) => a - b)[sizes.length >> 1]} bytes in the median frame, ${Math.max(...sizes)} at most`);
  assert.ok(sizes.length >= 4, `${sizes.length} frames`);
  assert.ok(Math.max(...sizes) < 8192, `${Math.max(...sizes)} bytes`);
  assert.ok(!terminal.writes.some(frame => frame.includes('\x1b[2J')));
});

const mixedReports = {
  ...snapshot,
  reports: [
    { id: 'routine-a', title: 'Morning Recap', scheduleId: 'recap', at: '2026-10-27T09:00:00.000Z', body: 'Deploys look fine', outcome: 'completed' },
    { id: 'routine-b', title: 'Inbox sweep', scheduleId: 'inbox', at: '2026-10-27T08:00:00.000Z', body: 'Nothing urgent', outcome: 'completed' },
    { id: 'work-a', title: 'Fix the login flow', scheduleId: 'work.demo.do', at: '2026-10-27T07:00:00.000Z', body: 'Merged', outcome: 'completed' },
  ],
};
const openReports = ui => ui.input('\x1b[C');
const ENTER = '\r';
const ESC = '\x1b';
const LEFT = '\x1b[D';
const RIGHT = '\x1b[C';
const BACKSPACE = '\x7f';

test('Reports opens on the first report of All, and the subtab row sits above the list', () => {
  const ui = createDashboard(mixedReports);

  openReports(ui);

  const all = screen(ui, 120, 40);
  assert.match(all, /All 3\s+Scheduled 2\s+Work Done 1/);
  assert.match(all, /Reports 3/);
  assert.match(all, /Morning Recap/);
  assert.match(all, /Fix the login flow/);
  assert.equal(ui.state().focus, 'reports');
  assert.equal(ui.state().selectedId, 'routine-a');
});

test('a report reads from its point, and only a word that warns stays in front of it', () => {
  const critical = {
    id: 'down', title: 'Site check', at: '2026-10-27T09:00:00.000Z', outcome: 'completed',
    body: 'Critical: The site has been down since 07:40.',
  };
  const useful = {
    id: 'fix', title: 'Payment fix', at: '2026-10-27T08:00:00.000Z', outcome: 'completed',
    body: 'Useful: One transaction can no longer be matched to two payments.\n\nThe fix is on the local branch `hobkin/7298ae`.',
  };
  const startsWithThePoint = /^ +One transaction can no longer be matched to two payments\./m;
  const ui = createDashboard({ ...snapshot, reports: [critical, useful] });

  openReports(ui);
  const list = screen(ui, 100, 26);

  assert.match(list, startsWithThePoint);
  assert.match(list, /Critical: The site has been down since 07:40\./);

  ui.showRow({ tab: 'reports', report: useful.id });
  const opened = screen(ui, 100, 26);

  assert.match(opened, startsWithThePoint);
  ui.stop();
});

test('up from the first report reaches the subtab row, and down comes back to where it was', () => {
  const ui = createDashboard(mixedReports);
  openReports(ui);

  ui.input(UP);
  assert.equal(ui.state().focus, 'reportTabs');
  ui.input(UP);
  assert.equal(ui.state().focus, 'reportTabs');

  ui.input(DOWN);
  assert.equal(ui.state().focus, 'reports');
  assert.equal(ui.state().selectedId, 'routine-a');
  ui.input(DOWN);
  assert.equal(ui.state().selectedId, 'routine-b');
  ui.input(UP);
  assert.equal(ui.state().focus, 'reports');
  assert.equal(ui.state().selectedId, 'routine-a');
});

test('left and right change the subtab on its row, and main tabs everywhere else', () => {
  const ui = createDashboard(mixedReports);
  openReports(ui);
  ui.input(UP);

  ui.input(RIGHT);
  const scheduled = screen(ui, 120, 40);
  assert.equal(ui.state().view, 'reports');
  assert.match(scheduled, /Morning Recap/);
  assert.doesNotMatch(scheduled, /Fix the login flow/);

  ui.input(RIGHT);
  const work = screen(ui, 120, 40);
  assert.match(work, /Fix the login flow/);
  assert.doesNotMatch(work, /Morning Recap/);

  ui.input(DOWN);
  assert.equal(ui.state().selectedId, 'work-a');
  ui.input(ENTER);
  assert.equal(ui.state().focus, 'detail');
  assert.match(screen(ui, 120, 40), /Merged/);
  assert.doesNotMatch(screen(ui, 120, 40), /Work Done/);

  ui.input(ESC);
  ui.input(RIGHT);
  assert.equal(ui.state().view, 'schedules');
});

test('subtabs wrap at both ends of the row', () => {
  const ui = createDashboard(mixedReports);
  openReports(ui);
  ui.input(UP);

  ui.input(LEFT);
  assert.doesNotMatch(screen(ui, 120, 40), /Morning Recap/);

  ui.input(RIGHT);
  assert.match(screen(ui, 120, 40), /Morning Recap/);
  assert.match(screen(ui, 120, 40), /Fix the login flow/);
});

test('Enter on the subtab row goes into the list instead of opening a report', () => {
  const ui = createDashboard(mixedReports);
  openReports(ui);
  ui.input(UP);

  ui.input(ENTER);

  assert.equal(ui.state().focus, 'reports');
  assert.equal(ui.state().selectedId, 'routine-a');
});

test('the subtab row leaves the same way the list does', () => {
  const ui = createDashboard(mixedReports);
  openReports(ui);
  ui.input(UP);

  ui.input(ESC);

  assert.equal(ui.state().view, 'conversation');
  assert.equal(ui.state().focus, 'composer');
  ui.input('hello');
  assert.equal(ui.state().draft, 'hello');
});

test('an empty subtab still has a way back up', () => {
  const ui = createDashboard({ ...mixedReports, reports: mixedReports.reports.slice(0, 2) });
  openReports(ui);
  ui.input(UP);
  ui.input(LEFT);
  ui.input(DOWN);
  assert.match(screen(ui, 120, 40), /No reports yet/);

  ui.input(UP);

  assert.equal(ui.state().focus, 'reportTabs');
});

test('/ on the subtab row starts the filter there', () => {
  const ui = createDashboard(mixedReports);
  openReports(ui);
  ui.input(UP);

  ui.input('/');
  typing(ui, 'inbox');

  assert.equal(ui.state().focus, 'reports');
  assert.match(screen(ui, 120, 40), /\/ inbox/);
  assert.equal(ui.state().selectedId, 'routine-b');
});

test('typing after / filters report titles, ignoring case and bodies', () => {
  const ui = createDashboard(mixedReports);
  openReports(ui);
  ui.input('/');
  typing(ui, 'RECAP');
  const matched = screen(ui, 120, 40);
  assert.match(matched, /\/ RECAP/);
  assert.match(matched, /Morning Recap/);
  assert.doesNotMatch(matched, /Inbox sweep/);
  assert.match(matched, /Scheduled 1\s+Work Done 0/);

  for (let left = 5; left; left--) ui.input(BACKSPACE);
  typing(ui, 'deploys');
  const body = screen(ui, 120, 40);
  assert.doesNotMatch(body, /Morning Recap/);
  assert.match(body, /No report titles match/);
});

test('keys that mean something else on the list are plain letters in the filter', () => {
  const ui = createDashboard(mixedReports);
  openReports(ui);
  ui.input('/');
  typing(ui, 'kmr/');
  assert.equal(ui.state().view, 'reports');
  assert.equal(ui.state().focus, 'reports');
  assert.match(screen(ui, 120, 40), /\/ kmr\//);
});

test('reports come 25 to a page, the arrows and the page keys turn pages, and the heading says which page', () => {
  const reports = Array.from({ length: 40 }, (_, index) => ({
    id: `r${index}`, title: `Report number ${index}`, at: new Date(Date.parse('2026-10-27T09:00:00.000Z') - index * 60000).toISOString(), body: 'Body', outcome: 'completed',
  }));
  const ui = createDashboard({ ...snapshot, reports });
  openReports(ui);
  assert.match(screen(ui, 120, 40), /page 1 of 2 · 40 reports/);
  assert.match(screen(ui, 120, 40), /pgup\/pgdn\s+pages/);
  assert.doesNotMatch(screen(ui, 120, 40), /Report number 25\b/);

  ui.input('\x1b[6~');
  assert.match(screen(ui, 120, 40), /page 2 of 2 · 40 reports/);
  assert.equal(ui.state().selectedId, 'r25');
  ui.input('\x1b[5~');
  assert.equal(ui.state().selectedId, 'r0');

  for (let row = 0; row < 25; row++) ui.input('\x1b[B');
  assert.equal(ui.state().selectedId, 'r25', 'down past the last row turns the page');
  ui.input('\x1b[A');
  assert.equal(ui.state().selectedId, 'r24', 'and up past the first row turns it back');
});

test('the filter finds reports past the 25 the list shows', () => {
  const reports = Array.from({ length: 40 }, (_, index) => ({
    id: `r${index}`, title: `Report number ${index}`, at: '2026-10-27T09:00:00.000Z', body: 'Body', outcome: 'completed',
  }));
  const ui = createDashboard({ ...snapshot, reports });
  openReports(ui);
  assert.match(screen(ui, 120, 40), /page 1 of 2 · 40 reports/);
  assert.doesNotMatch(screen(ui, 120, 40), /Report number 39/);
  ui.input('/');
  typing(ui, 'number 39');
  assert.match(screen(ui, 120, 40), /Report number 39/);
  assert.equal(ui.state().selectedId, 'r39');
});

test('the filter keeps a selection it can show, and arrows move through the matches while typing', () => {
  const ui = createDashboard(mixedReports);
  openReports(ui);
  ui.input('\x1b[B');
  assert.equal(ui.state().selectedId, 'routine-b');
  ui.input('/');
  typing(ui, 'o');
  assert.equal(ui.state().selectedId, 'routine-b');
  ui.input('\x1b[A');
  assert.equal(ui.state().selectedId, 'routine-a');
  ui.input('z');
  assert.equal(ui.state().selectedId, null);
});

test('Enter opens the match and Esc works back out one step at a time', () => {
  const ui = createDashboard(mixedReports);
  openReports(ui);
  ui.input('/');
  typing(ui, 'inbox');
  ui.input(ENTER);
  assert.equal(ui.state().focus, 'detail');
  assert.match(screen(ui, 120, 40), /Nothing urgent/);

  ui.input(ESC);
  assert.equal(ui.state().focus, 'reports');
  assert.match(screen(ui, 120, 40), /\/ inbox/);
  assert.doesNotMatch(screen(ui, 120, 40), /Morning Recap/);

  ui.input(ESC);
  assert.equal(ui.state().view, 'reports');
  assert.match(screen(ui, 120, 40), /Morning Recap/);
  assert.doesNotMatch(screen(ui, 120, 40), /\/ inbox/);

  ui.input(ESC);
  assert.equal(ui.state().view, 'conversation');
});

test('Esc while typing clears the filter and stays on the list; Enter with no match stays too', () => {
  const ui = createDashboard(mixedReports);
  openReports(ui);
  ui.input('/');
  ui.input('z');
  ui.input(ENTER);
  assert.equal(ui.state().focus, 'reports');
  assert.match(screen(ui, 120, 40), /\/ z/);
  ui.input('/');
  ui.input(ESC);
  assert.equal(ui.state().view, 'reports');
  assert.match(screen(ui, 120, 40), /Morning Recap/);
  assert.equal(ui.state().selectedId, 'routine-a');
});

test('Backspace on an empty filter stops typing, and arrows change views when the filter is empty', () => {
  const ui = createDashboard(mixedReports);
  openReports(ui);
  ui.input('/');
  ui.input(BACKSPACE);
  ui.input('k');
  assert.doesNotMatch(screen(ui, 120, 40), /\/ k/);

  ui.input('/');
  ui.input('\x1b[C');
  assert.equal(ui.state().view, 'schedules');
  ui.input('\x1b[D');
  ui.input('m');
  assert.doesNotMatch(screen(ui, 120, 40), /\/ m/);
});

test('arrows move the caret while the filter holds text', () => {
  const ui = createDashboard(mixedReports);
  openReports(ui);
  ui.input('/');
  typing(ui, 'fx');
  ui.input('\x1b[D');
  ui.input('i');
  assert.equal(ui.state().view, 'reports');
  assert.match(screen(ui, 120, 40), /\/ fix/);
});

test('the filter carries across subtabs', () => {
  const ui = createDashboard(mixedReports);
  openReports(ui);
  ui.input('/');
  typing(ui, 'fix');
  ui.input(ENTER);
  ui.input(ESC);
  ui.input(UP);

  ui.input(RIGHT);
  assert.match(screen(ui, 120, 40), /No report titles match/);
  assert.match(screen(ui, 120, 40), /\/ fix/);

  ui.input(RIGHT);
  assert.match(screen(ui, 120, 40), /Fix the login flow/);
  assert.match(screen(ui, 120, 40), /\/ fix/);
});

test('Ctrl+C clears the filter before it arms quit', () => {
  let quits = 0;
  const ui = createDashboard(mixedReports, { onQuit: () => { quits++; } });
  openReports(ui);
  ui.input('/');
  ui.input('z');
  ui.input('\x03');
  ui.input('\x03');
  assert.equal(quits, 0);
  assert.match(screen(ui, 120, 40), /Morning Recap/);
  assert.match(ui.state().notice, /Ctrl\+C again/);
});

test('a work report that opens by itself comes back to a list that shows it, with nothing hiding it', () => {
  const running = { id: 'job', state: 'running', kind: 'background', scheduleId: 'work.demo.do', title: 'Fix the login flow' };
  const live = { ...mixedReports, connection: 'connected', runs: [running] };
  const ui = createDashboard(live, { send() {} });
  openReports(ui);
  ui.input(UP);
  ui.input(RIGHT);
  ui.input(DOWN);
  ui.input('/');
  ui.input('z');
  ui.input(ENTER);
  ui.input('\x1b[C');
  ui.input('\x1b[C');
  assert.equal(ui.state().view, 'job:job');

  const finished = { id: 'job', title: 'Fix the login flow', scheduleId: 'work.demo.do', at: '2026-10-27T10:00:00.000Z', body: 'Done', outcome: 'completed' };
  ui.update({ ...live, runs: [], reports: [finished, ...mixedReports.reports], completedJobReports: { job: finished } });
  assert.equal(ui.state().focus, 'detail');
  ui.input(ESC);
  assert.equal(ui.state().selectedId, 'job');
  const list = screen(ui, 120, 40);
  assert.match(list, /All 4\s+Scheduled 2\s+Work Done 2/);
  assert.doesNotMatch(list, /\/ z/);
  assert.doesNotMatch(list, /Morning Recap/);
});

test('a report that opens by itself leaves All where it is', () => {
  const running = { id: 'job', state: 'running', kind: 'background', scheduleId: 'work.demo.do', title: 'Fix the login flow' };
  const live = { ...mixedReports, connection: 'connected', runs: [running] };
  const ui = createDashboard(live, { send() {} });
  ui.input('\x1b[D');
  assert.equal(ui.state().view, 'job:job');

  const finished = { id: 'job', title: 'Fix the login flow', scheduleId: 'work.demo.do', at: '2026-10-27T10:00:00.000Z', body: 'Done', outcome: 'completed' };
  ui.update({ ...live, runs: [], reports: [finished, ...mixedReports.reports], completedJobReports: { job: finished } });
  ui.input(ESC);

  assert.equal(ui.state().selectedId, 'job');
  assert.match(screen(ui, 120, 40), /Morning Recap/);
});

const cellOf = (ui, text, width, height) => {
  const rows = stripTerminalSequences(ui.render(width, height).join('\n')).split('\n');
  const y = rows.findIndex(value => value.includes(text));
  assert.notEqual(y, -1, `${text} is on screen`);
  return { x: visibleWidth(rows[y].slice(0, rows[y].indexOf(text))), y };
};
const click = (terminal, { x, y }, button = 0) => {
  terminal.input(`\x1b[<${button};${x + 1};${y + 1}M`);
  terminal.input(`\x1b[<${button};${x + 1};${y + 1}m`);
};

const clickableDashboard = async t => {
  const terminal = new FakeTerminal();
  const ui = startDashboard(mixedReports, {}, { terminal });
  t.after(() => ui.stop());
  // A click lands on what the screen last drew, so it needs a first frame.
  while (!terminal.writes.some(frame => frame.includes('Chat'))) await new Promise(resolve => setImmediate(resolve));
  return { terminal, ui };
};

test('clicking the Done subtab opens it', async t => {
  const terminal = new FakeTerminal();
  const ready = [{ slug: 'site', project: 'website', item: 'one', title: 'Land me', gap: 'land' }];
  const ui = startDashboard({ ...mixedReports, work: { enabled: true, projects: [], ready } }, {}, { terminal });
  t.after(() => ui.stop());
  ui.input('\x1b[D');
  while (!terminal.writes.some(frame => frame.includes('Done'))) await new Promise(resolve => setImmediate(resolve));

  click(terminal, cellOf(ui, 'Done 1', terminal.columns, terminal.rows));

  assert.match(stripTerminalSequences(ui.render(terminal.columns, terminal.rows).join('\n')), /NEEDS YOU/);
});

test('clicking a main tab opens it, wherever the header put the tabs', async t => {
  const { terminal, ui } = await clickableDashboard(t);
  terminal.input('draft');
  for (const [columns, rows] of [[120, 40], [60, 18], [35, 14]]) {
    terminal.columns = columns;
    terminal.rows = rows;
    terminal.resize();
    click(terminal, cellOf(ui, 'Reports', columns, rows));
    assert.equal(ui.state().view, 'reports');
    assert.equal(ui.state().focus, 'reports');
    click(terminal, cellOf(ui, 'Chat', columns, rows));
    assert.equal(ui.state().view, 'conversation');
    assert.equal(ui.state().focus, 'composer');
    assert.equal(ui.state().draft, 'draft');
  }
});

test('a click on the last column of a tab counts, and one in the gap after it does not', async t => {
  const { terminal, ui } = await clickableDashboard(t);
  const { x, y } = cellOf(ui, 'Chat', 120, 40);
  const end = cellOf(ui, 'Routines', 120, 40).x - 3;
  click(terminal, { x: end, y });
  assert.equal(ui.state().view, 'conversation');
  click(terminal, { x: end - 1, y });
  assert.equal(ui.state().view, 'reports');
  click(terminal, { x, y });
  assert.equal(ui.state().view, 'conversation');
});

test('clicking a tab from a report goes back to its list, and clicking a subtab switches it', async t => {
  const { terminal, ui } = await clickableDashboard(t);
  terminal.input('\x1b[C');
  click(terminal, cellOf(ui, 'Work Done', 120, 40));
  assert.match(screen(ui, 120, 40), /Fix the login flow/);
  assert.doesNotMatch(screen(ui, 120, 40), /Morning Recap/);
  click(terminal, cellOf(ui, 'Scheduled', 120, 40));
  assert.match(screen(ui, 120, 40), /Morning Recap/);
  assert.doesNotMatch(screen(ui, 120, 40), /Fix the login flow/);
  click(terminal, cellOf(ui, 'All 3', 120, 40));
  assert.match(screen(ui, 120, 40), /Fix the login flow/);

  terminal.input('\r');
  assert.equal(ui.state().focus, 'detail');
  click(terminal, cellOf(ui, 'Reports', 120, 40));
  assert.equal(ui.state().focus, 'reports');
});

test('only a left click on a tab acts, and never over an open question', async t => {
  const { terminal, ui } = await clickableDashboard(t);
  const tab = cellOf(ui, 'Reports', 120, 40);
  click(terminal, tab, 2);
  assert.equal(ui.state().view, 'conversation');
  terminal.input(`\x1b[<0;${tab.x + 1};${tab.y + 1}M`);
  terminal.input(`\x1b[<32;${tab.x + 3};${tab.y + 1}M`);
  terminal.input(`\x1b[<0;${tab.x + 3};${tab.y + 1}m`);
  assert.equal(ui.state().view, 'conversation');

  const answer = ui.askQuestion({ question: 'Keep it?', choices: [{ label: 'Yes', value: 'yes' }] });
  click(terminal, tab);
  assert.equal(ui.state().view, 'conversation');
  assert.equal(ui.state().focus, 'question');
  terminal.input(ESC);
  assert.equal(await answer, null);
  click(terminal, tab);
  assert.equal(ui.state().view, 'reports');
});

const tipRow = ui => screen(ui, 120, 40).split('\n').at(-5);

test('opening hobkin greets the user by name, then the row goes back to tips', () => {
  let clock = Date.parse('2026-11-02T12:00:05.000Z');
  const ui = createDashboard({ ...snapshot, userName: 'Ada' }, {}, { now: () => clock });

  assert.match(tipRow(ui), /Ada/);
  assert.doesNotMatch(tipRow(ui), /\btip\b/);

  clock += 29000;
  assert.match(tipRow(ui), /Ada/);

  clock += 2000;
  assert.doesNotMatch(tipRow(ui), /Ada/);
});

test('the greeting changes from one start to the next', () => {
  const greetings = new Set();

  for (let start = 0; start < 60; start++) {
    const clock = Date.parse('2026-11-02T12:00:05.000Z') + start * 1000;
    const ui = createDashboard({ ...snapshot, userName: 'Ada' }, {}, { now: () => clock });
    greetings.add(tipRow(ui).trim());
  }

  assert.ok(greetings.size >= 5, `${greetings.size} greetings`);
  for (const greeting of greetings) assert.match(greeting, /Ada/);
  assert.ok([...greetings].some(greeting => greeting.includes('Welcome Ada! Nice to see you again')));
});

test('with no name saved there is no greeting', () => {
  const clock = Date.parse('2026-11-02T12:00:05.000Z');
  const ui = createDashboard(snapshot, {}, { now: () => clock });

  assert.doesNotMatch(tipRow(ui), /Welcome|Nice to see you|Good to see you/);
});

test('a name arriving after the start window is not greeted late', () => {
  let clock = Date.parse('2026-11-02T12:00:05.000Z');
  const ui = createDashboard(snapshot, {}, { now: () => clock });

  clock += 60000;
  ui.update({ ...snapshot, userName: 'Ada' });

  assert.doesNotMatch(tipRow(ui), /Ada/);
});

test('a first run asks for setup by itself once the main chat is connected', async () => {
  const sent = [];
  const live = { ...snapshot, connection: 'connected' };
  const ui = createDashboard({ ...snapshot, connection: 'connecting' }, { send: text => { sent.push(text); } });

  ui.startSetup();
  assert.deepEqual(sent, []);

  ui.update(live);
  await ui.pending();
  ui.update(live);
  await ui.pending();

  assert.deepEqual(sent, ['Help me set up hobkin.']);
});

test('a chat that is already connected starts setup straight away', async () => {
  const sent = [];
  const ui = createDashboard({ ...snapshot, connection: 'connected' }, { send: text => { sent.push(text); } });

  ui.startSetup();
  await ui.pending();

  assert.deepEqual(sent, ['Help me set up hobkin.']);
});

const CTRL_V = '\x16';
const CTRL_C = '\x03';
const picture = name => ({ file: `/runtime/pasted/${name}.png`, mimeType: 'image/png', columns: 3, preview: ['▀▀▀', '▀▀▀'] });
const liveChat = { ...snapshot, connection: 'connected', messages: [] };
const composerWith = (handlers = {}, view = liveChat) => {
  const images = [picture('first'), picture('second'), picture('third'), picture('fourth'), picture('fifth')];
  const calls = { pasted: 0, dropped: [], sent: [] };
  const ui = createDashboard(view, {
    send: (...message) => { calls.sent.push(message); },
    pasteImage: async () => ({ image: images[calls.pasted++] }),
    dropImages: dropped => calls.dropped.push(...dropped.map(({ file }) => file)),
    ...handlers,
  });
  const paste = async (keys = CTRL_V) => {
    ui.input(keys);
    await ui.pending();
  };
  return { ui, calls, images, paste };
};

test('Ctrl+V attaches the image on the clipboard and shows it above the input', async () => {
  const { ui, paste } = composerWith();

  await paste();

  const rows = screen(ui, 80, 24).split('\n');
  const input = rows.findIndex(value => value.includes('Message hobkin'));
  assert.match(rows[input - 3], /─ ↳ image 1 ─/);
  assert.match(rows[input - 2], /▀▀▀/);
  assert.match(rows[input - 1], /▀▀▀/);
});

test('Ctrl+V arrives the same from a terminal that reports modified keys', async () => {
  const { ui, paste } = composerWith();

  await paste('\x1b[118;5u');

  assert.match(screen(ui, 80, 24), /↳ image 1/);
});

test('the row of pictures gives way on a terminal too short for it, and the name stays', async () => {
  const { ui, paste } = composerWith();

  await paste();

  const rows = screen(ui, 80, 16);
  assert.match(rows, /↳ image 1/);
  assert.doesNotMatch(rows, /▀▀▀/);
});

test('Esc removes the newest image first, and the hints name the key', async () => {
  const { ui, calls, paste } = composerWith();
  await paste();
  await paste();
  ui.input('words');

  assert.match(screen(ui, 80, 24), /↳ image 1 · image 2/);
  assert.match(screen(ui, 80, 24), /esc drop image/);

  ui.input(ESCAPE);
  assert.doesNotMatch(screen(ui, 80, 24), /image 2/);
  assert.deepEqual(calls.dropped, ['/runtime/pasted/second.png']);

  ui.input(ESCAPE);
  assert.doesNotMatch(screen(ui, 80, 24), /image 1/);
  assert.doesNotMatch(screen(ui, 80, 24), /drop image/);
  assert.equal(ui.state().draft, 'words');
});

const working = { ...liveChat, busy: true, runs: [{ id: 'turn', kind: 'main', title: 'Conversation', state: 'running' }] };

test('Esc while the main agent works stops it, and the draft and its image stay', async () => {
  let stops = 0;
  const { ui, calls, paste } = composerWith({ interrupt: async () => { stops++; return []; } }, working);
  await paste();
  ui.input('half a thought');

  ui.input(ESCAPE);
  await ui.pending();

  assert.equal(stops, 1);
  assert.equal(ui.state().draft, 'half a thought');
  assert.match(screen(ui, 80, 24), /↳ image 1/);
  assert.deepEqual(calls.dropped, []);

  ui.update(liveChat);
  ui.input(ESCAPE);

  assert.equal(stops, 1, 'once the turn has ended, Esc means what it did before');
  assert.deepEqual(calls.dropped, ['/runtime/pasted/first.png']);
});

test('what the agent had not read yet comes back to the input when Esc stops it', async () => {
  const ui = createDashboard(working, { send: async () => {}, interrupt: async () => ['also check the logs'] });
  ui.input('and the tests');

  ui.input(ESCAPE);
  await ui.pending();

  assert.equal(ui.state().draft, 'also check the logs\n\nand the tests');
});

test('a question on screen and the folder question take Esc before the agent does', async () => {
  let stops = 0;
  const ui = createDashboard(working, { send: async () => {}, interrupt: async () => { stops++; return []; } });

  const answer = ui.askQuestion(abc);
  ui.input(ESCAPE);
  assert.equal(await answer, null);

  ui.input('/work');
  ui.input('\r');
  ui.input(ESCAPE);
  assert.doesNotMatch(screen(ui, 80, 24), /Which folder/);
  assert.equal(stops, 0);

  ui.input(ESCAPE);
  await ui.pending();
  assert.equal(stops, 1, 'and the next Esc stops the agent');
});

test('Ctrl+C clears the images with the draft', async () => {
  const { ui, calls, paste } = composerWith();
  await paste();
  ui.input('words');

  ui.input(CTRL_C);

  assert.equal(ui.state().draft, '');
  assert.doesNotMatch(screen(ui, 80, 24), /image 1/);
  assert.deepEqual(calls.dropped, ['/runtime/pasted/first.png']);
});

test('Ctrl+C with only an image attached clears it, and does not start quitting', async () => {
  let quits = 0;
  const { ui, paste } = composerWith({ onQuit: () => { quits++; } });
  await paste();

  ui.input(CTRL_C);
  ui.input(CTRL_C);

  assert.equal(quits, 0);
  assert.match(screen(ui, 80, 24), /Press Ctrl\+C again/);
});

test('sending takes the images along, and the chat marks the message', async () => {
  const { ui, calls, images, paste } = composerWith();
  await paste();
  await paste();

  ui.input('what is this?');
  ui.input('\r');
  await ui.pending();

  assert.deepEqual(calls.sent, [['what is this?', null, images.slice(0, 2)]]);
  assert.equal(ui.state().draft, '');
  assert.deepEqual(calls.dropped, [], 'the file stays until the message has gone');
  const rows = screen(ui, 80, 24).split('\n');
  const you = rows.findIndex(value => value.includes('◆ You'));
  assert.match(rows[you + 1], /↳ 2 images/);
  assert.doesNotMatch(screen(ui, 80, 24), /drop image/);
});

test('Enter sends an image with no words, under a short line for the model', async () => {
  const { ui, calls, images, paste } = composerWith();
  await paste();

  ui.input('\r');
  await ui.pending();

  assert.deepEqual(calls.sent, [[IMAGE_ONLY_TEXT, null, [images[0]]]]);
});

test('Enter with nothing attached and nothing typed still sends nothing', async () => {
  const { ui, calls } = composerWith();

  ui.input('\r');
  await ui.pending();

  assert.deepEqual(calls.sent, []);
});

test('a failed message brings its images back to the composer', async () => {
  const { ui, paste } = composerWith({ send: async () => { throw Error('no route'); } });
  await paste();

  ui.input('look');
  ui.input('\r');
  await ui.pending();

  assert.equal(ui.state().draft, 'look');
  assert.match(screen(ui, 80, 24), /↳ image 1/);
});

test('a failed message that cannot come back lets its images go', async () => {
  const failing = Promise.withResolvers();
  const { ui, calls, paste } = composerWith({ send: () => failing.promise });
  await paste();
  ui.input('look');
  ui.input('\r');
  ui.input('something new');

  failing.reject(Error('no route'));
  await ui.pending();

  assert.equal(ui.state().draft, 'something new');
  assert.doesNotMatch(screen(ui, 80, 24), /↳ image 1/);
  assert.deepEqual(calls.dropped, ['/runtime/pasted/first.png']);
});

test('text on the clipboard leaves Ctrl+V as it was', async () => {
  const { ui, paste } = composerWith({ pasteImage: async () => ({}) });
  ui.input('draft');

  await paste();

  assert.equal(ui.state().draft, 'draft');
  assert.equal(ui.state().notice, '');
  assert.doesNotMatch(screen(ui, 80, 24), /image 1/);
});

test('what stopped a paste says so in the notice row, and nothing else changes', async () => {
  const stopped = { notice: 'No image on the clipboard.', tone: 'warning' };
  const { ui, paste } = composerWith({ pasteImage: async () => stopped });
  ui.input('draft');

  await paste();

  assert.equal(ui.state().notice, 'No image on the clipboard.');
  assert.equal(ui.state().draft, 'draft');
  assert.doesNotMatch(screen(ui, 80, 24), /image 1/);
});

test('a shrunk image still attaches, and says so', async () => {
  const shrunk = { image: picture('big'), notice: 'Shrunk to 1568×784 to send.', tone: 'info' };
  const { ui, paste } = composerWith({ pasteImage: async () => shrunk });

  await paste();

  assert.equal(ui.state().notice, 'Shrunk to 1568×784 to send.');
  assert.match(screen(ui, 80, 24), /↳ image 1/);
});

test('a read that fails says what went wrong', async () => {
  const { ui, paste } = composerWith({ pasteImage: async () => { throw Error('pasteboard busy'); } });

  await paste();

  assert.equal(ui.state().notice, 'Paste failed: pasteboard busy');
});

test('a fifth image is refused without reading the clipboard', async () => {
  const { ui, calls, paste } = composerWith();
  for (let pasted = 0; pasted < 4; pasted++) await paste();

  await paste();

  assert.equal(calls.pasted, 4);
  assert.equal(ui.state().notice, 'A message can hold 4 images.');
});

test('a second Ctrl+V waits for the first read', async () => {
  const reading = Promise.withResolvers();
  let reads = 0;
  const { ui } = composerWith({ pasteImage: () => { reads++; return reading.promise; } });

  ui.input(CTRL_V);
  await new Promise(resolve => setImmediate(resolve));
  ui.input(CTRL_V);
  reading.resolve({ image: picture('only') });
  await ui.pending();

  assert.equal(reads, 1);
  assert.doesNotMatch(screen(ui, 80, 24), /image 2/);
});

test('the composer takes no image while it asks for something else', async () => {
  const { ui, calls, paste } = composerWith();
  await paste();
  ui.input('/work');
  ui.input('\r');
  await ui.pending();

  await paste();

  assert.match(screen(ui, 80, 24), /Which folder should work mode start from/);
  assert.doesNotMatch(screen(ui, 80, 24), /image 1/);
  assert.equal(calls.pasted, 1);
});

test('a terminal that draws images shows the real picture until the message has gone', async () => {
  const written = [];
  const images = new FaceImages({ write: data => written.push(data) });
  const image = { ...picture('real'), picture: 'cGljdHVyZQ==' };
  const accepted = Promise.withResolvers();
  const ui = createDashboard(liveChat, { send: () => accepted.promise, pasteImage: async () => ({ image }) }, { images });
  ui.input(CTRL_V);
  await ui.pending();

  const rows = screen(ui, 120, 40).split('\n');
  const input = rows.findIndex(value => value.includes('Message hobkin'));
  assert.equal(rows.slice(input - 2, input).filter(value => value.split('\u{10EEEE}').length > 3).length, 2);
  assert.ok(rows.every(value => !value.includes('▀▀▀')));
  assert.ok(written.join('').includes('cGljdHVyZQ=='));

  written.length = 0;
  ui.input('\r');
  assert.equal(written.join('').includes('a=d'), false, 'a failed send brings it back');

  accepted.resolve();
  await ui.pending();
  assert.equal(written.join('').match(/a=d,d=I/g).length, 1);
  ui.stop();
});

test('dropping an image takes its picture off the terminal', async () => {
  const written = [];
  const images = new FaceImages({ write: data => written.push(data) });
  const image = { ...picture('real'), picture: 'cGljdHVyZQ==' };
  const ui = createDashboard(liveChat, { send: async () => {}, pasteImage: async () => ({ image }) }, { images });
  ui.input(CTRL_V);
  await ui.pending();
  written.length = 0;

  ui.input(ESCAPE);

  assert.equal(written.join('').match(/a=d,d=I/g).length, 1);
  ui.stop();
});

test('a sent message that had images shows a short marker, read from the conversation', () => {
  const view = { ...liveChat, messages: [{ id: 'one', role: 'user', content: 'look', images: 1, at: soon() }] };
  const ui = createDashboard(view, { send: async () => {} });

  const rows = screen(ui, 80, 24).split('\n');
  const you = rows.findIndex(value => value.includes('◆ You'));
  assert.match(rows[you + 1], /↳ 1 image$/);
  assert.match(rows[you + 2], /look/);
});
