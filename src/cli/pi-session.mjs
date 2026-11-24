import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { assertRuntimeAdmission, adoptedSession } from './migration/admission.mjs';
import { readSessionHeader } from './migration/ownership.mjs';
import { readSource, sha256 } from './migration/inventory.mjs';
import { routinesFolder, validateBinding } from './schedules.mjs';
import { createMemoryExtension, createMemoryTool } from './memory.mjs';
import { createQuestionTool } from './questions.mjs';
import { createCheckMessageTool, createScheduleTool, createSettingsTool, createStopWorkloadTool } from './hobkin-tools.mjs';
import { keptEffort, runModelSettings } from './model-settings.mjs';
import { compactAtForceLevel } from './compaction.mjs';
import { mainSdkResources } from './pi-extensions.mjs';
import { openRpcSession } from './rpc-session.mjs';
import { attachUserBash } from './user-bash.mjs';
import { createOwnedAgentSessionTool } from './owned-agent-tool.mjs';
import { hobkinCommand } from './work/chat.mjs';
import { HOBKIN_VERSION } from './version.mjs';
import hobkinBridge, { HOBKIN_BRIDGE_TOOLS } from './hobkin-extension.mjs';
import { createIntegrationExtension } from './integration-extension.mjs';
import { agentScheduleTools } from './schedule-tools.mjs';
import { mainMemoryTools, memoryHandler } from './memory-tools.mjs';

/** Caller holds the conversation reservation until the SDK and its compaction/retries settle. */
export async function withPiCancellation(session, signal, operation) {
  const agent = session.agent;
  const stream = agent?.streamFunction;
  if (agent) {
    agent.streamFunction = (model, context, options) => {
      signal.throwIfAborted();
      return stream(model, context, {
        ...options,
        signal: AbortSignal.any([signal, ...(options?.signal ? [options.signal] : [])]),
      });
    };
  }
  const abort = () => {
    void session.abort().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    const result = await operation();
    signal.throwIfAborted();
    return result;
  } finally {
    signal.removeEventListener('abort', abort);
    if (agent) agent.streamFunction = stream;
  }
}

export async function closePiSession(session) {
  if (!session) return;
  try {
    await session.extensionRunner?.emit({ type: 'session_shutdown', reason: 'exit' });
  } finally {
    await session.dispose();
  }
}

/** Pi owns the transcript format. Durable stores only its identity and dispatch receipts. */
export async function openPiSession(
  { root, config, saved, fresh = false, askQuestion, triggerSchedule, messageCheck, stopWorkload, ownedAgent, agentSchedules, memoryKeeper, integrations, startup },
  dependencies = {},
) {
  startup?.signal.throwIfAborted();
  root = assertRuntimeAdmission(root);
  const adopted = adoptedSession(root);
  const file = mainSessionFile(root, saved, adopted, fresh);
  const expected = fresh ? null : saved ?? adopted;
  if (config.launcher || dependencies.isolatedMain === true || typeof dependencies.createSession !== 'function') {
    const bootstrap = config.launcher ? dependencies.bootstrap : {
      root, file,
      expected: expected ? { sessionId: expected.sessionId, sessionFile: expected.sessionFile } : null,
      config: { main: config.main, background: config.background, resourceSelection: config.resourceSelection },
      agentDir: dependencies.agentDir, resourceCandidates: dependencies.resourceCandidates ?? [],
      clientExtensionPath: dependencies.clientBridge?.extensionPath, recoverScriptedHistory: dependencies.recoverScriptedHistory,
    };
    // Every configured Pi process stays behind its launcher and credentials.
    validateBinding({ harness: 'pi', ...config.main });
    claimSessionFile(file, { fresh, expected });
    return openRpcSession({
      startup,
      root,
      config,
      file,
      expected,
      askQuestion,
      triggerSchedule,
      messageCheck,
      stopWorkload,
      ownedAgent,
      agentSchedules,
      memoryKeeper,
      integrations,
      prompts: mainPrompts(root, config),
    }, { ...dependencies, bootstrap });
  }
  return openConversation({
    root,
    config,
    expected,
    file,
    fresh,
    customTools: [createQuestionTool(askQuestion, root), createScheduleTool(triggerSchedule), createCheckMessageTool(messageCheck), createMemoryTool(root), createStopWorkloadTool(stopWorkload), createOwnedAgentSessionTool(ownedAgent),
      ...Object.values(agentScheduleTools(agentSchedules)), ...Object.values(mainMemoryTools(memoryKeeper ?? memoryHandler(root, { kind: 'main' })))],
    modelSettings: { root, config },
  }, { ...dependencies, recoverScriptedHistory: false });
}

function refuseInProcess(config) {
  if (config.launcher) throw Error('A configured launcher starts every Pi process; none may run in this process.');
}

