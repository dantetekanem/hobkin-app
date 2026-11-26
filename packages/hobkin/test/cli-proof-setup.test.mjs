// `hobkin proof setup` and the tools a check runs (_specs/050-tla-proofs). Nothing here downloads or runs Java: the fetch
// and the commands are stubs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupProof } from '../src/cli/proof/setup.mjs';
import { findJava, findTlapm, findTools, JAVA_RUNTIME, jarPath, ownJava, TLA2TOOLS, TLAPS, tlapsFolder, tlapsLibrary } from '../src/cli/proof/tools.mjs';

function temp(t, prefix) {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** A fetch that answers each pinned url with its body and records what was asked. */
const serving = (bodies, asked = []) => async url => {
  asked.push(url);
  return bodies[url] ? { ok: true, status: 200, arrayBuffer: async () => bodies[url] } : { ok: false, status: 404 };
};

/** Only the tlapm in hobkin's own tools folder, so the PATH of the machine running the tests never counts. */
const ownTlapm = home => findTlapm(home, { env: { PATH: '' } });

/** tar is stubbed: it lays out the TLAPS archive's one top folder, `tlapm/`, with its backends, as 1.6.0-pre's does. */
const unpackTlaps = body => async (archive, into) => {
  assert.equal(readFileSync(archive, 'utf8'), body);
  mkdirSync(join(into, 'tlapm', 'bin'), { recursive: true });
  writeFileSync(join(into, 'tlapm', 'bin', 'tlapm'), '');
  mkdirSync(join(into, 'tlapm', 'lib', 'tlapm', 'backends', 'bin'), { recursive: true });
  writeFileSync(join(into, 'tlapm', 'lib', 'tlapm', 'backends', 'bin', 'z3'), '');
};

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

test('TLAPS\'s standard library is the one beside the tlapm found, through a link on the PATH too, and none when it is not there', t => {
  const root = realpathSync(temp(t, 'hobkin-tlaps-root-'));
  const tlapm = join(root, 'bin', 'tlapm');
  mkdirSync(join(root, 'bin'));
  writeFileSync(tlapm, '');
  assert.equal(tlapsLibrary(tlapm), null, 'only once its TLAPS.tla is there');

  const stdlib = join(root, 'lib', 'tlapm', 'stdlib');
  mkdirSync(stdlib, { recursive: true });
  writeFileSync(join(stdlib, 'TLAPS.tla'), '');
  assert.equal(tlapsLibrary(tlapm), stdlib);

  const onPath = temp(t, 'hobkin-tlaps-path-');
  symlinkSync(tlapm, join(onPath, 'tlapm'));
  assert.equal(tlapsLibrary(join(onPath, 'tlapm')), stdlib);
  assert.equal(tlapsLibrary(null), null);
});

test('Java hobkin installed itself, in tools/java, is found before the PATH', async t => {
  const home = temp(t, 'hobkin-proof-java-');
  const exec = async command => {
    if (command === ownJava(home)) return { stdout: '', stderr: 'openjdk version "21.0.13.1" 2025-10-21 LTS\n' };
    throw Object.assign(Error('Command failed'), { code: 1 });
  };
  assert.equal((await findJava({ home, env: {}, platform: 'darwin', exec })).path, null, 'only once it is there');
  mkdirSync(join(home, 'tools', 'java', 'Contents', 'Home', 'bin'), { recursive: true });
  writeFileSync(ownJava(home), '');
  assert.deepEqual(await findJava({ home, env: {}, platform: 'darwin', exec }), { path: ownJava(home), version: '21.0.13.1', major: 21 });
  assert.equal(ownJava(home), join(home, 'tools', 'java', 'Contents', 'Home', 'bin', 'java'));
});

test('setup without Java off a Mac says so in one line and changes nothing', async t => {
  const home = temp(t, 'hobkin-proof-setup-');
  let fetched = false;
  const said = await setupProof({ home, platform: 'linux', arch: 'x64', fetch: async () => { fetched = true; }, java: async () => ({ path: null, problem: 'Java is not installed. TLC needs Java 11 or newer.' }) });

  assert.equal(said.ok, false);
  assert.equal(said.message, 'Java is not installed. TLC needs Java 11 or newer. hobkin installs Java only on a Mac. hobkin kept nothing.');
  assert.doesNotMatch(said.message, /\n/);
  assert.equal(fetched, false);
  assert.equal(existsSync(join(home, 'tools')), false);
});

test('setup downloads the pinned jar into tools/tla and keeps it only when its checksum matches', async t => {
  const home = temp(t, 'hobkin-proof-setup-');
  const java = async () => ({ path: '/jdk/bin/java', version: '21.0.2', major: 21 });
  const body = Buffer.from('the pinned jar');
  const pinned = { ...TLA2TOOLS, sha1: createHash('sha1').update(body).digest('hex'), sha256: createHash('sha256').update(body).digest('hex') };
  const asked = [];
  const fetch = async url => {
    asked.push(url);
    return { ok: true, status: 200, arrayBuffer: async () => body };
  };

  const tlapm = () => '/opt/tlaps/bin/tlapm';

  const tampered = await setupProof({ home, fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from('something else') }), java, pinned, tlapm });
  assert.equal(tampered.ok, false);
  assert.match(tampered.message, /did not match/);
  assert.equal(existsSync(jarPath(home)), false);

  const done = await setupProof({ home, fetch, java, pinned, tlapm });
  assert.equal(done.ok, true);
  assert.deepEqual(asked, ['https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar']);
  assert.equal(readFileSync(jarPath(home), 'utf8'), 'the pinned jar');

  const again = await setupProof({ home, fetch: async () => assert.fail('the jar is already there'), java, pinned, tlapm });
  assert.equal(again.ok, true);
  assert.match(again.message, /already/);
});

