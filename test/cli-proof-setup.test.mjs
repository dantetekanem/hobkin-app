// `hobkin proof setup` and the tools a check runs (_specs/050-tla-proofs). Nothing here downloads or runs Java: the fetch
// and the commands are stubs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupProof } from '../src/cli/proof/setup.mjs';
import { findJava, findTools, jarPath, TLA2TOOLS } from '../src/cli/proof/tools.mjs';

function temp(t, prefix) {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

test('Java is found through JAVA_HOME, macOS\'s java_home or the PATH, and too old or missing says why', async () => {
  const calls = [];
  const exec = answers => async (command, args) => {
    calls.push([command, ...args].join(' '));
    const answer = answers[[command, ...args].join(' ')];
    if (answer instanceof Error || answer === undefined) throw answer ?? Object.assign(Error('spawn ENOENT'), { code: 'ENOENT' });
    return answer;
  };
  const modern = { stdout: '', stderr: 'openjdk version "21.0.2" 2024-01-16\n' };

  assert.deepEqual(await findJava({ env: { JAVA_HOME: '/jdk' }, platform: 'linux', exec: exec({ '/jdk/bin/java -version': modern }) }),
    { path: '/jdk/bin/java', version: '21.0.2', major: 21 });
  assert.deepEqual(await findJava({ env: {}, platform: 'darwin', exec: exec({ '/usr/libexec/java_home': { stdout: '/Library/Java/jdk-17/Contents/Home\n', stderr: '' }, '/Library/Java/jdk-17/Contents/Home/bin/java -version': { stdout: '', stderr: 'java version "17.0.9" 2023-10-17 LTS\n' } }) }),
    { path: '/Library/Java/jdk-17/Contents/Home/bin/java', version: '17.0.9', major: 17 });
  assert.deepEqual(await findJava({ env: {}, platform: 'linux', exec: exec({ 'java -version': { stdout: '', stderr: 'java version "1.8.0_392"\n' } }) }),
    { path: null, problem: 'Java 8 is too old. TLC needs Java 11 or newer.' });
  // macOS ships /usr/bin/java as a stub that fails without a JDK, and java_home fails the same way.
  const stubbed = Object.assign(Error('Command failed'), { code: 1 });
  assert.deepEqual(await findJava({ env: {}, platform: 'darwin', exec: exec({ '/usr/libexec/java_home': stubbed, 'java -version': stubbed }) }),
    { path: null, problem: 'Java is not installed. TLC needs Java 11 or newer.' });
});

test('the tools are found where hobkin keeps them: the jar in tools/tla, tlapm in tools/tlaps or on the PATH', async t => {
  const home = temp(t, 'hobkin-proof-tools-');
  const exec = async () => ({ stdout: '', stderr: 'openjdk version "21.0.2"\n' });
  assert.deepEqual(await findTools(home, { env: { PATH: '' }, platform: 'linux', exec }), { java: 'java', tlc: null, tlaps: null });

  mkdirSync(join(home, 'tools', 'tla'), { recursive: true });
  writeFileSync(jarPath(home), '');
  mkdirSync(join(home, 'tools', 'tlaps', 'bin'), { recursive: true });
  writeFileSync(join(home, 'tools', 'tlaps', 'bin', 'tlapm'), '');
  assert.deepEqual(await findTools(home, { env: { PATH: '' }, platform: 'linux', exec }),
    { java: 'java', tlc: join(home, 'tools', 'tla', 'tla2tools.jar'), tlaps: join(home, 'tools', 'tlaps', 'bin', 'tlapm') });
});

test('setup without Java says so in one line and changes nothing', async t => {
  const home = temp(t, 'hobkin-proof-setup-');
  let fetched = false;
  const said = await setupProof({ home, fetch: async () => { fetched = true; }, java: async () => ({ path: null, problem: 'Java is not installed. TLC needs Java 11 or newer.' }) });

  assert.equal(said.ok, false);
  assert.equal(said.message, 'Java is not installed. TLC needs Java 11 or newer. hobkin downloaded nothing.');
  assert.doesNotMatch(said.message, /\n/);
  assert.equal(fetched, false);
  assert.equal(existsSync(join(home, 'tools')), false);
});

test('setup downloads the pinned jar into tools/tla and keeps it only when its checksum matches', async t => {
  const home = temp(t, 'hobkin-proof-setup-');
  const java = async () => ({ path: '/jdk/bin/java', version: '21.0.2', major: 21 });
  const body = Buffer.from('the pinned jar');
  const pinned = { ...TLA2TOOLS, sha1: createHash('sha1').update(body).digest('hex') };
  const asked = [];
  const fetch = async url => {
    asked.push(url);
    return { ok: true, status: 200, arrayBuffer: async () => body };
  };

  const tampered = await setupProof({ home, fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from('something else') }), java, pinned });
  assert.equal(tampered.ok, false);
  assert.match(tampered.message, /did not match/);
  assert.equal(existsSync(jarPath(home)), false);

  const done = await setupProof({ home, fetch, java, pinned });
  assert.equal(done.ok, true);
  assert.deepEqual(asked, ['https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar']);
  assert.equal(readFileSync(jarPath(home), 'utf8'), 'the pinned jar');

  const again = await setupProof({ home, fetch: async () => assert.fail('the jar is already there'), java, pinned });
  assert.equal(again.ok, true);
  assert.match(again.message, /already/);
});
