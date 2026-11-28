import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canvasSkill, closeCanvas, drawCanvas, drawingFile, readCanvas, readCanvases, runCanvasCommand, saveCanvas, showPage } from '../src/cli/canvas.mjs';
import { durableDirections } from '../src/cli/hobkins.mjs';

const temp = () => mkdtempSync(join(tmpdir(), 'hobkin-canvas-'));
const DURABLE = 'abcdef01';

test('a drawing opens the canvas, replaces the last one and stays within its size', () => {
  const root = temp();
  const first = drawCanvas(root, 'main', { html: '<h1>one</h1>', title: '  Plan  ' });
  assert.deepEqual([first.open, first.kind, first.url, first.title, first.revision], [true, 'drawing', null, 'Plan', 1]);
  assert.match(first.key, /^[0-9a-f]{32}$/);
  assert.equal(readFileSync(drawingFile(root, 'main'), 'utf8'), '<h1>one</h1>');

  const second = drawCanvas(root, 'main', { html: '<h1>two</h1>' });
  assert.equal(second.revision, 2);
  assert.equal(second.title, null);
  assert.equal(second.key, first.key);

  for (const html of ['x'.repeat(2 * 1024 * 1024 + 1), 'a\0b', '']) {
    assert.throws(() => drawCanvas(root, 'main', { html, title: 'Bad' }));
  }
  assert.throws(() => drawCanvas(root, 'main', { html: '<p/>', title: 'x'.repeat(121) }), /120/);
  assert.deepEqual(readCanvases(root).main, second);
  assert.equal(readFileSync(drawingFile(root, 'main'), 'utf8'), '<h1>two</h1>');
  assert.equal(readdirSync(join(root, 'canvas')).filter(name => name.endsWith('.tmp')).length, 0);
  drawCanvas(root, 'main', { html: 'x'.repeat(2 * 1024 * 1024) });
});

test('a page opens, only http and https, and each hobkin has its own canvas', () => {
  const root = temp();
  const page = showPage(root, 'main', { url: 'https://example.com/a', title: 'Example' });
  assert.deepEqual([page.open, page.kind, page.url, page.revision], [true, 'page', 'https://example.com/a', 1]);
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:pw@example.com/', 'nonsense', 'http://']) {
    assert.throws(() => showPage(root, 'main', { url }));
  }
  assert.deepEqual(readCanvases(root).main, page);

  drawCanvas(root, DURABLE, { html: '<p>mine</p>' });
  assert.equal(readCanvases(root).main.kind, 'page');
  assert.equal(readCanvases(root)[DURABLE].kind, 'drawing');
  assert.throws(() => drawCanvas(root, 'ABC', { html: '<p/>' }), /durable hobkin/);
  assert.throws(() => showPage(root, '../x', { url: 'https://example.com' }));

  const closed = closeCanvas(root, 'main');
  assert.equal(closed.open, false);
  assert.equal(closed.url, 'https://example.com/a');
  assert.equal(readCanvases(root)[DURABLE].open, true);
});

test("read gives the drawing's path and save never replaces a file", () => {
  const root = temp();
  const out = temp();
  assert.equal(readCanvas(root, 'main').file, null);
  assert.throws(() => saveCanvas(root, 'main', { downloads: out, home: out }), /no drawing/);
  drawCanvas(root, 'main', { html: '<p>hi</p>', title: 'My Plan!' });
  assert.equal(readCanvas(root, 'main').file, drawingFile(root, 'main'));

  const downloads = join(out, 'Downloads');
  assert.equal(saveCanvas(root, 'main', { downloads, home: out }).path, join(downloads, 'my-plan.html'));
  assert.equal(saveCanvas(root, 'main', { downloads, home: out }).path, join(downloads, 'my-plan-2.html'));
  assert.equal(saveCanvas(root, 'main', { downloads, home: out }).path, join(downloads, 'my-plan-3.html'));
  assert.equal(readFileSync(join(downloads, 'my-plan.html'), 'utf8'), '<p>hi</p>');

  assert.equal(saveCanvas(root, 'main', { path: '~/notes/draw', home: out }).path, join(out, 'notes', 'draw.html'));
  assert.throws(() => saveCanvas(root, 'main', { path: '~/notes/draw.html', home: out }), /already exists/);
  assert.throws(() => saveCanvas(root, 'main', { path: 'relative.html', home: out }), /in full/);
  drawCanvas(root, 'main', { html: '<p>x</p>' });
  assert.equal(saveCanvas(root, 'main', { downloads, home: out }).path, join(downloads, 'canvas.html'));
});

test('the canvases are read back as they were written', () => {
  const root = temp();
  assert.deepEqual(readCanvases(root), {});
  const main = drawCanvas(root, 'main', { html: '<p/>', title: 'A' });
  const durable = showPage(root, DURABLE, { url: 'https://example.com/' });
  assert.deepEqual(readCanvases(root), { main, [DURABLE]: durable });
  assert.equal(JSON.parse(readFileSync(join(root, 'canvas', 'state.json'), 'utf8')).version, 1);

  const file = join(root, 'canvas', 'state.json');
  const state = JSON.parse(readFileSync(file, 'utf8'));
  state.canvases.broken = { open: 'yes' };
  state.canvases.main.revision = 'x';
  writeFileSync(file, JSON.stringify(state));
  assert.deepEqual(readCanvases(root), { [DURABLE]: durable });
  writeFileSync(file, '{not json');
  assert.deepEqual(readCanvases(root), {});
});