test('setup on a Mac without Java installs the pinned Java runtime into tools/java, checked by its sha256, then the jar', async t => {
  const home = temp(t, 'hobkin-proof-setup-');
  const runtime = Buffer.from('the pinned runtime');
  const jarBody = Buffer.from('the pinned jar');
  const build = { ...JAVA_RUNTIME.builds.arm64, sha256: createHash('sha256').update(runtime).digest('hex') };
  const java = { ...JAVA_RUNTIME, builds: { ...JAVA_RUNTIME.builds, arm64: build } };
  const pinned = { ...TLA2TOOLS, sha1: createHash('sha1').update(jarBody).digest('hex'), sha256: createHash('sha256').update(jarBody).digest('hex') };
  const asked = [];
  const fetch = async url => {
    asked.push(url);
    return { ok: true, status: 200, arrayBuffer: async () => (url === build.url ? runtime : jarBody) };
  };
  // tar is stubbed: it lays out the archive's one top folder, as Temurin's does.
  const unpack = async (archive, into) => {
    assert.equal(readFileSync(archive, 'utf8'), 'the pinned runtime');
    mkdirSync(join(into, 'jdk-21.0.13.1+2-jre', 'Contents', 'Home', 'bin'), { recursive: true });
    writeFileSync(join(into, 'jdk-21.0.13.1+2-jre', 'Contents', 'Home', 'bin', 'java'), '');
  };
  let installed = false;
  const findJavaStub = async () => (installed || existsSync(ownJava(home)) ? (installed = true, { path: ownJava(home), version: '21.0.13.1', major: 21 }) : { path: null, problem: 'Java is not installed. TLC needs Java 11 or newer.' });

  const tlapm = () => '/opt/tlaps/bin/tlapm';

  const tampered = await setupProof({ home, platform: 'darwin', arch: 'arm64', fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from('something else') }), unpack, java: findJavaStub, javaRuntime: java, pinned, tlapm });
  assert.equal(tampered.ok, false);
  assert.match(tampered.message, /did not match Java 21\.0\.13\.1\+2's pinned sha256/);
  assert.equal(existsSync(join(home, 'tools', 'java')), false, 'nothing is kept');

  const done = await setupProof({ home, platform: 'darwin', arch: 'arm64', fetch, unpack, java: findJavaStub, javaRuntime: java, pinned, tlapm });
  assert.equal(done.ok, true, done.message);
  assert.deepEqual(asked, [build.url, TLA2TOOLS.url]);
  assert.equal(existsSync(ownJava(home)), true);
  assert.equal(readFileSync(jarPath(home), 'utf8'), 'the pinned jar');
  assert.match(done.message, /^Installed Java 21\.0\.13\.1\+2 into .*tools\/java and TLC 1\.7\.4 into .*tla2tools\.jar, each checked by its pinned checksum\. TLAPS is already at \/opt\/tlaps\/bin\/tlapm\.$/);
  assert.doesNotMatch(done.message, /\n/);
});

