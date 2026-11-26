import {
  ExtensionSelectorComponent, LoginDialogComponent, ModelRuntime, OAuthSelectorComponent, SettingsManager, getAgentDir, initTheme,
} from '@earendil-works/pi-coding-agent';
import { Container, ProcessTerminal, Text, TuiMainScreen } from '@earendil-works/pi-tui';

const NEEDS_MODEL = 'hobkin needs a model to talk to. Pick one and sign in. It is the same sign-in as /login in Pi, and Esc skips it.';
const ON_REQUEST = 'Pick a model to sign in to. It is the same sign-in as /login in Pi, and Esc leaves things as they are.';
const CANCELLED = 'Login cancelled';

/** Pi's own list for /login, less what is configured outside it, such as cloud credentials. */
function loginChoices(modelRuntime) {
  const choices = modelRuntime.getProviders().flatMap(({ id, name, auth }) => {
    const provider = { id, name, subscription: auth.oauth?.isSubscription === true };
    return [
      ...(auth.oauth ? [{ ...provider, authType: 'oauth', method: auth.oauth }] : []),
      ...(auth.apiKey?.login ? [{ ...provider, authType: 'api_key', method: auth.apiKey }] : []),
    ];
  });
  return choices.toSorted((left, right) => left.name.localeCompare(right.name));
}

function openScreen(terminal, intro) {
  initTheme(undefined, false);
  const tui = new TuiMainScreen(terminal);
  const body = new Container();
  tui.addChild(new Text(intro, 1, 1));
  tui.addChild(body);
  tui.start();

  const show = (component, notice) => {
    body.clear();
    if (notice) body.addChild(new Text(notice, 1, 0));
    body.addChild(component);
    tui.setFocus(component);
    tui.requestRender();
  };
  return { tui, show };
}

const pickProvider = (screen, choices, notice) => new Promise(resolve => {
  const chosen = (id, authType) => resolve(choices.find(choice => choice.id === id && choice.authType === authType));
  screen.show(new OAuthSelectorComponent('login', choices, chosen, () => resolve(null)), notice);
});

const pickOption = (screen, dialog, prompt) => new Promise((resolve, reject) => {
  const leave = settle => value => {
    screen.show(dialog);
    settle(value);
  };
  const labels = prompt.options.map(option => option.label);
  const picked = label => prompt.options.find(option => option.label === label).id;
  screen.show(new ExtensionSelectorComponent(
    prompt.message,
    labels,
    label => leave(resolve)(picked(label)),
    () => leave(reject)(Error(CANCELLED)),
  ));
});

function askUser(screen, dialog, prompt) {
  if (prompt.type === 'select') return pickOption(screen, dialog, prompt);
  if (prompt.type === 'manual_code') return dialog.showManualInput(prompt.message);
  return dialog.showPrompt(prompt.message, prompt.placeholder);
}

/** A browser sign-in can finish while its paste-the-code box is still open, and the abort is what closes that box. */
function answerOrAbort(answer, signal) {
  if (!signal) return answer;
  const aborted = new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(Error(CANCELLED)), { once: true });
  });
  return Promise.race([answer, aborted]);
}

function showProgress(dialog, event) {
  if (event.type === 'auth_url') {
    dialog.showAuth(event.url, event.instructions);
  } else if (event.type === 'device_code') {
    dialog.showDeviceCode(event);
    dialog.showWaiting('Waiting for you to sign in…');
  } else if (event.type === 'info') {
    dialog.showInfo(event.message, event.links);
  } else {
    dialog.showProgress(event.message);
  }
}

/** Returns what went wrong, or null. Backing out is not a failure, so it only goes back to the list. */
async function attempt(screen, modelRuntime, choice, getDeviceId) {
  const dialog = new LoginDialogComponent(screen.tui, choice.id, () => {}, choice.name);
  screen.show(dialog);
  const interaction = {
    signal: dialog.signal,
    prompt: prompt => answerOrAbort(askUser(screen, dialog, prompt), prompt.signal),
    notify: event => showProgress(dialog, event),
  };

  try {
    await modelRuntime.login(choice.id, choice.authType, interaction, { getDeviceId });
    return { signedIn: true };
  } catch (error) {
    const message = String(error?.message ?? error);
    return { failure: message === CANCELLED ? null : `Could not sign in to ${choice.name}: ${message}` };
  }
}

async function hasModel(modelRuntime) {
  try {
    return (await modelRuntime.getAvailable()).length > 0;
  } catch {
    return true;
  }
}

/** Runs before the dashboard, in the plain terminal. An extension can bring its own provider that this cannot see, so nothing here ever stops hobkin opening. */
export async function signIn({ always = false, launcher, modelRuntime, terminal = new ProcessTerminal() } = {}) {
  if (launcher && !always) return;

  const runtime = modelRuntime ?? await ModelRuntime.create({ allowModelNetwork: false });
  if (!always && await hasModel(runtime)) return;

  const choices = loginChoices(runtime);
  const settings = SettingsManager.create(process.cwd(), getAgentDir());
  const getDeviceId = () => settings.getOrCreateDeviceId();
  const screen = openScreen(terminal, always ? ON_REQUEST : NEEDS_MODEL);

  try {
    let notice = '';
    for (;;) {
      const choice = await pickProvider(screen, choices, notice);
      if (!choice) return;

      const { signedIn, failure } = await attempt(screen, runtime, choice, getDeviceId);
      if (signedIn) return;
      notice = failure ?? '';
    }
  } finally {
    screen.tui.stop();
  }
}
