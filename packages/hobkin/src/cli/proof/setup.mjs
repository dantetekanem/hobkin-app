import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { findJava, findTlapm, jarPath, JAVA_RUNTIME, javaFolder, TLA2TOOLS, TLAPS, tlapsFolder } from './tools.mjs';

const digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');

/** The pinned checksums the bytes must have: the published sha1, and the sha256 once one is pinned. */
const matches = (bytes, pinned) => digest('sha1', bytes) === pinned.sha1 && (!pinned.sha256 || digest('sha256', bytes) === pinned.sha256);

const checked = pinned => (pinned.sha256 ? 'sha1 and sha256' : 'sha1');

// The Java runtime is about 45 MB and TLAPS about 41 MB.
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
 * The archive at `build.url`, unpacked into `folder` once its sha256 matches, or `mismatch` when it does not. The archive's
 * one folder is unpacked beside it first and moved into place whole, so a half-unpacked tool is never found.
 */
async function installArchive({ fetch, unpack, build, what, folder, mismatch }) {
  const got = await download(fetch, build.url, what);
  if (got.problem) return got;
  if (digest('sha256', got.bytes) !== build.sha256) return { problem: mismatch };

  const tools = dirname(folder);
  mkdirSync(tools, { recursive: true });
  const work = mkdtempSync(join(tools, `.${basename(folder)}-`));
  try {
    const archive = join(work, 'archive.tar.gz');
    writeFileSync(archive, got.bytes);
    const into = join(work, 'unpacked');
    mkdirSync(into);
    await unpack(archive, into);
    const [top, ...more] = readdirSync(into).filter(name => !name.startsWith('.'));
    if (!top || more.length) return { problem: `${what}'s archive did not hold the one folder it should.` };
    rmSync(folder, { recursive: true, force: true });
    renameSync(join(into, top), folder);
  } catch (error) {
    return { problem: `Unpacking ${what} failed: ${error.message}.` };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return { installed: what };
}

/** The pinned Java runtime for this Mac's chip, a macOS bundle, unpacked into `<home>/tools/java`. */
async function installJava({ home, fetch, unpack, platform, arch, runtime }) {
  const build = platform === 'darwin' ? runtime.builds[arch] : null;
  if (!build) return { problem: 'hobkin installs Java only on a Mac.' };
  const what = `Java ${runtime.version}`;
  return installArchive({
    fetch,
    unpack,
    build,
    what,
    folder: javaFolder(home),
    mismatch: `The download did not match ${what}'s pinned sha256.`,
  });
}

/** Java and the pinned tla2tools.jar, which a model check needs. Not ok when either is missing. */
async function setupTlc({ home, fetch, java, unpack, platform, arch, javaRuntime, pinned }) {
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

/**
 * The line about TLAPS: the tlapm already found, or the pinned build for this Mac's chip unpacked into `<home>/tools/tlaps`,
 * or why there is none. A download that does not match is never kept, since the pre-release is rebuilt in place.
 */
async function setupTlaps({ home, fetch, unpack, platform, arch, tlaps, tlapm }) {
  const found = tlapm(home);
  if (found) return `TLAPS is already at ${found}.`;
  const onMac = platform === 'darwin';
  const build = onMac ? tlaps.builds[arch] : null;
  if (!build) return `TLAPS has a build only for Apple-silicon Macs, so hobkin did not install it ${onMac ? 'on this Mac' : 'here'}.`;

  const what = `TLAPS ${tlaps.version}`;
  const said = await installArchive({
    fetch,
    unpack,
    build,
    what,
    folder: tlapsFolder(home),
    mismatch: `The ${what} download did not match hobkin's pinned sha256, so it was damaged or changed on the way.`,
  });
  if (said.problem) return `${said.problem} hobkin kept no TLAPS.`;
  return `Installed ${what} into ${tlapsFolder(home)}, checked by its pinned sha256.`;
}

/**
 * `hobkin proof setup`, the first-run setup and the YOLO page's button: installs what a model check and a proof need into
 * hobkin's home and keeps each only when its pinned checksum matches. On a Mac with no Java 11 or newer it installs the
 * pinned Java runtime into `<home>/tools/java`, then the pinned tla2tools.jar into `<home>/tools/tla/`, then, on an
 * Apple-silicon Mac with no tlapm, the pinned TLAPS into `<home>/tools/tlaps`. What is already there is kept. It is ok
 * once a model check can run: TLAPS failing leaves Java and TLC in place and is said in the same line.
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
  tlaps = TLAPS,
  tlapm = findTlapm,
} = {}) {
  const tlc = await setupTlc({ home, fetch, java, unpack, platform, arch, javaRuntime, pinned });
  if (!tlc.ok) return tlc;
  const tlapsSaid = await setupTlaps({ home, fetch, unpack, platform, arch, tlaps, tlapm });
  return { ...tlc, message: `${tlc.message} ${tlapsSaid}` };
}
