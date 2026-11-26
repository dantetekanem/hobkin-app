import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inventoryLegacy, verifyInventory } from '../src/cli/migration/inventory.mjs';
import { MigrationJournal } from '../src/cli/migration/journal.mjs';
import { validateOwnership } from '../src/cli/migration/ownership.mjs';
import { pinSession, inspectCheckpoint, importSessions } from '../src/cli/migration/adoption.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'hobkin-adopt-'));
  const home = join(directory, 'old');
  const root = join(directory, 'new');
  const legacy = join(home, '.pi/agent/hobkin');
  mkdirSync(legacy, { recursive: true });
  const sessionFile = join(home, 'selected.jsonl');
  const sessionId = '784bb2a9-7469-498d-b230-7711b266b889';
  writeFileSync(sessionFile, JSON.stringify({ type: 'session', version: 3, id: sessionId, cwd: home, timestamp: '2026-10-26T00:00:00Z' }) + '\n');
  const selection = { sessionId, sessionFile };
  const opened = [];
  t.after(async () => {
    for (const item of opened.reverse()) await item.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    home, root, legacy, selection, opened,
    async stage() {
      const manifest = inventoryLegacy({ home, references: [{ kind: 'pi-session', path: sessionFile }] });
      const journal = await MigrationJournal.open(root, manifest, { selection });
      opened.push(journal);
      await journal.stage();
      const quiescence = {
        kind: 'host-shutdown',
        fingerprint: manifest.fingerprint,
        receiptId: 'synthetic-shutdown',
        observedAt: new Date().toISOString(),
        sessions: [{ ...selection, state: 'stopped' }],
      };
      return { manifest, journal, quiescence };
    },
  };
}

test('absent Durable and two exact sessions import privately without changing identities or merging history', async t => {
  const h = fixture(t), second = join(h.home, 'second.jsonl');
  writeFileSync(second, JSON.stringify({ type: 'session', version: 3, id: 'second', cwd: h.home }) + '\n' + JSON.stringify({ type: 'message', id: 'same-local-id', message: { role: 'user', content: 'Keep this history.' } }) + '\n');
  const { manifest, journal, quiescence } = await h.stage();
  quiescence.sessions.push({ sessionId: 'second', sessionFile: second, state: 'stopped' });
  assert.equal(await inspectCheckpoint(journal), null);
  const ownership = validateOwnership({ manifest, selection: h.selection, quiescence });
  const sessions = [pinSession(h.selection.sessionFile), pinSession(second)];
  const result = importSessions(journal, { ownership, sessions });
  assert.equal(result.sessions.length, 2);
  assert.equal(result.main.sessionId, h.selection.sessionId);
  assert.equal(result.main.path, 'sessions/main.jsonl');
  for (const session of result.sessions) {
    assert.deepEqual(readFileSync(journal.dataPath(session.path)), readFileSync(session.sessionFile));
    assert.equal(statSync(journal.dataPath(session.path)).mode & 0o777, 0o600);
  }
  assert.deepEqual(importSessions(journal, { ownership, sessions }), result);
  assert.equal(verifyInventory(manifest), true);
  writeFileSync(second, readFileSync(second, 'utf8') + '{"type":"message","message":{"role":"user","content":"Changed"}}\n');
  assert.throws(() => importSessions(journal, { ownership, sessions }), /changed|pin/);
});

test('all mapped origins and exact selected hashes are required; malformed session entries never disappear silently', async t => {
  const h = fixture(t), { manifest, journal, quiescence } = await h.stage();
  const ownership = validateOwnership({ manifest, selection: h.selection, quiescence }), pinned = pinSession(h.selection.sessionFile);
  assert.throws(() => importSessions(journal, { ownership, sessions: [] }), /mapped|session/);
  assert.throws(() => importSessions(journal, { ownership, sessions: [{ ...pinned, sessionId: 'wrong' }] }), /identity|pin|mapped/);
  writeFileSync(h.selection.sessionFile, readFileSync(h.selection.sessionFile, 'utf8') + '{"secret":"private malformed');
  assert.throws(() => pinSession(h.selection.sessionFile), error => /entry|invalid/.test(error.message) && !/private|secret/.test(error.message));
});
