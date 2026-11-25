import { lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELECTION_ENV = 'HOBKIN_PROVIDER_EXTENSIONS';

/** Explicit provider-only entry files in the user's Hobkin configuration, never packages to install or discover. */
export function validateProviderExtensions(selection = {}) {
  if (!selection || Object.getPrototypeOf(selection) !== Object.prototype || Object.keys(selection).length > 16
    || Object.entries(selection).some(([provider, path]) => !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(provider)
      || typeof path !== 'string' || !isAbsolute(path) || path.length > 4096 || path.includes('\0') || !/\.[cm]?[jt]s$/.test(path))) {
    throw Error('Invalid provider extensions: name each provider and its installed absolute extension file.');
  }
  return selection;
}

function installedFile(path) {
  if (!lstatSync(path, { throwIfNoEntry: false })?.isFile()) throw Error('Configured provider extension is not an installed regular file.');
  return path;
}

/** Tool-free CLI and owned runs get a provider-only adapter, never the selected extension's other resources. */
export function providerExtensionBinding(selection, model, alreadyLoaded = []) {
  const providers = validateProviderExtensions(selection);
  const provider = model?.split('/')[0];
  if (!Object.hasOwn(providers, provider) || alreadyLoaded.includes(providers[provider])) return { args: [], env: {} };
  const path = installedFile(providers[provider]);
  return { args: ['--extension', fileURLToPath(import.meta.url)], env: { [SELECTION_ENV]: JSON.stringify({ [provider]: path }) } };
}

/**
 * Pi's own startup services install extension-registered providers before model resolution. Keep this loader separate
 * from the session's selected resources: its commands, tools and session hooks are never bound to the agent.
 */
export async function loadProviderExtensions(modelRuntime, selection, { cwd, agentDir } = {}) {
  const providers = validateProviderExtensions(selection);
  const paths = [...new Set(Object.values(providers).map(installedFile))];
  if (!paths.length) return;
  const { createAgentSessionServices, SettingsManager, getAgentDir } = await import('@earendil-works/pi-coding-agent');
  const services = await createAgentSessionServices({
    cwd: cwd ?? process.cwd(), agentDir: agentDir ?? getAgentDir(), modelRuntime,
    settingsManager: SettingsManager.inMemory({}),
    resourceLoaderOptions: {
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      additionalExtensionPaths: paths,
    },
  });
  const loaded = services.resourceLoader.getExtensions();
  if (loaded.errors.length || services.diagnostics.some(diagnostic => diagnostic.type === 'error')
    || paths.some(path => !loaded.extensions.some(extension => extension.path === path))
    || loaded.extensions.some(extension => !paths.includes(extension.path))) {
    throw Error('Configured provider extension failed to load.');
  }
  for (const provider of Object.keys(providers)) {
    if (!modelRuntime.getRegisteredProviderConfig(provider) && !modelRuntime.getRegisteredNativeProvider(provider)) {
      throw Error(`Configured provider extension did not register ${provider}.`);
    }
  }
}

/** Pi CLI calls this factory before model resolution. Forward only the chosen provider registration, not its hooks. */
export default async function registerSelectedProvider(pi) {
  const selection = validateProviderExtensions(JSON.parse(process.env[SELECTION_ENV] ?? '{}'));
  const { ModelRuntime } = await import('@earendil-works/pi-coding-agent');
  const runtime = await ModelRuntime.create({ allowModelNetwork: false });
  await loadProviderExtensions(runtime, selection);
  for (const provider of Object.keys(selection)) {
    const config = runtime.getRegisteredProviderConfig(provider);
    const native = runtime.getRegisteredNativeProvider(provider);
    if (config) pi.registerProvider(provider, config);
    if (native) pi.registerProvider(native);
  }
}
