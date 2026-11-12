import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readSessionHeader } from './migration/ownership.mjs';
import { resolveResourcePolicy } from './resource-policy.mjs';
import { validateBinding } from './schedules.mjs';
import { startRpcProcess } from './rpc-process.mjs';

const entry = fileURLToPath(import.meta.url);
const fields = (value, allowed) => {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !allowed.includes(key))) {
    throw Error('Invalid main child bootstrap fields.');
  }
};
const absolute = value => typeof value === 'string' && value.length <= 4096 && !value.includes('\0') && isAbsolute(value);
const identityString = value => typeof value === 'string' && value.length > 0 && value.length <= 200;

function validateBootstrap(value) {
  try { value = structuredClone(value); } catch { throw Error('Invalid main child bootstrap values.'); }
  fields(value, ['type', 'version', 'id', 'root', 'file', 'expected', 'config', 'agentDir', 'resourceCandidates', 'clientExtensionPath']);
  if (value.type !== 'hobkin/main/bootstrap' || value.version !== 1 || typeof value.id !== 'string' || !/^[\w-]{1,100}$/.test(value.id)) throw Error('Invalid main child bootstrap version or ID.');
  if (![value.root, value.file, value.config?.main?.cwd].every(absolute)
    || (value.agentDir !== undefined && !absolute(value.agentDir))
    || (value.clientExtensionPath !== undefined && !absolute(value.clientExtensionPath))) throw Error('Invalid main child bootstrap path.');
  if (dirname(value.file) !== join(value.root, 'sessions') || !/^main(?:-[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})?\.jsonl$/i.test(basename(value.file))) {
    throw Error('Main child bootstrap file is not owned.');
  }
  fields(value.config, ['main', 'background', 'resourceSelection']);
  fields(value.config.main, ['cwd', 'model', 'effort']);
  validateBinding({ ...value.config.main, harness: 'pi' });
  if (value.config.background !== undefined) {
    fields(value.config.background, ['harness', 'model', 'effort', 'cwd']);
    validateBinding(value.config.background);
    if (value.config.background.cwd !== undefined && !absolute(value.config.background.cwd)) throw Error('Invalid main child bootstrap background cwd.');
  }
  if (value.expected != null) {
    fields(value.expected, ['sessionId', 'sessionFile']);
    if (!identityString(value.expected.sessionId) || value.expected.sessionFile !== value.file) throw Error('Main child bootstrap identity changed.');
  }
  resolveResourcePolicy(value.config.resourceSelection, 'main', value.resourceCandidates ?? []);
  for (const candidate of value.resourceCandidates ?? []) {
    fields(candidate, ['id', 'kind', 'installed', 'path']);
    if (candidate.path !== undefined && !absolute(candidate.path)) throw Error('Invalid main child bootstrap resource path.');
  }
  const bytes = JSON.stringify(value);
  if (Buffer.byteLength(bytes) > 65536) throw Error('Main child bootstrap exceeds its byte limit.');
  return JSON.parse(bytes);
}

/** Inactive until explicitly selected by the parent; custody is returned before any SDK/bootstrap wait. */
export function startMainSessionChild(payload, { startupTimeoutMs = 180000, onFail = () => {}, ...options } = {}) {
  const bootstrap = validateBootstrap({ ...payload, type: 'hobkin/main/bootstrap', version: 1, id: randomUUID() });
  const ready = Promise.withResolvers();
  ready.promise.catch(() => {});
  let received = false;
  const transport = startRpcProcess({ ...options, command: process.execPath, args: [entry], cwd: bootstrap.config.main.cwd, ipc: true,
    onFail: error => { ready.reject(error); onFail(error); },
    onControl: record => {
      fields(record, ['type', 'version', 'id', 'success', 'sessionId', 'sessionFile', 'cwd', 'error']);
      if (received || record.type !== 'hobkin/main/ready' || record.version !== 1 || record.id !== bootstrap.id || record.success !== true
        || !identityString(record.sessionId) || record.sessionFile !== bootstrap.file || record.cwd !== bootstrap.config.main.cwd
        || (bootstrap.expected && record.sessionId !== bootstrap.expected.sessionId)) throw Error('Main child bootstrap identity or readiness changed.');
      received = true;
      ready.resolve(record);
    },
  });
  const timer = setTimeout(() => ready.reject(Error('Main child bootstrap timed out.')), startupTimeoutMs);
  timer.unref();
  ready.promise.then(() => clearTimeout(timer), () => clearTimeout(timer));
  transport.closed.then(() => ready.reject(Error('Main child exited before bootstrap readiness.')));
  try { transport.sendControl(bootstrap); } catch (error) { ready.reject(error); }
  return Object.assign(transport, { ready: ready.promise });
}

