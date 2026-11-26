import { isAbsolute } from 'node:path';
import { startRpcProcess, clean } from './rpc-process.mjs';
import { piCommand, piEnvironment } from './launcher.mjs';
import { ownedExtensionArguments } from './pi-extensions.mjs';
import { providerExtensionBinding } from './provider-extensions.mjs';
import { BRIDGE, serveBridge } from './bridge.mjs';
import { createOwnedAgentSessionTool } from './owned-agent-tool.mjs';
import { createCustomStyleTool } from './owned-agent-extension.mjs';
import { createTurnMetrics } from './turn-metrics.mjs';
const TOKEN_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite'];

// A deadline never asserts cleanup. Unknown transports keep their result pending and occupy the tree's slot.
async function bounded(promise, ms, fallback) {
  let timer;
  try { return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); })]); }
  finally { clearTimeout(timer); }
}

/** Host-only bindings carry permissions and task content; model-visible tree identities carry neither. */
export function createOwnedAgentAdapter({
  bindingFor,
  startProcess = startRpcProcess,
  onEvent = () => {},
  onStats = () => {},
  ownedAgent,
  customStyle,
  join,
  onUnconfirmed = () => {},
  startupMs = 10000,
  stopMs = 2000,
  now = Date.now,
  metricNow = () => performance.now(),
} = {}) {
  for (const ms of [startupMs, stopMs]) if (!Number.isSafeInteger(ms) || ms < 1 || ms > 60000) throw Error('Invalid owned deadline');
  return { start(identity) {
    // The moment the helper was asked for: its stages count from here.
    const began = now();
    const binding = bindingFor?.(identity);
    const theme = binding?.role === 'theme';
    if (
      theme
      && (
        binding.parentRole !== 'theme'
        || binding.allowHelpers !== false
        || typeof customStyle !== 'function'
        || identity.parentId !== identity.rootId
        || identity.depth !== 1
        || identity.id === identity.rootId
      )
    ) {
      throw Error('Invalid theme host binding');
    }
    if (
      !binding
      || !isAbsolute(binding.cwd ?? '')
      || typeof binding.prompt !== 'string'
      || !binding.prompt.trim()
      || !/^[^/\s]+\/\S+$/.test(binding.model ?? '') || !['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(binding.effort)
      || (!theme && (!['read', 'write'].includes(binding.parentRole) || (binding.parentRole === 'read' && binding.role !== 'read')))) throw Error('Invalid owned host binding');
    const provider = providerExtensionBinding(binding.launcher || theme ? undefined : binding.providerExtensions, binding.model);
    const args = ['--mode', 'rpc', '--no-session', '--model', binding.model, '--thinking', binding.effort,
      ...ownedExtensionArguments(binding.role, binding.launcher), ...provider.args];
    const invocation = piCommand(binding.launcher, args);
    const result = Promise.withResolvers();
    // Consumers may attach after a synchronous startup failure; never leak an unhandled rejection.
    result.promise.catch(() => {});
    let transport, closed, stopping, forcing, exit, sessionId, joining = false, cancelled = false, finished = false, report = '', finalError;
    let metrics, owner, terminalStats, currentResponse, outputObserved = false, sealed = false, uncertain = false, lastActivityAt = null;
    const seal = () => {
      if (theme) controller.abort();
      sealed = true;
      metrics?.finish(owner);
    };
    function snapshot() {
      const facts = metrics?.snapshot(owner);
      if (!facts) return { usage: null, lastActivityAt, performance: null };
      const performance = structuredClone(facts);
      // Read by the event that records this helper; a saved view leaves them out.
      performance.steps = metrics.steps(owner);
      performance.incomplete ||= uncertain;
      const usage = { incomplete: facts.incomplete || uncertain, sealed };
      for (const field of [...TOKEN_FIELDS, 'estimatedUsd']) {
        const response = facts[field];
        const total = terminalStats?.[field];
        const measured = typeof total === 'number' && Number.isFinite(total) && total >= 0;
        const regression = (measured && response.value !== null && total < response.value)
          || (total !== undefined && !measured);
        const value = measured ? Math.max(response.value ?? 0, total) : response.value;
        const state = value === null ? 'unavailable'
          : facts.incomplete || uncertain || regression ? 'partial'
          : measured ? 'complete' : response.state;
        performance[field] = { value, state };
        performance.incomplete ||= regression;
        if (TOKEN_FIELDS.includes(field)) {
          usage[field] = { value, state };
          usage.incomplete ||= state !== 'complete';
        }
      }
      if (uncertain && performance.responseDurationMs.value !== null) {
        performance.responseDurationMs.state = 'partial';
      }
      return { usage, lastActivityAt, performance };
    }
    const controller = new AbortController();
    const tools = theme
      ? {
          custom_style: createCustomStyleTool((request, signal) => customStyle(identity, request, signal)),
        }
      : {
          owned_agent: createOwnedAgentSessionTool((request, signal) => ownedAgent?.(identity, request, signal)),
        };
    async function themeBridge(placeholder) {
      try {
        if (typeof placeholder !== 'string' || Buffer.byteLength(placeholder) > 65536) {
          throw Error('Invalid theme bridge');
        }
        const request = JSON.parse(placeholder);
        if (
          !request
          || Array.isArray(request)
          || Object.keys(request).some(key => !['op', 'name', 'id', 'params'].includes(key))
          || request.op !== 'tool'
          || request.name !== 'custom_style'
          || typeof request.id !== 'string'
          || !request.id
          || request.id.length > 200
        ) {
          throw Error('Invalid theme bridge');
        }
        return {
          ok: true,
          result: await tools.custom_style.execute(request.id, request.params, controller.signal),
        };
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) };
      }
    }
    const emit = event => { try { onEvent(identity, event); } catch { /* Observers do not own lifecycle. */ } };
    function stop() {
      seal();
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
        if (!sealed) {
          if (stats?.sessionId === sessionId) {
            terminalStats = {
              ...Object.fromEntries(TOKEN_FIELDS.map(field => [field, stats.tokens?.[field]])),
              estimatedUsd: stats.cost,
            };
          } else if (stats) uncertain = true;
        }
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
      if (metrics && !sealed) {
        if (record.type === 'agent_start') metrics.observe({ type: 'agent_start' }, owner);
        const message = record.message;
        const captured = (record.sessionId === undefined || record.sessionId === sessionId)
          && (record.runId === undefined || record.runId === identity.id)
          && (record.responseId === undefined || record.responseId === (message ?? currentResponse)?.responseId);
        const own = captured && message?.role === 'assistant' && (message.sessionId === undefined || message.sessionId === sessionId)
          && `${message.provider}/${message.model}` === binding.model;
        const response = own ? { role: 'assistant', provider: message.provider, model: message.model,
          responseId: message.responseId, timestamp: message.timestamp } : undefined;
        const identified = value => (typeof value?.responseId === 'string' && value.responseId.length > 0 && value.responseId.length <= 512)
          || (typeof value?.timestamp === 'number' && Number.isFinite(value.timestamp) && value.timestamp >= 0);
        if (own && ['message_start', 'message_update'].includes(record.type)) currentResponse = identified(response) ? response : undefined;
        const associated = captured && !message && record.type === 'message_update' ? currentResponse : response;
        if (associated) {
          const update = record.assistantMessageEvent;
          const generated = record.type === 'message_update' && identified(associated) && ['text_delta', 'thinking_delta', 'toolcall_delta'].includes(update?.type)
            && typeof update.delta === 'string' && update.delta.length > 0;
          metrics.observe({
            type: record.type,
            message: { ...associated, usage: message?.usage, durationMs: message?.durationMs },
            assistantMessageEvent: generated ? { type: update.type, delta: '1' } : undefined,
          }, owner);
          if (generated && !outputObserved) {
            outputObserved = true;
            emit({ type: 'performance', display: false });
          }
        } else if (message?.role === 'assistant' || !captured) {
          uncertain = true;
          if (captured && message?.role === 'assistant') currentResponse = undefined;
        }
        if (own && record.type === 'message_end') currentResponse = undefined;
        if ((associated && ['message_start', 'message_update', 'message_end'].includes(record.type)) || ['tool_execution_start', 'tool_execution_end'].includes(record.type)) lastActivityAt = now();
      }
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
        const currentTheme = theme
          && sessionId
          && (record.sessionId === undefined || record.sessionId === sessionId)
          && !Object.keys(record).some(key => !['type', 'method', 'id', 'title', 'placeholder', 'sessionId', 'runId'].includes(key))
          && (record.runId === undefined || record.runId === identity.id)
          && typeof record.id === 'string'
          && record.id.length > 0
          && record.id.length <= 200;
        if (
          record.method === 'input'
          && record.title === BRIDGE
          && (theme ? currentTheme : ownedAgent)
        ) {
          const reply = theme
            ? themeBridge(record.placeholder)
            : serveBridge(record.placeholder, { tools }, controller.signal);
          void reply.then(reply => {
            if (!finished && !cancelled) transport.send({ type: 'extension_ui_response', id: record.id, value: JSON.stringify(reply) });
          }).catch(error => { void fail(error); });
        } else transport?.send?.({ type: 'extension_ui_response', id: record.id, cancelled: true });
      }
    }
    // Launchers are synchronous handle factories. Validation after launch must clean up, not throw and release capacity.
    try {
      transport = startProcess({ ...invocation, cwd: binding.cwd,
        env: { ...piEnvironment(binding.launcher), ...provider.env, HOBKIN_OWNED_ROLE: binding.role, HOBKIN_OWNED_HELPERS: binding.allowHelpers === true ? '1' : '0' }, name: 'Owned child',
        maxRecordBytes: 1048576, maxKeptBytes: 65536, onRecord, onFail: error => { void fail(error); } });
      const spawned = now();
      if (typeof transport?.closed?.then === 'function') {
        closed = Promise.resolve(transport.closed).then(value => {
          exit = value; seal();
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
            owner = { runId: identity.id, sessionId };
            metrics = createTurnMetrics({ ...owner, now: metricNow, wall: now, turn: { since: began, origin: 'tool', kind: 'helper',
              engine: 'pi', model: binding.model, effort: binding.effort, marks: { spawned, ready: now() } } });
            await transport.request('prompt', { message: binding.prompt });
          } catch (error) { await fail(error); }
        })();
      }
    } catch (error) {
      // startRpcProcess must either return its handle or throw before creating a resource.
      if (transport) void fail(error);
      else { finished = true; result.reject(error); }
    }
    return {
      result: result.promise, snapshot,
      force() {
        if (forcing) return forcing;
        cancelled = true; seal();
        controller.abort();
        try { if (!exit) transport?.force?.(); } catch { /* Still require captured closure. */ }
        forcing = bounded(closed ?? new Promise(() => {}), stopMs, false).then(value => {
          if (value === false) return false;
          finished = true;
          result.reject(Error('Owned child cancelled'));
          return true;
        }).finally(() => { forcing = undefined; });
        return forcing;
      },
      async cancel() {
        cancelled = true;
        controller.abort();
        const confirmed = await stop();
        if (confirmed) { finished = true; result.reject(Error('Owned child cancelled')); }
        return confirmed;
      },
    };
  } };
}