test('a session shell opens its own preview without naming a canvas', async () => {
  const root = temp();
  const env = { HOBKIN_CANVAS_RUN: 'session:hobkin-preview-abcd' };
  await runCanvasCommand(root, ['show', 'http://localhost:3187'], { env });
  assert.deepEqual(Object.keys(readCanvases(root)), ['session-hobkin-preview-abcd']);
  await assert.rejects(runCanvasCommand(root, ['close'], { env, hobkin: 'main' }));
});

test('the real command writes the store of a home and prints one line of JSON', () => {
  const root = temp();
  const home = join(root, 'home');
  const entry = fileURLToPath(new URL('../src/cli/main.mjs', import.meta.url));
  const run = (args, input) => spawnSync(process.execPath, [entry, 'canvas', ...args, '--home', home], { encoding: 'utf8', input, timeout: 20000, cwd: root });
  const init = spawnSync(process.execPath, [entry, 'init', '--home', home], { encoding: 'utf8', timeout: 20000, cwd: root });
  assert.equal(init.status, 0, init.stderr);

  const drew = run(['draw', '-', '--title', 'Sketch'], '<p>sketch</p>');
  assert.equal(drew.status, 0, drew.stderr);
  assert.equal(drew.stdout.trim().split('\n').length, 1);
  const line = JSON.parse(drew.stdout);
  assert.deepEqual([line.open, line.kind, line.title, line.revision], [true, 'drawing', 'Sketch', 1]);
  assert.equal(readFileSync(line.file, 'utf8'), '<p>sketch</p>');

  const file = join(root, 'd.html');
  writeFileSync(file, '<p>again</p>');
  assert.equal(JSON.parse(run(['draw', file, '--hobkin', DURABLE], '').stdout).revision, 1);
  assert.equal(JSON.parse(run(['read']).stdout).revision, 1);
  const shown = JSON.parse(run(['show', 'https://example.com/']).stdout);
  assert.deepEqual([shown.kind, shown.url, shown.revision], ['page', 'https://example.com/', 2]);
  const refused = run(['show', 'ftp://example.com/']);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /http and https/);
  assert.equal(JSON.parse(run(['close']).stdout).open, false);
  assert.equal(JSON.parse(run(['read', '--hobkin', DURABLE]).stdout).open, true);
  assert.notEqual(run(['read', '--hobkin', 'nope']).status, 0);
  assert.equal(existsSync(join(home, 'canvas', 'state.json')), true);
});

test("the main prompts and a durable hobkin's directions hold the canvas skill", () => {
  const skill = canvasSkill();
  for (const word of ['canvas show', 'canvas draw', 'canvas read', 'canvas save', 'canvas close', '--hobkin']) assert.ok(skill.includes(word), word);
  assert.ok(!skill.includes('—'));
  const source = readFileSync(new URL('../src/cli/pi-session.mjs', import.meta.url), 'utf8');
  assert.match(source, /function mainPrompts[\s\S]*?'canvas'/);
  const directions = durableDirections(DURABLE);
  assert.ok(directions.includes(skill), 'a durable hobkin gets the whole skill');
  assert.ok(directions.includes(readFileSync(new URL('../src/prompts/durable.md', import.meta.url), 'utf8').trim()));
  assert.ok(directions.includes(`--hobkin ${DURABLE}`), 'and its own id for the flag');
  assert.ok(!durableDirections('12345678').includes(DURABLE));
});

test('the command reads no more than a drawing may hold, and only from a file or standard input', async () => {
  const root = temp();
  drawCanvas(root, 'main', { html: '<p>kept</p>' });

  // Input that never ends is refused once it passes 2 MiB, instead of being read until memory runs out.
  let chunks = 0;
  const endless = (async function* () { for (;;) { chunks += 1; yield Buffer.alloc(64 * 1024, 'a'); } })();
  await assert.rejects(runCanvasCommand(root, ['draw', '-'], { input: endless }), /over 2 MiB/);
  assert.ok(chunks <= 34, `read ${chunks} chunks`);

  // A device has no size to check, so it is no file to draw from.
  await assert.rejects(runCanvasCommand(root, ['draw', '/dev/zero']), /as a file/);
  await assert.rejects(runCanvasCommand(root, ['draw', join(root, 'missing.html')]), /no file/);
  assert.equal(readFileSync(drawingFile(root, 'main'), 'utf8'), '<p>kept</p>', 'the drawing that was there stays');

  const file = join(root, 'page.html');
  writeFileSync(file, '<p>new</p>');
  assert.equal((await runCanvasCommand(root, ['draw', file], { title: 'Page' })).revision, 2);
  assert.equal(readFileSync(drawingFile(root, 'main'), 'utf8'), '<p>new</p>');
});
