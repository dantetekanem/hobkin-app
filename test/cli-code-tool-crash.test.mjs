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