/** Native RPC owns all ordinary commands; this channel accepts one trusted bootstrap, never a module selector. */
export function runMainSessionChild(channel = process, {
  loadSdk = () => import('@earendil-works/pi-coding-agent'),
  openSession = async (...args) => (await import('./pi-session.mjs')).openConversation(...args),
} = {}) {
  const completion = Promise.withResolvers();
  let seen = false, stopped = false, runtime, disposal;
  const dispose = () => disposal ??= runtime?.dispose();
  const fail = error => { stopped = true; completion.reject(error); };
  const receive = value => {
    if (seen) return fail(Error('Duplicate main child bootstrap.'));
    seen = true;
    void (async () => {
      const data = validateBootstrap(value);
      const stat = lstatSync(data.file);
      if (!stat.isFile()) throw Error('Main child bootstrap requires a claimed regular file.');
      const header = stat.size ? readSessionHeader(data.file) : null;
      if (data.expected && (!header || header.sessionId !== data.expected.sessionId)) throw Error('Main child initial identity changed.');
      if (header && realpathSync(header.cwd) !== realpathSync(data.config.main.cwd)) throw Error('Main child initial cwd identity changed.');
      const expected = data.expected ?? (header ? { sessionId: header.sessionId, sessionFile: data.file } : null);
      const { AgentSessionRuntime, runRpcMode } = await loadSdk();
      if (stopped) return;
      const { session, services } = await openSession({ root: data.root, config: data.config, file: data.file, expected }, {
        loadSdk, agentDir: data.agentDir, resourceCandidates: data.resourceCandidates, deferExtensionBinding: true,
        rpcBridge: data.clientExtensionPath ? { clientExtensionPath: data.clientExtensionPath } : {},
      });
      const refuse = async () => { throw Error('Main session replacement belongs to the Hobkin parent.'); };
      runtime = new AgentSessionRuntime(session, services, refuse);
      if (stopped) { await dispose(); return; }
      let admittedSessionId = expected?.sessionId;
      const identity = () => {
        if (!identityString(session.sessionId) || session.sessionFile !== resolve(data.file) || session.sessionManager.getCwd() !== data.config.main.cwd
          || (admittedSessionId && session.sessionId !== admittedSessionId)) throw Error('Main child opened identity changed.');
        admittedSessionId = session.sessionId;
      };
      identity();
      let reloadFailure;
      const rpcSession = new Proxy(session, { get(target, property) {
        if (reloadFailure) throw reloadFailure;
        const value = Reflect.get(target, property, target);
        if (typeof value !== 'function') return value;
        if (property === 'reload') return async (...args) => {
          if (reloadFailure) throw reloadFailure;
          try {
            const result = await value.apply(target, args);
            identity();
            services.assertMainInvariants();
            return result;
          } catch (error) { reloadFailure = error; throw error; }
        };
        return (...args) => {
          if (reloadFailure) throw reloadFailure;
          return Reflect.apply(value, target, args);
        };
      } });
      const bind = session.bindExtensions.bind(session);
      let bound = false;
      session.bindExtensions = async hooks => {
        if (bound || stopped) throw Error('Main child extensions already bound or closed.');
        bound = true;
        await bind(hooks);
        identity();
        if (stopped) throw Error('Main child bootstrap was revoked.');
        channel.send({ type: 'hobkin/main/ready', version: 1, id: data.id, success: true,
          sessionId: session.sessionId, sessionFile: session.sessionFile, cwd: data.config.main.cwd });
      };
      await runRpcMode({ session: rpcSession, services, setRebindSession: callback => runtime.setRebindSession(callback),
        dispose, newSession: refuse, switchSession: refuse, fork: refuse, importFromJsonl: refuse });
      completion.resolve();
    })().catch(fail);
  };
  const disconnect = () => fail(Error('Main child bootstrap channel closed.'));
  channel.on('message', receive);
  channel.on('disconnect', disconnect);
  return completion.promise.finally(async () => {
    stopped = true;
    channel.off('message', receive);
    channel.off('disconnect', disconnect);
    await dispose();
  });
}

if (process.argv[1] && resolve(process.argv[1]) === entry) {
  runMainSessionChild().catch(() => {
    process.stderr.write('Main child bootstrap failed.\n');
    process.exit(1);
  });
}
