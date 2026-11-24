import { pull } from './work-fixture.mjs';

export const NOW = Date.parse('2026-06-01T12:00:00Z');
export const MERGE_COMMIT = 'f'.repeat(40);
export const USER = 'the-user';

/**
 * The code host as a test plays it, for one pull request of hobkin's own: what the survey lists, what a fresh read of it says, its required
 * checks, the signed-in user, and a merge that records how it was asked for. Nothing reaches a real host.
 */
export function codeHost({ number, branch, head }) {
  const url = `https://github.invalid/the-user/api/pull/${number}`;
  const host = {
    url,
    calls: [],
    merged: false,
    login: USER,
    view: {
      url,
      state: 'OPEN',
      isDraft: false,
      author: { login: USER },
      headRefName: branch,
      headRefOid: head,
      baseRefName: 'main',
      isCrossRepository: false,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      reviewDecision: '',
      statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    },
    required: [{ name: 'test', bucket: 'pass' }],
    checksError: null,
    mergeError: null,
    // A merge call that ends well and leaves the pull request open with auto-merge on, as gh does on a branch that asks for a merge queue.
    queues: false,
    undoError: null,
    // The checks the default branch requires, by its protection and by its rulesets, or null when the host will not say.
    protection: ['test'],
    rules: [],
    // Whether the default branch merges through a queue, by a ruleset or as the pull request itself says, and whether that can be read.
    queueRule: false,
    mergeQueue: false,
    graphqlError: false,
    // Required checks pinned to an app, as `{ context, app_id }`, and the check runs at the head each app reported, by name.
    pinned: [],
    checkRuns: {},
  };
  host.gh = async args => {
    host.calls.push(args);
    const [group, verb] = args;
    if (group === 'api' && verb === 'user') return `${host.login}\n`;
    if (group === 'api' && args.includes('graphql')) {
      if (host.graphqlError) throw Object.assign(Error('failed'), { stderr: 'GraphQL: Field isMergeQueueEnabled does not exist' });
      return JSON.stringify({ data: { repository: { pullRequest: { isMergeQueueEnabled: host.mergeQueue, isInMergeQueue: false } } } });
    }
    if (group === 'api' && args.at(-1) === 'repos/the-user/api/branches/main') {
      if (!host.protection) throw Object.assign(Error('failed'), { stderr: 'HTTP 403: Resource not accessible' });
      return JSON.stringify({ name: 'main', protected: true, protection: { required_status_checks: { contexts: host.protection, checks: host.pinned } } });
    }
    if (group === 'api' && args.at(-1) === 'repos/the-user/api/rules/branches/main') {
      if (!host.rules) throw Object.assign(Error('failed'), { stderr: 'HTTP 403: Resource not accessible' });
      const required = host.rules.length ? [{ type: 'required_status_checks', parameters: { required_status_checks: host.rules.map(context => ({ context })) } }] : [];
      const rules = [...required, ...(host.queueRule ? [{ type: 'merge_queue', parameters: {} }] : [])];
      // Read with --paginate --slurp, each page an array of its own.
      return JSON.stringify(args.includes('--slurp') ? [rules] : rules);
    }
    if (group === 'api' && /\/check-runs\?check_name=/.test(args.at(-1))) {
      const name = decodeURIComponent(args.at(-1).split('check_name=')[1].split('&')[0]);
      return JSON.stringify([{ total_count: 0, check_runs: host.checkRuns[name] ?? [] }]);
    }
    if (group === 'pr' && verb === 'list') {
      const { headRefOid, isDraft, reviewDecision, statusCheckRollup, mergeable } = host.view;
      const merged = host.merged ? { state: 'MERGED', mergedAt: new Date(NOW).toISOString(), mergeCommit: { oid: MERGE_COMMIT } } : {};
      return JSON.stringify([pull(number, { url, headRefName: branch, headRefOid, isDraft, reviewDecision, statusCheckRollup, mergeable, ...merged })]);
    }
    if (group === 'pr' && verb === 'view') {
      // Any other address is a pull request of another repository on a branch of the same name, at the same head, and clean.
      if (args[2] !== url) return JSON.stringify({ ...host.view, url: args[2] });
      return JSON.stringify(host.merged ? { ...host.view, state: 'MERGED', mergedAt: new Date(NOW).toISOString(), mergeCommit: { oid: MERGE_COMMIT } } : host.view);
    }
    if (group === 'pr' && verb === 'checks') {
      if (host.checksError) throw host.checksError;
      return JSON.stringify(host.required);
    }
    if (group === 'pr' && verb === 'merge' && args.includes('--disable-auto')) {
      if (host.undoError) throw host.undoError;
      host.view.autoMergeRequest = null;
      return '';
    }
    if (group === 'pr' && verb === 'merge') {
      if (host.mergeError) throw host.mergeError;
      if (host.queues) {
        host.view.autoMergeRequest = { enabledAt: new Date(NOW).toISOString() };
        return '';
      }
      host.merged = true;
      // gh killed by its timeout after the host merged.
      if (host.killedAfterMerge) throw Object.assign(Error('Command failed: gh pr merge'), { killed: true, signal: 'SIGTERM', stderr: '' });
      return '';
    }
    return '[]';
  };
  host.merges = () => host.calls.filter(args => args[0] === 'pr' && args[1] === 'merge' && !args.includes('--disable-auto'));
  host.undos = () => host.calls.filter(args => args[0] === 'pr' && args[1] === 'merge' && args.includes('--disable-auto'));
  return host;
}
