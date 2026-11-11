import { isAbsolute } from 'node:path';
import { startRpcProcess, clean } from './rpc-process.mjs';
import { piCommand, piEnvironment } from './launcher.mjs';
import { ownedExtensionArguments } from './pi-extensions.mjs';
import { BRIDGE, serveBridge } from './bridge.mjs';
import { createOwnedAgentSessionTool } from './owned-agent-tool.mjs';

// A deadline never asserts cleanup. Unknown transports keep their result pending and occupy the tree's slot.
async function bounded(promise, ms, fallback) {
  let timer;
  try { return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); })]); }
  finally { clearTimeout(timer); }
}

/** Host-only bindings carry permissions and task content; model-visible tree identities carry neither. */
export function createOwnedAgentAdapter({ bindingFor, startProcess = startRpcProcess, onEvent = () => {}, onStats = () => {}, ownedAgent, join, onUnconfirmed = () => {}, startupMs = 10000, stopMs = 2000 } = {}) {
  for (const ms of [startupMs, stopMs]) if (!Number.isSafeInteger(ms) || ms < 1 || ms > 60000) throw Error('Invalid owned deadline');
  return { start(identity) {
    const binding = bindingFor?.(identity);
    if (!binding || !isAbsolute(binding.cwd ?? '') || typeof binding.prompt !== 'string' || !binding.prompt.trim()
      || !/^[^/\s]+\/\S+$/.test(binding.model ?? '') || !['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(binding.effort)
      || !['read', 'write'].includes(binding.parentRole) || (binding.parentRole === 'read' && binding.role !== 'read')) throw Error('Invalid owned host binding');
    const args = ['--mode', 'rpc', '--no-session', '--model', binding.model, '--thinking', binding.effort,
      ...ownedExtensionArguments(binding.role, binding.launcher)];
    const invocation = piCommand(binding.launcher, args);
    const result = Promise.withResolvers();
    // Consumers may attach after a synchronous startup failure; never leak an unhandled rejection.
    result.promise.catch(() => {});
    let transport, closed, stopping, exit, sessionId, joining = false, cancelled = false, finished = false, report = '', finalError;
    const controller = new AbortController();
    const tools = { owned_agent: createOwnedAgentSessionTool((request, signal) => ownedAgent?.(identity, request, signal)) };
    const emit = event => { try { onEvent(identity, event); } catch { /* Observers do not own lifecycle. */ } };
    function stop() {
      if (stopping) return stopping;
      stopping = (async () => {
        try { Promise.resolve(transport?.shutdown?.(stopMs)).catch(() => {}); } catch { /* Still require closure. */ }
        if (await bounded(closed ?? new Promise(() => {}), stopMs, false) === false) {
          try { transport?.terminate?.(); } catch { /* Unknown remains unknown. */ }
          onUnconfirmed(identity);
          return false;
        }
        return true;
      })();
      return stopping;
    }
    async function fail(error) {
      if (finished) return;
      finished = true; finalError = error;
      if (await stop()) result.reject(error);
    }
    async function complete() {
      if (finished || cancelled) return;
      finished = true;
      try {
        const stats = await bounded(transport.request('get_session_stats'), stopMs, null);
        if (stats && stats.sessionId !== sessionId) finalError = Error('Owned session identity changed');
        else onStats(identity, stats);
      } catch { /* Usage stays unknown. */ }
      if (await stop()) {
        if (cancelled || finalError || transport.failure || exit?.code !== 0) result.reject(finalError ?? transport.failure ?? Error('Owned child cancelled or exited unsuccessfully'));
        else result.resolve(report);
      }
    }
    async function settle() {
      if (joining) return;
      joining = true;
      try {
        const facts = await join?.(identity);
        if (finished || cancelled) return;
        if (facts) {
          report = ''; joining = false;
          await transport.request('prompt', { message: facts });
        } else await complete();
      } catch (error) { await fail(error); }
      finally { joining = false; }
    }
    function onRecord(record) {
      if (finished || cancelled) return;
      if (record.type === 'message_end' && record.message?.role === 'assistant') {
        const message = record.message;
        report = (message.content ?? []).filter(block => block.type === 'text').map(block => clean(block.text)).join('\n').slice(0, 8000);
        finalError = message.stopReason === 'stop' ? undefined : Error('Owned child response did not finish');
        emit({ type: 'message_end', text: report, usage: message.usage });
      } else if (['tool_execution_start', 'tool_execution_end'].includes(record.type)) {
        emit({ type: record.type, toolCallId: clean(record.toolCallId).slice(0, 200), toolName: clean(record.toolName).slice(0, 120), isError: record.isError === true });
      } else if (record.type === 'agent_settled') {
        if (record.aborted === true || finalError || !report.trim()) void fail(Error('Owned child did not finish a response'));
        else void settle();
      } else if (record.type === 'extension_ui_request' && ['confirm', 'select', 'input', 'editor'].includes(record.method)) {
        if (record.method === 'input' && record.title === BRIDGE && ownedAgent) {
          void serveBridge(record.placeholder, { tools }, controller.signal).then(reply => {
            if (!finished && !cancelled) transport.send({ type: 'extension_ui_response', id: record.id, value: JSON.stringify(reply) });
          }).catch(error => { void fail(error); });
        } else transport?.send?.({ type: 'extension_ui_response', id: record.id, cancelled: true });
      }
    }
    // Launchers are synchronous handle factories. Validation after launch must clean up, not throw and release capacity.
    try {
      transport = startProcess({ ...invocation, cwd: binding.cwd,
        env: { ...piEnvironment(binding.launcher), HOBKIN_OWNED_ROLE: binding.role, HOBKIN_OWNED_HELPERS: binding.allowHelpers === true ? '1' : '0' }, name: 'Owned child',
        maxRecordBytes: 1048576, maxKeptBytes: 65536, onRecord, onFail: error => { void fail(error); } });
      if (typeof transport?.closed?.then === 'function') {
        closed = Promise.resolve(transport.closed).then(value => {
          exit = value;
          if (!finished && !cancelled) { finished = true; result.reject(Error('Owned child exited before completion')); }
          return value;
        }, () => false);
      }
      if (!closed || typeof transport.request !== 'function' || typeof transport.shutdown !== 'function' || typeof transport.terminate !== 'function') {
        void fail(Error('Invalid owned transport'));
      } else {
        void (async () => {
          try {
            const state = await bounded(transport.request('get_state'), startupMs, null);
            if (cancelled || finished) return;
            if (!state) throw Error('Owned startup timed out');
            if (typeof state.sessionId !== 'string' || !state.sessionId) throw Error('Owned session identity missing');
            sessionId = state.sessionId;
            if (`${state.model?.provider}/${state.model?.id}` !== binding.model || state.thinkingLevel !== binding.effort) throw Error('Owned model or effort mismatch');
            await transport.request('prompt', { message: binding.prompt });
          } catch (error) { await fail(error); }
        })();
      }
    } catch (error) {
      // startRpcProcess must either return its handle or throw before creating a resource.
      if (transport) void fail(error);
      else { finished = true; result.reject(error); }
    }
    return { result: result.promise, async cancel() {
      cancelled = true;
      controller.abort();
      const confirmed = await stop();
      if (confirmed) { finished = true; result.reject(Error('Owned child cancelled')); }
      return confirmed;
    } };
  } };
}
