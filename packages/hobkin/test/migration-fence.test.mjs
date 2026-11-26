import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LegacyOwner, installLegacyFence, legacyIsFenced, collectShutdownReceipt } from '../src/cli/migration/fence.mjs';

const identity = { sessionId: 'synthetic-owner', sessionFile: '/synthetic/owner.jsonl' };
const migration = { id: 'migration-fixture', fingerprint: 'f'.repeat(64), destination: '/synthetic/new-home', owners: [identity] };
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'hobkin-fence-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, 'legacy'), controlRoot = join(directory, 'control');
  mkdirSync(root);
  return { root, controlRoot };
}

test('distinct owners can start and drain concurrently without weakening session exclusivity', async t => {
  const { root, controlRoot } = fixture(t);
  const identities = [identity, { sessionId: 'second-owner', sessionFile: '/synthetic/second.jsonl' }];
  const opened = await Promise.allSettled(identities.map(item => LegacyOwner.open(root, item, { controlRoot })));
  const owners = opened.filter(result => result.status === 'fulfilled').map(result => result.value);
  t.after(async () => {
    for (const owner of owners) await owner.close(async () => {});
  });
  assert.equal(owners.length, 2, 'both distinct sessions acquire their own owner');
  await assert.rejects(LegacyOwner.open(root, identity, { controlRoot }), { code: 'ELOCKED' });
  const fenced = { ...migration, owners: identities };
  await installLegacyFence(root, fenced, { controlRoot });
  await Promise.all(owners.map(owner => owner.close(async () => {})));
  const receipt = await collectShutdownReceipt(root, fenced, { controlRoot });
  assert.deepEqual(receipt.sessions.map(item => item.sessionId), identities.map(item => item.sessionId));
  assert.ok(receipt.sessions.every(item => item.basis === 'extension-shutdown'));
});

test('a fence blocks new owners and a running owner cannot masquerade as a shutdown receipt', async t => {
  const { root, controlRoot } = fixture(t);
  const owner = await LegacyOwner.open(root, identity, { controlRoot });
  t.after(() => owner.close(async () => {}));
  assert.equal(legacyIsFenced(root, controlRoot), false);
  await installLegacyFence(root, migration, { controlRoot });
  assert.equal(legacyIsFenced(root, controlRoot), true);
  await assert.rejects(LegacyOwner.open(root, { ...identity, sessionId: 'new-owner' }, { controlRoot }), /fenced/);
  await assert.rejects(collectShutdownReceipt(root, migration, { controlRoot }), /running|shutdown/);
  let drained = false;
  await owner.close(async () => { drained = true; });
  assert.equal(drained, true);
  const receipt = await collectShutdownReceipt(root, migration, { controlRoot });
  assert.equal(receipt.kind, 'host-shutdown');
  assert.equal(receipt.sessions[0].state, 'stopped');
  assert.equal(receipt.sessions[0].basis, 'extension-shutdown');
  assert.equal((await collectShutdownReceipt(root, migration, { controlRoot })).receiptId, receipt.receiptId);
});

test('pre-protocol owners require exact explicit offline confirmation, never a pane hint', async t => {
  const { root, controlRoot } = fixture(t);
  await installLegacyFence(root, migration, { controlRoot });
  await assert.rejects(collectShutdownReceipt(root, migration, { controlRoot, offline: { pane: 'w1:p24' } }), /offline|unproven/);
  const offline = { confirmed: true, migrationId: migration.id, fingerprint: migration.fingerprint, sessions: [identity], confirmedAt: '2026-10-26T00:00:00Z' };
  const receipt = await collectShutdownReceipt(root, migration, { controlRoot, offline });
  assert.equal(receipt.sessions[0].basis, 'operator-attested-offline');
  assert.equal(receipt.attested, true);
  await assert.rejects(collectShutdownReceipt(root, migration, { controlRoot, offline: { ...offline, fingerprint: 'changed' } }), /offline|scope/);
  await assert.rejects(installLegacyFence(root, { ...migration, id: 'other' }, { controlRoot }), /different|conflict/);
});

test('failed draining leaves an unproven owner instead of issuing a successful receipt', async t => {
  const { root, controlRoot } = fixture(t);
  const owner = await LegacyOwner.open(root, identity, { controlRoot });
  await installLegacyFence(root, migration, { controlRoot });
  await assert.rejects(owner.close(async () => { throw Error('drain failed'); }), /drain failed/);
  await assert.rejects(collectShutdownReceipt(root, migration, { controlRoot }), /unproven|shutdown/);
});
