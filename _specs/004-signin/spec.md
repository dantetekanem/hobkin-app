---
{
  "id": "004-signin",
  "title": "Connect a model",
  "kind": "work",
  "status": "doing",
  "depends": ["002-host"],
  "updated": "2026-11-10"
}
---
# Connect a model

## Outcome

Every way to reach a model comes from Pi, the way Pi's own `/login` and `/model` work: a subscription signed in through the browser, an API key, or cloud credentials. Someone who already set one up in Pi or the terminal app opens the app and is never asked. Someone with none sees "Connect a model", where each provider shows whether it is connected, a subscription is one button and a browser approval, and an API key comes with plain steps that keep the key out of the app. hobkin can help: asked in the conversation, it lists the providers and starts a sign-in.

## Decisions

- Pi owns every account, flow and credential. The app adds no accounts of its own and stores nothing of its own about them. The host reads Pi's model runtime (`ModelRuntime` from `@earendil-works/pi-coding-agent`): its providers, whether each is connected, and the models it can use now.
- The host's state carries a `models` slice: for each provider its id, its name, the ways it can connect (a sign-in through OAuth, an API key and the environment variable Pi reads it from, or cloud credentials the provider finds by itself) and whether it is connected now, as a boolean and nothing else. Then the models Pi can use now, as Pi's `/model` picker lists them: id, provider, name, the thinking levels Pi allows for it (`getSupportedThinkingLevels`) and its context size. The slice is read again after every sign-in, sign-out or key line, and when the window comes back into focus, since the user may have changed Pi's setup in a terminal.
- A sign-in works for any provider Pi offers OAuth for. The host calls `ModelRuntime.login(provider, 'oauth', interaction, { getDeviceId })` and carries the interaction over the socket as before: the page to approve opens in the system browser, `manual_code` shows a field for the pasted redirect address, `info` and `progress` show as status lines, and Cancel aborts.
- No command ever takes a key. For a provider that takes an API key the app says what to do instead: set the environment variable Pi reads, or use the macOS Keychain the way Pi supports it. The Keychain route is two steps. The user runs `security add-generic-password -a "$USER" -s pi-<provider> -U -w` in Terminal, which asks for the key there. Then, on the user's yes, the host adds `"key": "!security find-generic-password -ws 'pi-<provider>'"` for that provider to Pi's `auth.json` through Pi's own login call, so Pi runs the command when it needs the key. The host never reads `auth.json` and never shows a credential.
- The Keychain line is refused for a provider Pi already holds a credential for, because Pi keeps one credential per provider and the line would replace a sign-in.
- Sign-out removes the provider's credential from Pi's store. It cannot remove an environment variable or cloud credentials, so when Pi still reaches the provider after it, the app says so.
- The app counts as ready when Pi can use at least one model, whatever the provider. Until then the canvas shows "Connect a model" and the conversation input is disabled with the reason. Nothing else ever blocks the app.
- On "Connect a model", providers with a sign-in come first, then those that take an API key, then those that use cloud credentials. Each row says connected or not.
- hobkin reaches the same commands through one tool, `client` (`013-hobkin-access`), with `list`, `describe` and `run`. Through it hobkin may list the providers and their state, explain how to set up a key, and start or cancel a sign-in. It cannot sign out or add a Keychain line, because those change Pi's setup outside the app and need the user's yes in the window.
- The scripted development host scripts the providers too: a few of Pi's real providers with Pi's own names and models, one connected and the rest not, and a scripted sign-in that asks for "ok". `--signed-out` starts with none connected.
- A real sign-in only ever opens the provider's own page, the one Pi's login gives, as `/login` does. The scripted sign-in names `https://scripted-sign-in.invalid/`, a reserved address no browser can load. Only a live host opens pages in the system browser. Every test and every scripted host gets an opener that only writes down what it was asked to open.
- The user chooses the main conversation's model from the models Pi can use now, and optionally its thinking level, with `models.select` (`selectMainModel` in `ui/src/lib/host`). The host goes through hobkin's own `updateSettings`, the path of hobkin's `model_settings` tool: hobkin saves the choice in `config.json`, and the open conversation goes on with it at once. A model Pi cannot use now is refused in plain words: a provider Pi does not have, one that is not connected, a model the provider does not have, or a thinking level the model does not offer. The scripted host and a home the terminal holds save nothing. hobkin's `client` tool cannot run it, because hobkin changes its own model with its own tool.
- The provider list is a component of its own, `ConnectModels` (`ui/src/features/signin/ConnectModels.tsx`). "Connect a model" holds it under its title, and any other page can hold it, such as the first-run setup (`025-onboarding`). It calls `onConnected(provider)` once for each provider that turns connected while it is shown, and `onReady()` when Pi can use a model and could not before. What was connected before it was shown is not news.
- Tokens and keys never leave the host and never reach its log.

