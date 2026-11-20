import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { findJava, jarPath, JAVA_RUNTIME, javaFolder, TLA2TOOLS } from './tools.mjs';

const digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');

/** The pinned checksums the bytes must have: the published sha1, and the sha256 once one is pinned. */
const matches = (bytes, pinned) => digest('sha1', bytes) === pinned.sha1 && (!pinned.sha256 || digest('sha256', bytes) === pinned.sha256);

const checked = pinned => (pinned.sha256 ? 'sha1 and sha256' : 'sha1');

// The runtime is about 45 MB.
const UNPACK_MS = 5 * 60_000;
const run = promisify(execFile);
const untar = (archive, into) => run('tar', ['-xzf', archive, '-C', into], { timeout: UNPACK_MS });

/** The bytes at `url`, or why there are none, in a line. */
async function download(fetch, url, what) {
  try {
    const response = await fetch(url);
    if (!response.ok) return { problem: `The download of ${what} failed with HTTP ${response.status}.` };
    return { bytes: Buffer.from(await response.arrayBuffer()) };
  } catch (error) {
    return { problem: `The download of ${what} failed: ${error.message}.` };
  }
}

/**
 * The pinned Java runtime for this Mac's chip, unpacked into `<home>/tools/java` once its sha256 matches. The archive's
 * one folder is unpacked beside it first and moved into place whole, so a half-unpacked Java is never found.
 */
async function installJava({ home, fetch, unpack, platform, arch, runtime }) {
  const build = platform === 'darwin' ? runtime.builds[arch] : null;
  if (!build) return { problem: 'hobkin installs Java only on a Mac.' };
  const what = `Java ${runtime.version}`;
  const got = await download(fetch, build.url, what);
  if (got.problem) return got;
  if (digest('sha256', got.bytes) !== build.sha256) return { problem: `The download did not match ${what}'s pinned sha256.` };

  const tools = dirname(javaFolder(home));
  mkdirSync(tools, { recursive: true });
  const work = mkdtempSync(join(tools, '.java-'));
  try {
    const archive = join(work, 'java.tar.gz');
    writeFileSync(archive, got.bytes);
    const into = join(work, 'unpacked');
    mkdirSync(into);
    await unpack(archive, into);
    const [top, ...more] = readdirSync(into).filter(name => !name.startsWith('.'));
    if (!top || more.length) return { problem: `${what}'s archive did not hold the one folder it should.` };
    rmSync(javaFolder(home), { recursive: true, force: true });
    renameSync(join(into, top), javaFolder(home));
  } catch (error) {
    return { problem: `Unpacking ${what} failed: ${error.message}.` };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return { installed: what };
}

/**
 * `hobkin proof setup`, the first-run setup and the YOLO page's button: installs what a model check needs into hobkin's
 * home and keeps each only when its pinned checksum matches. On a Mac with no Java 11 or newer it installs the pinned Java
 * runtime into `<home>/tools/java`, then the pinned tla2tools.jar into `<home>/tools/tla/`. What is already there is kept.
 * The answer is one line.
 */
export async function setupProof({
  home,
  fetch = globalThis.fetch,
  java = findJava,
  unpack = untar,
  platform = process.platform,
  arch = process.arch,
  javaRuntime = JAVA_RUNTIME,
  pinned = TLA2TOOLS,
} = {}) {
  let found = await java({ home });
  let installed = null;
  if (!found.path) {
    const javaSaid = await installJava({ home, fetch, unpack, platform, arch, runtime: javaRuntime });
    if (javaSaid.problem) return { ok: false, message: `${found.problem} ${javaSaid.problem} hobkin kept nothing.` };
    installed = javaSaid.installed;
    found = await java({ home });
    if (!found.path) return { ok: false, message: `${installed} was installed into ${javaFolder(home)} but does not run: ${found.problem}` };
  }

  const jar = jarPath(home);
  const javaWords = installed ? `Installed ${installed} into ${javaFolder(home)}` : '';
  if (existsSync(jar) && matches(readFileSync(jar), pinned)) {
    const already = `TLC ${pinned.version} is already in ${jar}`;
    return { ok: true, path: jar, message: installed ? `${javaWords}, and ${already}.` : `${already}, on Java ${found.version}.` };
  }

  const got = await download(fetch, pinned.url, `TLC ${pinned.version}`);
  const before = installed ? `${javaWords}. ` : '';
  if (got.problem) return { ok: false, message: `${before}${got.problem} hobkin kept no TLC.` };
  if (!matches(got.bytes, pinned)) {
    return { ok: false, message: `${before}The download did not match TLC ${pinned.version}'s pinned ${checked(pinned)}, so hobkin kept no TLC.` };
  }

  mkdirSync(dirname(jar), { recursive: true });
  const partial = `${jar}.part`;
  try {
    writeFileSync(partial, got.bytes);
    renameSync(partial, jar);
  } finally {
    rmSync(partial, { force: true });
  }
  if (installed) return { ok: true, path: jar, message: `${javaWords} and TLC ${pinned.version} into ${jar}, each checked by its pinned checksum.` };
  return { ok: true, path: jar, message: `Downloaded TLC ${pinned.version} into ${jar} and checked its ${checked(pinned)}. It runs on Java ${found.version}.` };
}
