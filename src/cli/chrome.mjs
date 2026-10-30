// Every Companion run may use the user's Chrome with no time limit. What it may do there is in its directions.
export const CHROME_GRANT = '/chrome authorize indefinite';
export const CHROME_NOTE = 'pi-chrome-tool-change';

const COMMAND = 'chrome';
const CONSENT_TITLE = 'Authorize pi-chrome control?';

export const offersChrome = commands => commands.some(command => command.name === COMMAND);
export const isChromeConsent = ({ method, title }) => method === 'confirm' && title === CONSENT_TITLE;

const consentUi = {
  confirm: async title => title === CONSENT_TITLE,
  select: async () => undefined,
  input: async () => undefined,
  editor: async () => undefined,
  custom: async () => undefined,
  notify() {},
  setStatus() {},
  theme: { fg: (_color, text) => text },
};

/** The in-process chat has no UI for extensions, so this stands in for the one question the grant asks. */
export async function grantChrome(session) {
  const runner = session.extensionRunner;
  const commands = runner?.getRegisteredCommands?.() ?? [];
  if (!commands.some(command => command.invocationName === COMMAND)) return;

  runner.setUIContext(consentUi);
  try {
    await session.prompt(CHROME_GRANT);
  } catch {
    // A browser problem cannot stop the conversation, and the agent still sees that Chrome is locked.
  } finally {
    runner.setUIContext();
  }
}