function claimSessionFile(file, { fresh, expected }) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  if (fresh && existsSync(file)) throw Error('Fresh main Pi conversation already exists.');
  if (!existsSync(file)) {
    if (expected) throw Error('Saved main Pi conversation is missing; refusing to create a replacement.');
    closeSync(openSync(file, 'wx', 0o600));
  }
  if (!lstatSync(file).isFile()) throw Error('Main Pi conversation must be a regular file.');
  if (expected && (readSessionHeader(file).sessionId !== expected.sessionId || file !== expected.sessionFile)) {
    throw Error('Main Pi conversation identity changed.');
  }
}

// The memory prompt carries what hobkin remembers for every agent after the right-now list (057-shared-memory).
const promptText = name => readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), 'utf8');
const mainPromptText = name => (name === 'memory' ? `${promptText('memory').trimEnd()}\n\n${promptText('memories')}` : promptText(name));

function mainPrompts(root, config) {
  return ['prompt', 'taste', 'learning-context', 'v2-runtime', 'memory', 'canvas'].map(name =>
    mainPromptText(name).replace('{{runtime}}', JSON.stringify({
      root,
      notes: join(root, 'notes'),
      routines: routinesFolder(root),
      main: config.main,
      background: config.background,
      learningAnswer: hobkinCommand(root, 'learning answer <id> yes|later|no'),
      profile: hobkinCommand(root, 'profile'),
      version: HOBKIN_VERSION,
    }, null, 2)));
}

