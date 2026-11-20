import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { findJava, jarPath, TLA2TOOLS } from './tools.mjs';

const digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');

/** The pinned checksums the bytes must have: the published sha1, and the sha256 once one is pinned. */
const matches = (bytes, pinned) => digest('sha1', bytes) === pinned.sha1 && (!pinned.sha256 || digest('sha256', bytes) === pinned.sha256);

const checked = pinned => (pinned.sha256 ? 'sha1 and sha256' : 'sha1');

/**
 * `hobkin proof setup`, and the YOLO page's button: downloads the pinned tla2tools.jar into `<home>/tools/tla/` and keeps
 * it only when its checksum matches. It runs only when the user asks, and without Java it downloads nothing. The answer
 * is one line.
 */
export async function setupProof({ home, fetch = globalThis.fetch, java = findJava, pinned = TLA2TOOLS } = {}) {
  const found = await java();
  if (!found.path) return { ok: false, message: `${found.problem} hobkin downloaded nothing.` };

  const jar = jarPath(home);
  if (existsSync(jar) && matches(readFileSync(jar), pinned)) {
    return { ok: true, path: jar, message: `TLC ${pinned.version} is already in ${jar}, on Java ${found.version}.` };
  }

  let bytes;
  try {
    const response = await fetch(pinned.url);
    if (!response.ok) return { ok: false, message: `The download of TLC ${pinned.version} failed with HTTP ${response.status}. hobkin kept nothing.` };
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    return { ok: false, message: `The download of TLC ${pinned.version} failed: ${error.message}. hobkin kept nothing.` };
  }
  if (!matches(bytes, pinned)) {
    return { ok: false, message: `The download did not match TLC ${pinned.version}'s pinned ${checked(pinned)}, so hobkin kept nothing.` };
  }

  mkdirSync(dirname(jar), { recursive: true });
  const partial = `${jar}.part`;
  try {
    writeFileSync(partial, bytes);
    renameSync(partial, jar);
  } finally {
    rmSync(partial, { force: true });
  }
  return { ok: true, path: jar, message: `Downloaded TLC ${pinned.version} into ${jar} and checked its ${checked(pinned)}. It runs on Java ${found.version}.` };
}
