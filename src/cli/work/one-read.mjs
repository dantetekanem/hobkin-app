/**
 * One look at work mode, such as `workStatus`, reads each file it shares once. Inside `oneRead`, `readOnce` keeps what it read under a key for the
 * rest of that call; outside one it reads every time, as before. A look is synchronous, so nothing in this process writes while it runs.
 */
let held = null;

/**
 * Runs `look` with each `readOnce` key read at most once. A look inside another one shares the outer one's reads. `kept`, a Map a caller
 * holds, carries what one look read into a later one, which the caller gives only while nothing those reads saw has changed.
 */
export function oneRead(look, kept = null) {
  if (held) return look();
  held = kept ?? new Map();
  try {
    return look();
  } finally {
    held = null;
  }
}

/** What `read` gives, read once in the current look, or read now when there is none. */
export function readOnce(key, read) {
  if (!held) return read();
  if (!held.has(key)) held.set(key, read());
  return held.get(key);
}

/** A write made during a look: what the look kept under `key` is read again the next time it is asked for. */
export function forgetRead(key) {
  held?.delete(key);
}
