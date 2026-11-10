---
{
  "id": "023-integrations",
  "title": "Integrations",
  "kind": "work",
  "status": "doing",
  "depends": ["002-host", "019-keyboard", "020-settings"],
  "updated": "2026-11-10"
}
---
# Integrations

## Outcome

Integrations is a canvas screen where the user sees every service hobkin can reach and connects more: Slack, GitHub, Gmail, Calendar and ten or more others, plus any MCP server of their own. Each one says in plain words what hobkin can read through it and what it can change, whether it is connected, and which tools it brings. Connecting one takes a click and, where the service asks, a sign-in in the browser.

## Decisions

- An integration is an MCP server in Pi's configuration (`~/.pi/agent/mcp.json`, under `mcpServers`). Pi connects them, and routines and agents get their tools. The client adds no second mechanism, so the terminal app and `pi mcp list` see the same connections.
- One exception: GitHub connects through gh, GitHub's command line tool, with the login gh already has (`024-github`). Its tile follows gh. It sits with the connected services while gh is signed in, reads "Connected through gh as @login", and its detail opens the GitHub page under Pages. GitHub's MCP server stays in the catalog, for the tools agents use.
- The screen has three parts, in this order: what is connected, the catalog of services that can be added, and the user's own servers.
- The catalog names at least twelve services. The first set: Slack, GitHub, Gmail, Google Calendar, Google Drive, Linear, Notion, Jira and Confluence, Sentry, Figma, Home Assistant and Stripe. Each entry holds the service's name, what it is for in one line, what hobkin can read and what it can change, and how it connects.
- Every entry's server comes from the vendor's own documentation, recorded in the catalog with the page it came from and the date it was checked. Where a vendor has no server of its own, the entry says so, names the community server it would use, and is marked as not from the vendor. Nothing is guessed. This is hobkin's own setup rule (`src/prompts/setup.md`, "Connect what they use").
- A server the user added themselves is listed with the same care as a catalog entry: its name, whether it is a remote address or a local command, its state, its tools, and its last error.
- States: not connected, connecting, needs sign-in, connected with its number of tools, off (kept but not used), and failed with Pi's own message.
- Connecting a service that signs in with OAuth adds its entry and starts Pi's sign-in. The browser opens, and the screen shows connected when it returns, with no restart.
- A service that needs a key never gets one typed into the app. The screen names the environment variable to set in the shell profile, and the entry reads it from there, as hobkin's setup does.
- Turning one off keeps its entry with `enabled` false. Removing deletes the entry. Changes to `mcp.json` leave everything else in the file as it was.
- A tile opens to the service's detail: what hobkin can do with it, its tools marked as reading or changing, its state, the routines that use it, and its actions.
- Look: tiles on the canvas in the manner of Settings, with a mark for each service drawn in the app's palette. A connected service shows life: a small pulse when one of its tools is in use.
- Integrations opens from a tile in Settings and with Cmd+I. Everything works from the keyboard by the rule of `019-keyboard`.
- In development and in tests the host reads and writes a Pi configuration inside the development home, never the real `~/.pi/agent`. A live host uses Pi's own folder. A scripted host uses the folder named in `PI_CODING_AGENT_DIR` when one is named on purpose, and otherwise `<home>/client/scripted-agent`.
- The host reads and writes Pi's configuration only through Pi's own code: `loadMcpConfig`, each server as `McpServerConnection` reaches it the way `pi mcp list` does, and `updateMcpServerConfig`, `addMcpServerConfig` and `removeMcpServerConfig` for changes. Pi does not export these by name, so the host imports them by their files next to Pi's entry, as it already does Pi's model resolver. A later Pi that moves them shows a message on the screen, not a crash.
- It reads nothing and starts nothing until the screen asks. Opening the screen looks at the servers once, and not again within a minute. "Check again" looks again. A look connects to each server that is on, reports where it got to and its tools, and closes again. Only the user-level file is read.
- Before anything leaves the host, entries and messages lose their secrets (`shared/integrations/redact.ts`). A value written into a header, an environment variable, a client secret, a secret option or the address shows as `[hidden]`, and so does anything shaped like a credential, or what a referenced variable holds, in Pi's messages. A reference such as `${NAME}` stays, since it holds no secret.
- With a host connected the screen shows only what the host read from Pi. The sample is for a window with no host, and says so. Pulses of a tool in use and the routines that use a server are sample life, so a live screen leaves them out until the host reports them.
- Connecting a catalog service writes the catalog's own entry, with only the values that entry asks for, such as an address or an app's client ID. Nothing typed in the app can stand where a key goes.