## Out of scope

- Typing or pasting an API key into the app. That is the line this spec holds.
- Writing Pi's `models.json` for custom endpoints, local models and proxies. Pi's own docs cover them.
- Choosing the model and thinking level for each tier (`017-model-tiers`). That screen reads the `models` slice.
- Cloud credential setup itself (an AWS profile, `gcloud auth application-default login`). The app names the route and shows whether it works.

## Acceptance

- A1. With no usable credential, the app opens on the sign-in screen and the conversation input is disabled.
- ~~A2. Pressing "Sign in with OpenAI" opens OpenAI's page in the default browser. After approval there, the app is signed in within 3 seconds, without a restart.~~ Retired on 2026-11-10: the sign-in is no longer OpenAI only. See A12.
- A3. Pasting the redirect URL into the app completes the sign-in when the browser cannot reach the callback.
- A4. Cancel returns to the sign-in screen and writes no credential.
- ~~A5. If port 1455 is busy, the screen names the port, says which program usually holds it, and Retry works once the port is free.~~ Retired on 2026-11-10: port 1455 is the OpenAI sign-in's. Other sign-ins listen on other ports. See A18.
- A6. No access token, refresh token or API key appears in any message to the UI or in the host's log.
- A7. With a usable credential already in Pi's store, the app opens signed in and shows no sign-in screen.
- ~~A8. Sign out removes the OpenAI credential from Pi's store and returns to the sign-in screen.~~ Retired on 2026-11-10: sign-out works per provider. See A14.
- ~~A9. With a real ChatGPT account, pressing the button and approving in the browser ends in the conversation, signed in.~~ Retired on 2026-11-10: the check is no longer tied to ChatGPT. See A17.
- A10. With no usable model, the canvas shows "Connect a model": providers with a sign-in first, then API keys, then cloud credentials, each marked connected or not.
- A11. The host's state lists every provider Pi knows, with the ways it connects (a sign-in, an API key with its environment variable, cloud credentials) and a connected flag, and the models Pi can use now with their thinking levels and context size. After a sign-in, a sign-out or a Keychain line it changes without a restart.
- A12. Any provider Pi offers a sign-in for signs in from the app: its page opens in the browser, and after approval the provider shows connected. A provider without a sign-in is refused with what to do instead.
- A13. No command takes a key. For an API key the app gives the environment variable and the Keychain route, and on the user's yes adds the Keychain line to Pi's `auth.json` through Pi. A provider that already has a credential in Pi is refused. Nothing the host sends or logs contains a credential or the contents of `auth.json`.
- A14. Sign-out removes a provider's credential from Pi's store. When Pi still reaches the provider through the environment or cloud credentials, the result says so.
- A15. hobkin can list the providers and their state and start a sign-in from the conversation through its `client` tool. "Connect my Claude subscription" starts the Anthropic sign-in in the window. hobkin cannot sign out or add a Keychain line through it.
- A16. The scripted development host lists a scripted set of providers with one connected and the rest not, and its sign-in connects a provider, without an account or a network.
- A17. With a real subscription, signing in from "Connect a model" ends in the conversation, signed in.
- A18. If a sign-in's callback port is busy, the screen names the port, says what usually holds it, and Try again works once the port is free.
- A19. Signing out while hobkin is open keeps hobkin open, and the slice and the sign-in state change at once. A credential given to Pi again reaches the open conversation without a restart.
- A20. A page holding the provider list hears once of each provider that connects while it is shown, and once of the first usable model.
- A21. Choosing a model Pi can use saves it in hobkin's `config.json`, the open conversation's next answer comes from it with no restart, and hobkin opens on it next time. A model Pi cannot use now is refused with the reason, and nothing is saved.

## Proof