test('setup on an Apple-silicon Mac without tlapm installs the pinned TLAPS whole into tools/tlaps, checked by its sha256', async t => {
  const home = temp(t, 'hobkin-proof-setup-');
  const jarBody = Buffer.from('the pinned jar');
  const archive = Buffer.from('the pinned tlapm');
  const pinned = { ...TLA2TOOLS, sha1: createHash('sha1').update(jarBody).digest('hex'), sha256: sha256(jarBody) };
  const tlaps = { ...TLAPS, builds: { arm64: { ...TLAPS.builds.arm64, sha256: sha256(archive) } } };
  const asked = [];
  const fetch = serving({ [TLA2TOOLS.url]: jarBody, [TLAPS.builds.arm64.url]: archive }, asked);
  const java = async () => ({ path: '/jdk/bin/java', version: '21.0.2', major: 21 });
  const options = { home, platform: 'darwin', arch: 'arm64', java, pinned, tlaps, tlapm: ownTlapm, unpack: unpackTlaps('the pinned tlapm') };

  const done = await setupProof({ ...options, fetch });
  assert.equal(done.ok, true, done.message);
  assert.deepEqual(asked, [TLA2TOOLS.url, TLAPS.builds.arm64.url]);
  assert.equal(ownTlapm(home), join(tlapsFolder(home), 'bin', 'tlapm'));
  assert.equal(existsSync(join(tlapsFolder(home), 'lib', 'tlapm', 'backends', 'bin', 'z3')), true, 'its backends come with it');
  assert.deepEqual(readdirSync(join(home, 'tools')).sort(), ['tla', 'tlaps'], 'nothing half-unpacked is left beside it');
  assert.match(done.message, /^Downloaded TLC 1\.7\.4 into .*tla2tools\.jar and checked its sha1 and sha256\. It runs on Java 21\.0\.2\. Installed TLAPS 1\.6\.0-pre into .*tools\/tlaps, checked by its pinned sha256\.$/);
  assert.doesNotMatch(done.message, /\n/);

  const again = await setupProof({ ...options, fetch: async () => assert.fail('TLC and TLAPS are already there') });
  assert.equal(again.ok, true);
  assert.match(again.message, /^TLC 1\.7\.4 is already in .*, on Java 21\.0\.2\. TLAPS is already at .*tools\/tlaps\/bin\/tlapm\.$/);
});