function mainSessionFile(root, saved, adopted, fresh) {
  const directory = join(root, 'sessions');
  if (fresh) return join(directory, `main-${randomUUID()}.jsonl`);
  if (!saved) return adopted?.sessionFile ?? join(directory, 'main.jsonl');

  const file = saved.sessionFile;
  const isAdopted = saved.sessionId === adopted?.sessionId;
  const original = adopted?.sessionFile ?? join(directory, 'main.jsonl');
  if (typeof file !== 'string' || resolve(dirname(file)) !== resolve(directory)) {
    throw Error('Saved main Pi conversation is outside its owned sessions directory.');
  }
  if (adopted && ((isAdopted && file !== original) || (!isAdopted && file === original))) {
    throw Error('Main Pi conversation identity differs from its adoption.');
  }
  const isGeneratedSessionFile = /^main-[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\.jsonl$/i
    .test(basename(file));
  if (file !== original && !isGeneratedSessionFile) {
    throw Error('Saved main Pi conversation identity is not owned.');
  }
  return file;
}

function currentBinding(session) {
  const model = session.model;
  return {
    model: model ? `${model.provider}/${model.id}` : null,
    effort: session.thinkingLevel,
  };
}

function createModelSettingsTool({ root, config, currentSession, getModelRuntime }) {
  return createSettingsTool(request => runModelSettings({
    root,
    config,
    request,
    binding: () => currentSession.current ? currentBinding(currentSession.current) : null,
    modelRuntime: getModelRuntime,
    apply: async ({ model, effort }) => {
      const session = currentSession.current;
      if (!session) throw Error('The active Pi session is unavailable.');
      try {
        if (model) await session.setModel(model, { persist: false });
        if (effort !== undefined) session.setThinkingLevel(effort, { persist: false });
      } catch (error) {
        const failure = new Error(error instanceof Error ? error.message : String(error));
        failure.effective = currentBinding(session);
        throw failure;
      }
      return currentBinding(session);
    },
  }));
}

function importedSession(root, sessionId) {
  root = assertRuntimeAdmission(root);
  const index = JSON.parse(readFileSync(join(root, 'imported/sessions/index.json'), 'utf8'));
  const entry = index.sessions.find(session => session.sessionId === sessionId);
  if (!entry) throw Error('Session is not part of this verified adoption.');
  const bytes = readSource({ ...entry, path: join(root, entry.path) });
  return { root, entry, bytes };
}

export async function importedBinding(root, sessionId, explicit) {
  const { bytes } = importedSession(root, sessionId);
  return bindingFromSession(bytes, explicit);
}

export async function bindingFromSession(bytes, explicit) {
  const { buildSessionContext } = await import('@earendil-works/pi-coding-agent');
  const entries = bytes.toString('utf8').split('\n').filter(Boolean).slice(1).map(line => JSON.parse(line));
  const context = buildSessionContext(entries);
  const binding = explicit ?? {
    model: context.model ? `${context.model.provider}/${context.model.modelId}` : null,
    effort: context.thinkingLevel,
  };
  validateBinding({ harness: 'pi', ...binding });
  if (typeof binding.model !== 'string' || !/^[^/\s]+\/\S+$/.test(binding.model)) {
    throw Error('Adopted session needs an explicit fully qualified delivery binding.');
  }
  if (context.model && binding.model.split('/')[0] !== context.model.provider) {
    throw Error('Adopted conversation cannot be disclosed to a different provider.');
  }
  return { model: binding.model, effort: binding.effort };
}

export async function openImportedPiSession({ root, config, sessionId, binding, saved = false }, dependencies = {}) {
  refuseInProcess(config);
  const source = importedSession(root, sessionId);
  root = source.root;
  if (adoptedSession(root)?.sessionId === sessionId) throw Error('Reuse the already owned main conversation.');
  const selected = await importedBinding(root, sessionId, binding);
  const file = join(root, 'sessions', `legacy-${sha256(sessionId)}.jsonl`);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  if (!lstatSync(dirname(file)).isDirectory()) throw Error('Owned sessions directory must be real.');
  if (!existsSync(file)) {
    if (saved) throw Error('Saved adopted conversation is missing; refusing to replace it from history.');
    writeFileSync(file, source.bytes, { flag: 'wx', mode: 0o600 });
  }
  return openConversation({
    root,
    config: { ...config, main: { ...selected, cwd: source.entry.cwd } },
    file,
    expected: { sessionId, sessionFile: file },
  }, dependencies);
}

/** Extensions find the running Pi from this path, and through a link they reach an older copy of their own instead. */
export function followEntryLink(argv = process.argv) {
  if (argv[1] && existsSync(argv[1])) argv[1] = realpathSync(argv[1]);
}

async function pickInitialModel(modelRuntime, settings) {
  let resolver;
  try { resolver = await import(new URL('./core/model-resolver.js', import.meta.resolve('@earendil-works/pi-coding-agent')).href); }
  catch { return undefined; }
  return (await resolver.findInitialModel({ scopedModels: [], isContinuing: false,
    defaultProvider: settings.getDefaultProvider(), defaultModelId: settings.getDefaultModel(),
    defaultThinkingLevel: settings.getDefaultThinkingLevel(), modelThinkingLevels: settings.getAllModelThinkingLevels(), modelRuntime })).model;
}

export async function openConversation(
  { root, config, expected, file, fresh = false, customTools = [], modelSettings },
  { createSession, agentDir, resourceCandidates = [], modelRuntime: suppliedModelRuntime, deferExtensionBinding = false, rpcBridge,
    recoverScriptedHistory = false, pickModel = pickInitialModel, scriptedMain = false,
    loadSdk = () => import('@earendil-works/pi-coding-agent') } = {},
) {
  refuseInProcess(config);
  scriptedMain = scriptedMain === true;
  if (scriptedMain && (typeof createSession !== 'function' || deferExtensionBinding !== true || modelSettings || customTools.length
    || typeof rpcBridge?.clientExtensionPath !== 'string' || !isAbsolute(rpcBridge.clientExtensionPath)
    || !existsSync(rpcBridge.clientExtensionPath) || !lstatSync(rpcBridge.clientExtensionPath).isFile())) {
    throw Error('Scripted main requires its injected factory, deferred binding and client extension.');
  }
  validateBinding({ harness: 'pi', ...config.main });
  const resources = mainSdkResources(config.resourceSelection, resourceCandidates);
  followEntryLink();
  const {
    SessionManager,
    createAgentSession,
    createCodemodeExtension,
    createToolSearchExtension,
    DefaultResourceLoader,
    ModelRuntime,
    resolveCliModel,
    SettingsManager,
    getAgentDir,
  } = await loadSdk();
  claimSessionFile(file, { fresh, expected });
  const manager = SessionManager.open(file, dirname(file), config.main.cwd);
  if (expected && manager.getSessionId() !== expected.sessionId) throw Error('Main Pi conversation identity changed.');
  const effectiveAgentDir = agentDir ?? getAgentDir();
  const settingsManager = scriptedMain ? SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } })
    : SettingsManager.create(config.main.cwd, effectiveAgentDir);
  const appendSystemPrompt = mainPrompts(root, config);
  // The tools integrations offer the main conversation, as its parent handed them to this child (065-integration-drops).
  const offered = !scriptedMain && rpcBridge?.integrations ? rpcBridge.integrations : null;
  const builtIns = [
    { name: 'codemode', factory: createCodemodeExtension(), builtin: true, replaceable: true },
    { name: 'tool-search', factory: createToolSearchExtension(), builtin: true, replaceable: true },
  ];
  const resourceLoader = new DefaultResourceLoader({
    cwd: config.main.cwd,
    agentDir: effectiveAgentDir,
    // The loader must not resolve/install configured packages, even with discovery flags off.
    settingsManager: scriptedMain ? settingsManager : SettingsManager.inMemory({}),
    ...resources.loader,
    additionalExtensionPaths: [...resources.loader.additionalExtensionPaths, ...(rpcBridge?.clientExtensionPath ? [rpcBridge.clientExtensionPath] : [])],
    extensionFactories: [...builtIns, rpcBridge && !scriptedMain ? hobkinBridge : createMemoryExtension(root), ...(offered ? [createIntegrationExtension(offered)] : [])],
    appendSystemPrompt,
  });
  await resourceLoader.reload();
  resources.assertLoaded(resourceLoader);
  let options = {
    cwd: config.main.cwd,
    agentDir: effectiveAgentDir,
    sessionManager: manager,
    customTools,
    thinkingLevel: config.main.effort,
    settingsManager,
    resourceLoader,
  };
  let modelRuntime = scriptedMain ? undefined : suppliedModelRuntime;
  if (!createSession && !modelRuntime) modelRuntime = await ModelRuntime.create({ allowModelNetwork: false,
    ...(rpcBridge ? { authPath: join(effectiveAgentDir, 'auth.json'), modelsPath: join(effectiveAgentDir, 'models.json') } : {}) });
  let model;
  if (modelRuntime && config.main.model) {
    const resolved = resolveCliModel({ cliModel: config.main.model, modelRuntime });
    if (resolved.error || !resolved.model || resolved.warning) {
      throw Error(resolved.error ?? resolved.warning ?? 'Main model is unavailable.');
    }
    model = resolved.model;
  }
  if (recoverScriptedHistory === true && !config.main.model && modelRuntime) {
    const last = manager.getBranch().findLast(entry => entry.type === 'model_change' || (entry.type === 'message' && entry.message.role === 'assistant'));
    if ((last?.type === 'model_change' ? last.provider : last?.message?.provider) === 'hobkin-client') model = await pickModel(modelRuntime, settingsManager);
  }
  if (modelRuntime) options = { ...options, modelRuntime, model };
  const currentSession = { current: null };
  if (modelSettings) {
    const settingsTool = createModelSettingsTool({
      ...modelSettings,
      currentSession,
      getModelRuntime: () => currentSession.current?.modelRuntime ?? modelRuntime,
    });
    options = { ...options, customTools: [...customTools, settingsTool] };
  }
  const bridgeTools = rpcBridge ? [...HOBKIN_BRIDGE_TOOLS, ...(rpcBridge.clientExtensionPath ? ['client'] : []), ...(offered?.tools.map(tool => tool.name) ?? [])] : [];
  options.tools = scriptedMain ? ['client'] : [...resources.builtinTools, 'codemode', 'tool_search', ...options.customTools.map(tool => tool.name), ...bridgeTools];
  const { session, modelFallbackMessage } = await (createSession ?? createAgentSession)(options);
  currentSession.current = session;
  if (modelFallbackMessage || !keptEffort(session.model, config.main.effort, session.thinkingLevel)
    || (scriptedMain && `${session.model?.provider}/${session.model?.id}` !== 'hobkin-client/scripted')
    || (config.main.model && `${session.model?.provider}/${session.model?.id}` !== config.main.model)) {
    session.dispose();
    throw Error(modelFallbackMessage ?? 'Pi model or thinking binding changed.');
  }
  if (!scriptedMain) compactAtForceLevel(settingsManager, [...(session.modelRuntime?.getAvailableSnapshot?.() ?? []), session.model].filter(Boolean));
  const validateTools = () => {
    if (scriptedMain && `${session.model?.provider}/${session.model?.id}` !== 'hobkin-client/scripted') throw Error('Pi model binding changed.');
    resources.assertLoaded(resourceLoader);
    if (rpcBridge?.clientExtensionPath && !resourceLoader.getExtensions().extensions.some(item => item.path === rpcBridge.clientExtensionPath)) {
      throw Error('The Hobkin client extension is unavailable.');
    }
    const active = session.getActiveToolNames();
    if (active.some(name => !options.tools.includes(name)) || options.tools.some(name => !active.includes(name))) {
      throw Error('Main SDK tools missing or unexpectedly re-enabled by an extension.');
    }
  };
  if (deferExtensionBinding) {
    const bind = session.bindExtensions.bind(session);
    let bindingStarted = false;
    session.bindExtensions = async hooks => {
      if (bindingStarted) throw Error('Main SDK extensions already bound.');
      bindingStarted = true;
      await bind(hooks);
      validateTools();
    };
    return {
      session,
      services: {
        cwd: config.main.cwd,
        agentDir: effectiveAgentDir,
        settingsManager,
        resourceLoader,
        modelRuntime: session.modelRuntime ?? modelRuntime,
        diagnostics: [],
        assertMainInvariants: validateTools,
      },
    };
  }
  try {
    await session.bindExtensions({});
    validateTools();
    return attachUserBash(session);
  } catch (error) {
    await closePiSession(session);
    throw error;
  }
}
