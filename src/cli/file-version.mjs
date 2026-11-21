import { lstatSync } from 'node:fs';

/**
 * A file's version: its device, inode, size and change times. Any write to it, from this process or another, gives a new one, and so does
 * a file put in its place. Null when nothing, or no regular file, is there.
 */
export function fileVersion(file) {
  const stat = lstatSync(file, { throwIfNoEntry: false, bigint: true });
  return stat?.isFile() ? `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}` : null;
}

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
    // JSON can name a key `__proto__`, which an assignment would take as the copy's prototype.
    if (key === '__proto__') Object.defineProperty(copy, key, { value: copyJson(value[key]), enumerable: true, writable: true, configurable: true });
    else copy[key] = copyJson(value[key]);
  }
  return copy;
}

/**
 * What `read()` makes of `file`, worked out again only when the file's version changes, frozen, since every caller gets the same value.
 * A read that a write overlapped is used once and not kept, so the next call reads again. `kept` is the caller's Map, of at most `most` files.
 */
export function readVersioned(kept, file, read, most = 256) {
  const version = fileVersion(file);
  const known = kept.get(file);
  if (known && known.version === version) return known.value;
  const value = deepFreeze(read());
  kept.delete(file);
  if (version === fileVersion(file)) {
    kept.set(file, { version, value });
    if (kept.size > most) kept.delete(kept.keys().next().value);
  }
  return value;
}