test('a TLAPS download that does not match its pin is not kept, says the pre-release was rebuilt, and leaves Java and TLC installed', async t => {
  const home = temp(t, 'hobkin-proof-setup-');
  const runtime = Buffer.from('the pinned runtime');
  const jarBody = Buffer.from('the pinned jar');
  const build = { ...JAVA_RUNTIME.builds.arm64, sha256: sha256(runtime) };
  const javaRuntime = { ...JAVA_RUNTIME, builds: { ...JAVA_RUNTIME.builds, arm64: build } };
  const pinned = { ...TLA2TOOLS, sha1: createHash('sha1').update(jarBody).digest('hex'), sha256: sha256(jarBody) };
  const fetch = serving({ [build.url]: runtime, [TLA2TOOLS.url]: jarBody, [TLAPS.builds.arm64.url]: Buffer.from('a rebuilt pre-release') });
  const unpack = async (archive, into) => {
    assert.equal(readFileSync(archive, 'utf8'), 'the pinned runtime', 'only Java is unpacked');
    mkdirSync(join(into, 'jdk-21.0.13.1+2-jre', 'Contents', 'Home', 'bin'), { recursive: true });
    writeFileSync(join(into, 'jdk-21.0.13.1+2-jre', 'Contents', 'Home', 'bin', 'java'), '');
  };
  const java = async () => (existsSync(ownJava(home)) ? { path: ownJava(home), version: '21.0.13.1', major: 21 } : { path: null, problem: 'Java is not installed. TLC needs Java 11 or newer.' });

  const said = await setupProof({ home, platform: 'darwin', arch: 'arm64', fetch, unpack, java, javaRuntime, pinned, tlapm: ownTlapm });
  assert.equal(said.ok, true, 'a model check can still run');
  assert.equal(existsSync(ownJava(home)), true);
  assert.equal(readFileSync(jarPath(home), 'utf8'), 'the pinned jar');
  assert.equal(existsSync(tlapsFolder(home)), false);
  assert.deepEqual(readdirSync(join(home, 'tools')).sort(), ['java', 'tla']);
  assert.match(said.message, /^Installed Java 21\.0\.13\.1\+2 into .*tools\/java and TLC 1\.7\.4 into .*tla2tools\.jar, each checked by its pinned checksum\. The TLAPS 1\.6\.0-pre download did not match hobkin's pinned sha256: the pre-release was rebuilt, so hobkin's pin needs updating\. hobkin kept no TLAPS\.$/);
  assert.doesNotMatch(said.message, /\n/);
});

test('on an Intel Mac setup installs TLC and says in its one line that TLAPS has no build for this Mac', async t => {
  const home = temp(t, 'hobkin-proof-setup-');
  const jarBody = Buffer.from('the pinned jar');
  const pinned = { ...TLA2TOOLS, sha1: createHash('sha1').update(jarBody).digest('hex'), sha256: sha256(jarBody) };
  const asked = [];
  const java = async () => ({ path: '/jdk/bin/java', version: '21.0.2', major: 21 });

  const said = await setupProof({ home, platform: 'darwin', arch: 'x64', fetch: serving({ [TLA2TOOLS.url]: jarBody }, asked), java, pinned, tlapm: ownTlapm });
  assert.equal(said.ok, true, said.message);
  assert.deepEqual(asked, [TLA2TOOLS.url], 'TLAPS is not asked for');
  assert.equal(existsSync(tlapsFolder(home)), false);
  assert.match(said.message, /It runs on Java 21\.0\.2\. TLAPS has a build only for Apple-silicon Macs, so hobkin did not install it on this Mac\.$/);
  assert.doesNotMatch(said.message, /\n/);
});

test('the pinned TLAPS is the 1.6.0-pre Apple-silicon tarball, with the sha256 GitHub lists for it', () => {
  assert.equal(TLAPS.version, '1.6.0-pre');
  assert.deepEqual(Object.keys(TLAPS.builds), ['arm64']);
  assert.equal(TLAPS.builds.arm64.url, 'https://github.com/tlaplus/tlapm/releases/download/1.6.0-pre/tlapm-1.6.0-pre-arm64-darwin.tar.gz');
  assert.equal(TLAPS.builds.arm64.sha256, '1e8cc2fa6be352528d52611e1b77ad004e6ccd7f1264b119df17599179601e26');
});

test('the pinned Java runtime is a Temurin JRE build for each Mac chip, with its sha256', () => {
  assert.equal(JAVA_RUNTIME.major, 21);
  for (const arch of ['arm64', 'x64']) {
    const build = JAVA_RUNTIME.builds[arch];
    assert.match(build.url, /^https:\/\/github\.com\/adoptium\/temurin21-binaries\/releases\/download\/jdk-21\.0\.13\.1%2B2\/OpenJDK21U-jre_(aarch64|x64)_mac_hotspot_21\.0\.13\.1_2\.tar\.gz$/);
    assert.match(build.sha256, /^[0-9a-f]{64}$/);
  }
});