- A1. `host/test/signin.test.ts` › "reports signed out when no model is available"
- ~~A2. `host/test/signin.test.ts` › "carries the auth url and finishes when the provider resolves"~~ Retired with A2.
- A3. `host/test/signin.test.ts` › "a pasted redirect url resolves the manual prompt"
- A4. `host/test/signin.test.ts` › "cancel aborts and stores nothing"
- ~~A5. `host/test/signin.test.ts` › "a busy callback port becomes a retryable error"~~ Retired with A5.
- A6. `host/test/signin.test.ts` › "no credential field reaches the socket or the log"
- A7. `host/test/signin.test.ts` › "an existing credential opens signed in"
- ~~A8. `host/test/signin.test.ts` › "sign out removes the credential"~~ Retired with A8.
- ~~A9. check: the user runs it once with their own account, in the development home with `--live`.~~ Retired with A9.
- A10. `ui/test/connection-models.test.ts` › "sign-ins come first, then keys, then cloud credentials"
- A11. `host/test/models.test.ts` › "lists every provider and the models Pi can use, and follows auth changes"
- A12. `host/test/models.test.ts` › "signs in to any provider with a sign-in and refuses one without"
- A13. `host/test/models.test.ts` › "no command takes a key, and the keychain line goes through Pi on a yes"
- A14. `host/test/models.test.ts` › "sign out removes the credential and says when pi still reaches the provider"
- A15. `host/test/models.test.ts` › "hobkin starts a sign-in from the conversation through the client tool"
- A16. `host/test/models.test.ts` › "the scripted host lists scripted providers and signs in without an account"
- A17. check: the user signs in once with their own subscription, in the development home with `--live`.
- A18. `host/test/models.test.ts` › "a busy callback port becomes a retryable problem that names the port"
- A19. `host/test/live.test.ts` › "a live host on a development home goes on with the model Pi picks, and never reaches hobkin's server"
- A20. `ui/test/connection-models.test.ts` › "a page holding the provider list hears of each provider that connects, and of the first usable model"
- A21. `host/test/live.test.ts` › "the model the user chooses is saved in hobkin's config, and the open conversation answers with it at once", with `host/test/models.test.ts` › "the scripted host chooses no model, so nothing it has to offer reaches the home" and the refusal in `host/test/lock.test.ts`

## Steps

- [x] S1 (A1, A7). Host: report sign-in state from Pi's model runtime in `hello` and `state`.
- [x] S2 (A3, A4, A6). Host: run the login interaction over the socket, with cancel, the pasted URL and the busy-port error.
- [x] S3 (A1, A3, A4). UI: the sign-in screen and its states.
- ~~S4 (A8). Sign out, from the account menu.~~ Retired with A8. See S8.
- ~~S5 (A9). One real sign-in by the user.~~ Retired with A9. See S11.
- [x] S6 (A11, A16). Host: the `models` slice from Pi's runtime, scripted for development, read again when auth changes.
- [x] S7 (A12, A18). Host: sign-in for any provider with OAuth, and the busy-port problem for any port.
- [x] S8 (A13, A14). Host: key help, the Keychain line through Pi, and sign-out per provider.
- [x] S9 (A10). UI: "Connect a model" in place of the OpenAI sign-in screen, and `useModels()`.
- [x] S10 (A15). Host: the `client` tool in the main session, with the commands hobkin may run.
- [ ] S11 (A17). One real sign-in by the user.
- [x] S12 (A19). Host: sign-out and a new credential while hobkin is open, through the model runtime the main session shares.
- [x] S13 (A20). UI: `ConnectModels`, the provider list any page can hold, with `onConnected` and `onReady`.
- [x] S14 (A21). Host: `models.select` through hobkin's `updateSettings`, applied to the open conversation. UI: `selectMainModel`. The lightbox's Apply for the lead card is `017-model-tiers`'s.

## Open questions

- Pi offers two OpenAI sign-ins: `openai` ("Sign in with ChatGPT") and the older `openai-codex`. Both are listed. If the user's subscription works only through the older one, it is there to press.
- The `client` tool reaches hobkin's main session only when Pi runs in hobkin's own process. With a launcher configured, hobkin starts the main session as a child process, and adding a tool there needs the `client-host` change to hobkin that `013-hobkin-access` S3 names.
- The connected flag is Pi's own: a key Pi has not tried yet counts as connected. Whether a key works shows on the first request.
