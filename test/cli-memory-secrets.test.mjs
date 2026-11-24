import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addMemory, memorySecretKind, readMemories, secretKind } from '../src/cli/memories.mjs';
import { memoryHandler } from '../src/cli/memory-tools.mjs';
import { remember } from '../src/cli/inbox.mjs';

// The verifier's tables (lanes/v3, r2 and r10): invented values in the shapes of real ones, none a real credential.
const FAKE_ANTHROPIC = `sk-ant-api03-${'Ab1'.repeat(30)}`;
const FAKE_GITHUB = `ghp_${'a1B2'.repeat(9)}`;
const FIRST_SECRETS = [
  `My key is ${FAKE_ANTHROPIC}`,
  `token ${FAKE_GITHUB}`,
  'AKIAABCDEFGHIJKLMNOP is the work one',
  'password: hunter2isnotreal',
  'My password is Hunter2-not-real',
  'The wifi password is blue-otter-42',
  'Bank PIN is 4821',
  'Card 4111 1111 1111 1111 expires 09/29',
  'card 4111111111111111',
  'IBAN GB82 WEST 1234 5698 7654 32',
  'account number: 12345678',
  'Checking 0012345678 at the credit union',
  'SIN 046 454 286',
  'SSN 123-45-6789',
  'passport number X1234567',
  'Passport is X1234567, expires 2030',
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMTIzNDU2In0.c2lnbmF0dXJlMTIzNDU2Nzg5',
  '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----',
  'https://sam:hunter2@example.invalid/path',
  '0123456789abcdef0123456789abcdef',
  'Recovery codes: 8f3k-29dk-1kd9 4kd8-2kd9-1kfj',
  'Seed words: abandon ability able about above absent absorb abstract absurd abuse access accident',
  'Door code is 1234#',
];
const MORE_SECRETS = [
  'Use hunter2isnotreal as the password',
  'Log in with "Blue-Otter-42"',
  'The router admin login: admin / Blue-Otter-42',
  'Home wifi is called Otter. Its password is Blue-Otter-42.',
  'wifi pw: Blue-Otter-42',
  'Password Blue-Otter-42',
  'The password for the NAS is the word "tangerine" twice',
  'PIN 4 8 2 1',
  'Bank PIN 4-8-2-1',
  'The PIN for the card is four eight two one',
  'The gate opens with 1234#',
  'Alarm: 5521',
  'SIN 046-454-286',
  'SIN is 046454286',
  'Social insurance 046 454 286',
  'ssn 123 45 6789',
  'Passport X 123 4567',
  'Card 4111-1111-1111-1111 exp 09/29 cvv 123',
  'Visa 4111 1111 1111 1111',
  'CVV is 123',
  'Security answer: mother’s maiden name is Silva',
  'Account 0012345678, transit 00123, institution 003',
  'Chequing 12345-003-1234567',
  'Recovery codes 8f3k-29dk 4kd8-2kd9',
  'Backup codes: 12345678 87654321 11223344',
  '2FA backup code 1234 5678',
  'Seed: abandon ability able about above absent absorb abstract absurd abuse access accident',
  'Mnemonic words abandon ability able about above absent absorb abstract absurd abuse access accident',
  'Driver’s licence P1234-56789-01234',
  'OHIP 1234-567-890-AB',
  'The safe combination is 12-34-56',
  'Lock combo 1234',
  'API key for the weather site: abcd1234efgh5678ijkl9012mnop3456',
];
const REASONABLE = [
  'The wifi password is in the password manager',
  'The wifi password is kept in 1Password under Home',
  'There is a password for the router; it is on the sticker under it',
  'The gate code is with the concierge',
  'The door code changes every month; ask the landlord',
  'Their PIN was reset at the branch last week',
  'Passwords must be at least 12 characters at work',
  'The password is 16 characters long',
  'Phone is +1 416 555 0134',
  'Mobile 416-555-0134',
  'Postal code is M5V 2T6',
  'Lives at 221 Baker Street, apartment 4B',
  'Born 1990-04-02',
  'Passport expires 2027-03-10',
  'Order 4111111111111111 shipped on Monday',
  'Amazon order 112-4455667-8899001 arrives Friday',
  'Flight AC 857 leaves at 18:40 on Dec 3',
  'Booking reference QX7K2P for the hotel',
  'Licence plate is CBXR 482',
  'Car licence plate ABC-1234',
  'The licence renewal is due 2027-05-01',
  'Health card renews in 2028',
  'Account at RBC, the branch on Queen Street',
  'Card ending 4242 is the travel card',
  'Tracking number 1Z999AA10123456784',
  'Their SIN card is in the safe',
  'Seat 14A on the train',
  'The account number is in the bank app',
  'Has a passport from Portugal and one from Canada',
  'Gym locker 214',
  'Room 1204 at the Marriott',
  'Lives in Lisbon since 2025',
  'Phone is +351 912 345 678',
  'Passwords are in 1Password',
  'The alarm code changes every January',
];

