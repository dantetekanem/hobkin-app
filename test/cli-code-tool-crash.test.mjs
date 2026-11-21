import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const source = name => pathToFileURL(new URL(`../src/cli/${name}`, import.meta.url).pathname).href;
const fakePi = '{ on() {}, registerTool() {}, getActiveTools: () => [], setActiveTools() {} }';

/**
 * Pi's code tool as it crashes: when a script finishes, `Execution.finish` in Pi's `execute-*.js` chunk aborts the
 * controller of each call still out, and the abort reason escapes from a listener or a rejection nobody handles.
 */
const codeTool = t => {
  const dir = mkdtempSync(join(tmpdir(), 'hobkin-code-tool-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'execute-FAKE1234.js');
  writeFileSync(file, `export class Execution {
  constructor(escape) {
    this.controller = new AbortController();
    const { signal } = this.controller;
    if (escape === 'listener') signal.addEventListener('abort', () => { throw signal.reason; });
    else new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  }
  finish() { this.controller.abort(); }
  handleDone() { this.finish(); }
}
`);
  return pathToFileURL(file).href;
};

/** A Pi process: it loads the named extensions as Pi does, then runs `body`. */
const piProcess = (t, extensions, body) => {
  const home = mkdtempSync(join(tmpdir(), 'hobkin-code-tool-home-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const program = `
const pi = ${fakePi};
for (const url of ${JSON.stringify(extensions.map(source))}) (await import(url)).default(pi);
${body}
setTimeout(() => process.stdout.write('still running\\n'), 50);
`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8', env: { ...process.env, HOBKIN_HOME: home }, timeout: 10000 });
};
const crash = (url, escape) => `const { Execution } = await import(${JSON.stringify(url)}); new Execution(${JSON.stringify(escape)}).handleDone();`;

for (const escape of ['listener', 'rejection']) {
  test(`without the guard, Pi's code tool abort escaping from a ${escape} ends the process`, { timeout: 15000 }, t => {
    const pi = piProcess(t, [], crash(codeTool(t), escape));

    assert.equal(pi.status, 1);
    assert.match(pi.stderr, /This operation was aborted/);
    assert.doesNotMatch(pi.stdout, /still running/);
  });

  test(`the guard every hobkin run loads keeps Pi going after its code tool abort escapes from a ${escape}, and says so in one line`, { timeout: 15000 }, t => {
    const pi = piProcess(t, ['code-tool-crash.mjs'], crash(codeTool(t), escape));

    assert.equal(pi.status, 0, pi.stderr);
    assert.match(pi.stdout, /still running/);
    assert.equal(pi.stderr.trim().split('\n').length, 1);
    assert.match(pi.stderr, /^hobkin: .*code tool/);
  });
}

test('the main chat and the agents a run spawns get the guard too, installed once however many extensions bring it', { timeout: 15000 }, t => {
  const pi = piProcess(t, ['code-tool-crash.mjs', 'agent-directions-extension.mjs', 'hobkin-extension.mjs'],
    `${crash(codeTool(t), 'listener')} process.stdout.write(\`listeners \${process.listenerCount('uncaughtException')}\\n\`);`);

  assert.equal(pi.status, 0, pi.stderr);
  assert.match(pi.stdout, /listeners 1\n/);
  assert.match(pi.stdout, /still running/);

  for (const name of ['agent-directions-extension.mjs', 'hobkin-extension.mjs']) {
    const alone = piProcess(t, [name], crash(codeTool(t), 'rejection'));
    assert.equal(alone.status, 0, `${name}: ${alone.stderr}`);
  }
});

test('with the guard, every other uncaught error still ends Pi with its stack, as before', { timeout: 15000 }, t => {
  const thrown = piProcess(t, ['code-tool-crash.mjs'], "setTimeout(() => { throw new Error('boom from a tool'); });");
  assert.equal(thrown.status, 1);
  assert.match(thrown.stderr, /Error: boom from a tool\n\s+at /);

  const rejected = piProcess(t, ['code-tool-crash.mjs'], "Promise.reject(new Error('rejected elsewhere'));");
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /rejected elsewhere/);

  // An abort of any other controller is not Pi's code tool finishing.
  const otherAbort = piProcess(t, ['code-tool-crash.mjs'], 'const controller = new AbortController(); controller.abort(); Promise.reject(controller.signal.reason);');
  assert.equal(otherAbort.status, 1);
  assert.match(otherAbort.stderr, /This operation was aborted/);
});

test('with another handler of its own in Pi, the guard leaves every other error to it', { timeout: 15000 }, t => {
  const pi = piProcess(t, ['code-tool-crash.mjs'], `
process.on('uncaughtException', error => { process.stdout.write(\`handled \${error.message}\\n\`); });
setTimeout(() => { throw new Error('theirs'); });`);

  assert.equal(pi.status, 0, pi.stderr);
  assert.match(pi.stdout, /handled theirs\n/);
  assert.equal(pi.stderr, '');
});

// What a run's result says when its Pi exited this way, as a report of 2026-11-21 has it.
const crashed = `Harness exited before completion (1). or]: This operation was aborted
      at new DOMException (node:internal/per_context/domexception:76:18)
      at AbortController.abort (node:internal/abort_controller:504:18)
      at Execution.finish (file:///pnpm/@earendil-works/pi-coding-agent/1.5.2/dist/bundle/chunks/execute-L2EEDV3L.js:2:8423)
      at Execution.handleDone (file:///pnpm/@earendil-works/pi-coding-agent/1.5.2/dist/bundle/chunks/execute-L2EEDV3L.js:2:6630)`;

const job = (t, { saved = true } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'hobkin-restart-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sessionFile = join(dir, 'job.jsonl');
  if (saved) writeFileSync(sessionFile, '{"type":"session"}\n');
  return { id: 'f094b0ba-036c-4abc-9198-745fd1226765', harness: 'pi', cwd: dir, effort: 'medium', prompt: 'Read the brief and follow it.', images: [{ type: 'image', data: 'AA==', mimeType: 'image/png' }], sessionFile };
};
/** A harness whose attempts answer in turn with `results`, recording what each was asked. */
const attempts = results => {
  const asked = [];
  const run = async (request, options) => {
    asked.push({ request, options });
    return results[asked.length - 1];
  };
  return { run, asked };
};

test('a run whose Pi crashed in its code tool starts again once on its own session, told why, and carries on', async t => {
  const { restartingAfterCodeToolCrash } = await import(source('code-tool-crash.mjs'));
  const request = job(t);
  const { run, asked } = attempts([
    { status: 'failed', error: crashed, freshSession: true, cost: null },
    { status: 'completed', text: 'Useful: registered.', freshSession: false, cost: { usd: 0.3 } },
  ]);

  const result = await restartingAfterCodeToolCrash(run)(request);

  assert.equal(asked.length, 2);
  const again = asked[1].request;
  assert.deepEqual([again.id, again.sessionFile, again.cwd], [request.id, request.sessionFile, request.cwd]);
  assert.match(again.prompt, /crashed in its code tool/);
  assert.match(again.prompt, /from where you stopped/);
  assert.doesNotMatch(again.prompt, /Read the brief/, 'the saved session already holds the task');
  assert.equal(again.images, undefined);
  assert.equal(result.status, 'completed');
  assert.equal(result.text, 'Useful: registered.');
  assert.equal(result.freshSession, true, 'its cost still counts from the session it began');
  assert.deepEqual(result.restarted, { error: crashed });
});

test('with no session saved yet, the restarted run is given the whole task again', async t => {
  const { restartingAfterCodeToolCrash } = await import(source('code-tool-crash.mjs'));
  const request = job(t, { saved: false });
  const { run, asked } = attempts([{ status: 'failed', error: crashed }, { status: 'completed', text: 'Done.' }]);

  await restartingAfterCodeToolCrash(run)(request);

  assert.match(asked[1].request.prompt, /crashed in its code tool[\s\S]*\n\nRead the brief and follow it\.$/);
  assert.deepEqual(asked[1].request.images, request.images);
});

test('hobkin restarts a run once: a second crash ends it failed', async t => {
  const { restartingAfterCodeToolCrash } = await import(source('code-tool-crash.mjs'));
  const { run, asked } = attempts([{ status: 'failed', error: crashed }, { status: 'failed', error: crashed }, { status: 'completed', text: 'never' }]);

  const result = await restartingAfterCodeToolCrash(run)(job(t));

  assert.equal(asked.length, 2);
  assert.equal(result.status, 'failed');
  assert.equal(result.error, crashed);
  assert.deepEqual(result.restarted, { error: crashed });
});

test('any other failure, a run the user stopped and a process started ahead of its turn are never restarted', async t => {
  const { restartingAfterCodeToolCrash } = await import(source('code-tool-crash.mjs'));
  const stopped = new AbortController();
  stopped.abort();
  for (const [request, first] of [
    [job(t), { status: 'failed', error: 'Harness exited before completion (1). Error: boom\n    at tool (file:///tool.js:1:1)' }],
    [job(t), { status: 'interrupted', error: crashed }],
    [{ ...job(t), signal: stopped.signal }, { status: 'failed', error: crashed }],
    [{ ...job(t), warm: true }, { status: 'failed', error: crashed }],
  ]) {
    const { run, asked } = attempts([first, { status: 'completed', text: 'never' }]);
    assert.deepEqual(await restartingAfterCodeToolCrash(run)(request), first);
    assert.equal(asked.length, 1);
  }
});

test("the run's process handle and its inbox reach whichever attempt is running", async t => {
  const { restartingAfterCodeToolCrash } = await import(source('code-tool-crash.mjs'));
  const forced = [];
  const child = name => {
    const closed = Promise.withResolvers();
    return { name, closed: closed.promise, close: () => closed.resolve({ code: 0 }), force: () => forced.push(name), terminate() {}, changeBinding: async change => ({ name, ...change }) };
  };
  const children = [child('first'), child('second')];
  const sent = [];
  let bound = 0, handle, ready = 0, send, closedEarly = false;
  const run = async (_request, options) => {
    const own = children.shift();
    options.onControl(own);
    options.onReady(async message => sent.push([own.name, message]));
    if (own.name === 'second') {
      await send('steer');
      handle.force();
      assert.deepEqual(await handle.changeBinding({ effort: 'high' }), { name: 'second', effort: 'high' });
    }
    own.close();
    return own.name === 'first' ? { status: 'failed', error: crashed } : { status: 'completed', text: 'Done.' };
  };
  const result = restartingAfterCodeToolCrash(run)(job(t), {
    onControl: given => { bound++; handle = given; given.closed.then(() => { closedEarly = !finished; }); },
    onReady: given => { ready++; send = given; },
  });
  let finished = false;
  await result.then(() => { finished = true; });
  await handle.closed;

  assert.equal(bound, 1, 'the runtime binds one process handle for the run');
  assert.equal(ready, 1);
  assert.deepEqual(sent, [['second', 'steer']]);
  assert.deepEqual(forced, ['second']);
  assert.equal(closedEarly, false, 'the handle closes only once the last attempt has');
});
