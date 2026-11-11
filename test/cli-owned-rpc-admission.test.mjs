import assert from 'node:assert/strict';
import { after, mock, test } from 'node:test';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import childProcess from 'node:child_process';

const refuse = () => { throw Error('Live SDK/process/network execution forbidden'); };
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  mock.method(childProcess, name, refuse);
}
mock.method(globalThis, 'fetch', refuse);
syncBuiltinESMExports();
const hooks = registerHooks({
  resolve(specifier, context, next) {
    let source;
    if (specifier === '@earendil-works/pi-coding-agent') source = 'export const defineTool = value => value;';
    else if (specifier === '@earendil-works/pi-ai') {
      source = 'export const clampThinkingLevel = () => {}; export const getSupportedThinkingLevels = clampThinkingLevel;';
    } else if (specifier.endsWith('/rpc-process.mjs')) {
      source = 'export const startRpcProcess = () => { throw Error("Live RPC process forbidden"); };';
    } else if (specifier.startsWith('@earendil-works/')) {
      throw Error(`Forbidden dependency: ${specifier}`);
    }
    return source ? { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true } : next(specifier, context);
  },
});
after(() => {
  hooks.deregister();
  mock.restoreAll();
  syncBuiltinESMExports();
});
const { PiRpcSession } = await import('../src/cli/rpc-session.mjs');
const { BRIDGE } = await import('../src/cli/bridge.mjs');

test('started and queued RPC responses admit their first same-chunk helper request', { timeout: 10000 }, async () => {
  for (const disposition of ['started', 'queued']) {
    const session = new PiRpcSession({});
    const publications = [];
    const replies = [];
    const calls = [];
    let admitted = false;
    const answered = Promise.withResolvers();
    session.tools = {
      owned_agent: {
        execute: async (_id, request) => {
          if (!admitted) throw Error('No active admitted owned turn');
          calls.push(request);
          return { details: ['helper'] };
        },
      },
    };
    session.child = {
      request(type, _data, onResponse) {
        if (type === 'prompt') {
          onResponse({ disposition });
          session.accept({
            type: 'extension_ui_request',
            id: 'bridge-1',
            method: 'input',
            title: BRIDGE,
            placeholder: JSON.stringify({ op: 'tool', name: 'owned_agent', id: 'call-1', params: { action: 'list' } }),
          });
          session.accept({ type: 'agent_settled' });
          return Promise.resolve();
        }
        if (type === 'get_state') return Promise.resolve({ sessionId: 'fake-main', isStreaming: false });
        if (type === 'get_messages') return Promise.resolve({ messages: [] });
        if (type === 'get_session_stats') return Promise.resolve({});
        throw Error(`Unexpected fake RPC request: ${type}`);
      },
      send(reply) {
        replies.push(reply);
        answered.resolve();
      },
    };

    await session.prompt('parent turn', {
      preflightResult: result => {
        publications.push(result);
        admitted = result !== false;
      },
    });
    await answered.promise;

    assert.deepEqual(publications, [disposition]);
    assert.deepEqual(calls, [{ action: 'list' }]);
    assert.equal(JSON.parse(replies[0].value).ok, true);
  }
});

test('handled and rejected prompt responses publish preflight exactly once', { timeout: 10000 }, async () => {
  const handled = new PiRpcSession({});
  const handledResults = [];
  handled.child = {
    request: (_type, _data, onResponse) => {
      onResponse({ disposition: 'handled' });
      return Promise.resolve();
    },
  };
  await handled.prompt('handled command', { preflightResult: result => handledResults.push(result) });
  assert.deepEqual(handledResults, ['handled']);

  const rejected = new PiRpcSession({});
  const rejectedResults = [];
  const error = Object.assign(Error('prompt refused'), { commandRejected: true });
  rejected.child = { request: () => Promise.reject(error) };
  await assert.rejects(
    rejected.prompt('refused command', { preflightResult: result => rejectedResults.push(result) }),
    /prompt refused/,
  );
  assert.deepEqual(rejectedResults, [false]);
});