const NOW = Date.parse('2026-11-23T14:00:00Z');
function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-memory-secrets-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('every secret of both tables is refused, and every reasonable sentence is kept', () => {
  const letIn = [...FIRST_SECRETS, ...MORE_SECRETS].filter(words => !secretKind(words));
  assert.deepEqual(letIn, [], 'let in');
  const refused = REASONABLE.filter(words => secretKind(words)).map(words => `${words} (${secretKind(words)})`);
  assert.deepEqual(refused, [], 'refused');
  assert.equal(FIRST_SECRETS.length + MORE_SECRETS.length, 56);
});

test('a memory is judged as one text, its name with hyphens read as spaces, so a secret split over two fields is one', () => {
  const judged = fields => memorySecretKind(fields);
  assert.equal(judged({ name: 'bank-pin-4821', description: 'Bank card details' }), 'a PIN');
  assert.equal(judged({ name: 'wifi-password-is-blue-otter-42', description: 'Home wifi' }), 'a password');
  assert.equal(judged({ name: 'bank-card', description: 'Bank card PIN:', text: '4821' }), 'a PIN');
  assert.equal(judged({ name: 'home-wifi', description: 'The home wifi password', text: 'Blue-Otter-42' }), 'a password');
  assert.equal(judged({ name: 'home-wifi', description: 'Wifi password', text: 'The router is a TP-Link AX55 in the hall.' }), null, 'a field that goes on to something else is not a value');
  assert.equal(judged({ name: 'wifi-password-location', description: 'The wifi password is in the password manager' }), null);
});

test('every door refuses a split or reworded secret, and says what it looked like and what to keep instead', t => {
  const root = home(t);
  const main = memoryHandler(root, { kind: 'main' }, { now: () => NOW });
  const doors = [
    () => main.remember({ action: 'add', name: 'bank-pin-4821', kind: 'user', description: 'Bank card details' }),
    () => main.remember({ action: 'add', name: 'wifi-password-is-blue-otter-42', kind: 'pointer', description: 'Home wifi' }),
    () => main.remember({ action: 'add', name: 'bank-card', kind: 'pointer', description: 'Bank card PIN:', text: '4821' }),
    () => remember(root, { words: ['For the NAS use tangerine-tangerine as the password'], from: 'Claude Code' }, NOW, { env: {} }),
    () => remember(root, { words: ['The NAS is in the hall. Login is admin and Blue-Otter-42.'], from: 'Claude Code' }, NOW, { env: {} }),
    () => addMemory(root, { name: 'nas', kind: 'pointer', description: 'The NAS', text: 'The NAS is in the hall. Login is admin and Blue-Otter-42.' }, { by: { kind: 'user' } }),
  ];
  for (const door of doors) {
    assert.throws(door, error => {
      assert.match(error.message, /it looks like (a|an) [^,]+, a secret hobkin never keeps/);
      assert.match(error.message, /Keep only that it exists and where it is kept, such as "[^"]+"/);
      return true;
    });
  }
  assert.deepEqual(readMemories(root).memories, []);
});
