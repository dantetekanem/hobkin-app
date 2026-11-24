import { addMemory, changeMemory, forgetMemory, isMemoryRefusal, memoryNameFrom, readMemories, undoMemoryChange } from './memories.mjs';
import { changeMemoryList, memoryListVersion, readMemoryItems } from './memory.mjs';

/**
 * What the app's host calls for the window's Memory page (057-shared-memory), one function a command: `memory.list`,
 * `memory.save`, `memory.forget`, `memory.undo` and `memory.now.change`, in the shapes of the app's
 * `shared/protocol/memory.ts`. Every change is the user's, from the window. A refusal answers in hobkin's plain words;
 * anything else thrown is a failure.
 */

const BY_USER = { kind: 'user' };
const FROM_WINDOW = { kind: 'window' };
const message = error => (error instanceof Error ? error.message : String(error));

function refusedAs(error, wrap) {
  if (isMemoryRefusal(error)) return wrap(message(error));
  throw error;
}

function nowList(root) {
  try {
    return { now: readMemoryItems(root), nowVersion: memoryListVersion(root) };
  } catch {
    // A list that is not a bounded file is shown as none, and no change is offered on it.
    return { now: [] };
  }
}

/** `memory.list`: every memory, private ones too, with its version; the right-now list and its version; the files that are not memories. */
export function memoryList(root, { now = Date.now() } = {}) {
  const { memories, unreadable } = readMemories(root, { private: true, now });
  return { memories, ...nowList(root), unreadable };
}

/**
 * `memory.save`: with no `version` it adds a memory, named from its description when it has no name; with one it
 * changes the memory of that `name` to what the form holds, so a field left out is cleared. A version that is not the
 * file's now is refused.
 */
export function memorySave(root, save = {}, { now = Date.now() } = {}) {
  const fields = {
    description: save.description,
    text: save.text ?? '',
    kind: save.kind,
    until: save.until || null,
    private: save.private === true,
  };
  try {
    if (save.version === undefined) {
      const name = save.name || memoryNameFrom(root, save.description);
      const { memory, change } = addMemory(root, { ...fields, name }, { by: BY_USER, source: FROM_WINDOW, now });
      return { saved: true, memory, change };
    }
    if (typeof save.name !== 'string' || !save.name) return { saved: false, message: 'Say which memory to change: a change needs its name and version.' };
    // Any save by the user keeps a memory another session handed over, so every agent reads it from then on.
    const { memory, change } = changeMemory(root, save.name, fields, { by: BY_USER, now, version: save.version, keep: true });
    return { saved: true, memory, change };
  } catch (error) {
    return refusedAs(error, words => ({ saved: false, message: words }));
  }
}

/** `memory.forget`: moves it aside for 30 days and answers the change's id, which `memory.undo` takes. */
export function memoryForget(root, { name, version } = {}, { now = Date.now() } = {}) {
  try {
    return { forgot: true, change: forgetMemory(root, name, { by: BY_USER, now, version }).change };
  } catch (error) {
    return refusedAs(error, words => ({ forgot: false, message: words }));
  }
}

/** `memory.undo`: takes back one change by its id, from a save, a forget or a chat line. */
export function memoryUndo(root, { change } = {}, { now = Date.now() } = {}) {
  try {
    undoMemoryChange(root, change, { by: BY_USER, now });
    return { ok: true };
  } catch (error) {
    return refusedAs(error, reason => ({ ok: false, reason }));
  }
}

/**
 * `memory.now.change`: one change to the right-now list by the main chat's own rules for it, refused when the list
 * changed since `version`. It answers the list after it and its new version.
 */
export function memoryNowChange(root, { action, item, text, version } = {}) {
  let before;
  try {
    before = memoryListVersion(root);
  } catch (error) {
    return { ok: false, reason: message(error) };
  }
  if (version !== before) return { ok: false, reason: 'Nothing was changed: the list changed since you opened it. Read it again and make your change there.' };
  try {
    const request = { action, ...(item === undefined ? {} : { item }), ...(text === undefined ? {} : { text }) };
    const now = changeMemoryList(root, request);
    return { ok: true, now, nowVersion: memoryListVersion(root) };
  } catch (error) {
    return { ok: false, reason: message(error) };
  }
}
