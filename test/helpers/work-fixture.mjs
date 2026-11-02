import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

export const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

/** A real repository on `main` with one commit, as a person would have it. */
export function repository(base, name) {
  const checkout = join(base, name);
  execFileSync('git', ['init', '-q', '-b', 'main', checkout]);
  git(checkout, 'config', 'user.email', 'test@example.com');
  git(checkout, 'config', 'user.name', 'Test');
  writeFileSync(join(checkout, 'app.txt'), 'one\n');
  git(checkout, 'add', '.');
  git(checkout, 'commit', '-qm', 'first');
  return checkout;
}

export function commit(checkout, file, text) {
  writeFileSync(join(checkout, file), text);
  git(checkout, 'add', '.');
  git(checkout, 'commit', '-qm', text.trim());
}

/** A branch with one commit of its own, with the checkout back on `main`. */
export function branched(checkout, name, file = `${name.replaceAll('/', '-')}.txt`, text = `${name}\n`) {
  git(checkout, 'switch', '-qc', name);
  commit(checkout, file, text);
  git(checkout, 'switch', '-q', 'main');
}

/** An open PR on its own hobkin head, as `gh pr list` gives it. */
export const pull = (number, details = {}) => ({
  number,
  title: `PR ${number}`,
  url: `https://example.com/pull/${number}`,
  state: 'OPEN',
  isDraft: false,
  createdAt: '2026-05-20T00:00:00Z',
  mergedAt: null,
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  reviewDecision: 'REVIEW_REQUIRED',
  statusCheckRollup: [{ conclusion: 'SUCCESS' }],
  mergeable: 'MERGEABLE',
  headRefName: `hobkin/${number}-fix`,
  ...details,
});

/** A local bare repository as `origin`, with `main` pushed and `origin/HEAD` known, as a clone would have it. */
export function withOrigin(base, checkout, name = 'origin.git') {
  const origin = join(base, name);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  git(checkout, 'remote', 'add', 'origin', origin);
  git(checkout, 'push', '-q', '-u', 'origin', 'main');
  git(checkout, 'remote', 'set-head', 'origin', 'main');
  return origin;
}