## Out of scope

- Writing MCP servers.
- Per-project servers (`.pi/mcp.json`). The first version shows user-level servers.
- Storing secrets in the app.

## Acceptance

- A1. The catalog lists at least twelve services, each with what it reads, what it changes, and the vendor page its server came from.
- A2. Every server in Pi's configuration appears, from the catalog or the user's own, with the state and tool count `pi mcp list` reports for it.
- A3. Connecting an OAuth service opens the service's page in the browser, and after approval the tile shows connected with its tools, without restarting the app.
- A4. A service that needs a key shows the name of the environment variable to set and where. No field in the app accepts the key.
- A5. Turning a service off and on writes `enabled` in `mcp.json`, and `pi mcp list` agrees. Other entries and unknown fields in the file are unchanged.
- A6. A server that fails to connect shows Pi's message and a way to try again.
- A7. A service's detail lists its tools, each marked as reading or changing.
- A8. Every tile and action can be reached and used with the keyboard alone.
- A9. No token, key or OAuth credential appears in any message to the UI or in the host's log.
- A10. The host started in development never reads or writes `~/.pi/agent/mcp.json`.
- A11. With a host connected, the screen shows only what the host read from Pi's configuration. Sample data shows only in a window with no host, and says so.

## Proof

- A1. `shared/test/integrations-catalog.test.ts` › "every entry names what it reads, what it changes and its source"
- A2. `host/test/integrations.test.ts` › "lists configured servers with Pi's state"
- A3. check: connect one OAuth service in the development home with the user present.
- A4. `host/test/integrations.test.ts` › "a keyed service is added with an environment reference, never a value"
- A5. `host/test/integrations.test.ts` › "off and on change only enabled"
- A6. `host/test/integrations.test.ts` › "a failed server carries Pi's message"
- A7. check: open a connected service's detail.
- A8. check: walk the screen with the keyboard.
- A9. `host/test/integrations.test.ts` › "no credential reaches the socket or the log"
- A10. `host/test/integrations.test.ts` › "development uses its own Pi configuration"
- A11. `ui/test/integrations-live.test.ts` › "with a host, the screen shows only what the host read from Pi, never the sample"

## Steps

- [x] S1 (A1). The catalog, with each entry's vendor source checked and recorded. 19 services, each from its maker's own page, checked 2026-11-09. Figma is listed as not usable: it lets only clients in its own catalog connect.
- [x] S2 (A1, A7, A8). The screen on sample states: connected, catalog, own servers, and the detail. 43 tests pass; the keyboard walk was done in Chrome, not yet in the Mac window.
- [x] S3 (A2, A5, A6, A10, A11). Host: read Pi's configuration and state, turn servers on and off, in a development configuration. 8 host tests pass through Pi's own code against a test Pi folder and a local stdio server, with no network. On 2026-11-10, a scripted host on a test home and a test Pi folder was walked in Chrome: Pi's states and tools, off and on writing only `enabled`, a catalog service added and removed, a literal header shown as `[hidden]`.
- [ ] S4 (A3, A4, A9). Host: connect a service, with OAuth through Pi and with an environment reference. Done: adding a catalog entry with references only (A4) and removing one, with secrets hidden throughout (A9). Not done: signing in from the app (A3). For now the detail names `pi mcp login <name>` to run in a terminal, and checks again.

## Open questions

- Service marks: the vendors' own logos, or simple marks drawn in the app's palette? Logos are recognized at once, but each has its own usage terms. The first version draws its own.
- Signing in from the app (A3): call Pi's own `signInMcpServer` from the host, which opens the browser and waits for its callback, or keep the terminal step (`pi mcp login`) that hobkin's setup already teaches? The first needs a check with the user present and a real service. The second works today and keeps every sign-in in Pi's hands.
- Which routines use a server, and which tool is in use now: hobkin does not record either yet. Routine files that name `mcp__<server>__` tools, and the tool calls in the turns the host relays, could say. Until then a live screen shows neither.
- The user's running host loads this code only after a restart. Until then a host connected to the window says it does not read Pi's configuration yet.
- ~~Gmail and Calendar have no single vendor server that every account can use. The catalog entry must say which server it uses and who makes it.~~ Answered 2026-11-09: Google makes remote servers for Gmail, Calendar and Drive. They are in Developer Preview, need membership in Google Workspace's Developer Preview Program, and sign in through an OAuth client of the user's own. Gmail's has no send tool, only drafts, and Calendar's lists only read scopes.
