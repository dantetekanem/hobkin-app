import { lstatSync } from 'node:fs';

/**
 * A file's version: its device, inode, size and change times. Any write to it, from this process or another, gives a new one, and so does
 * a file put in its place. Null when nothing, or no regular file, is there.
 */
export function fileVersion(file) {
  const stat = lstatSync(file, { throwIfNoEntry: false, bigint: true });
  const version = stat?.isFile() ? `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}` : null;
  if (recorded && !recorded.has(file)) recorded.set(file, version);
  return version;
}

let recorded = null;

/** What `look` gives, with the version of every file it looked at through `fileVersion`, as it first saw each. */
export function withVersions(look) {
  if (recorded) return { value: look(), versions: recorded };
  recorded = new Map();
  const versions = recorded;
  try {
    return { value: look(), versions };
  } finally {
    recorded = null;
  }
}

/** Whether every file in `versions` still has the version it had. */
export const unchangedSince = versions => [...versions].every(([file, version]) => fileVersion(file) === version);

/** Freezes `value` and everything in it, so a value kept for every caller cannot be changed by one of them. */
export function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const part of Object.values(value)) deepFreeze(part);
  return value;
}

/** A copy of a JSON value of its own, for a caller that may change it. Several times cheaper than parsing the text again. */
export function copyJson(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(copyJson);
  const copy = {};
  for (const key of Object.keys(value)) {
    const part = copyJson(value[key]);
    // JSON can name a key `__proto__`, which an assignment would take as the copy's prototype.
    if (key === '__proto__') {
      Object.defineProperty(copy, key, { value: part, enumerable: true, writable: true, configurable: true });
    } else {
      copy[key] = part;
    }
  }
  return copy;
}

/**
 * What `read()` makes of `file`, worked out again only when the file's version changes, frozen, since every caller gets the same value.
 * A read that a write overlapped is used once and not kept, so the next call reads again. So is a read of something that is there but is
 * no regular file, such as a symlink, whose version cannot be told. `kept` is the caller's Map, of at most `most` files.
 */
export function readVersioned(kept, file, read, most = 256) {
  const version = fileVersion(file);
  if (version === null && lstatSync(file, { throwIfNoEntry: false })) {
    kept.delete(file);
    return deepFreeze(read());
  }
  const known = kept.get(file);
  if (known && known.version === version) return known.value;

  const value = deepFreeze(read());
  kept.delete(file);
  const unchangedWhileRead = version === fileVersion(file);
  if (unchangedWhileRead) {
    kept.set(file, { version, value });
    if (kept.size > most) kept.delete(kept.keys().next().value);
  }
  return value;
}
