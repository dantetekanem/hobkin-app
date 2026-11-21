/**
 * One look at work mode, such as `workStatus`, reads each file it shares once. Inside `oneRead`, `readOnce` keeps what it read under a key for the
 * rest of that call; outside one it reads every time, as before. A look is synchronous, so nothing in this process writes while it runs.
 */
let held = null;

/** Runs `look` with each `readOnce` key read at most once. A look inside another one shares the outer one's reads. */
export function oneRead(look) {
  if (held) return look();
  held = new Map();
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
