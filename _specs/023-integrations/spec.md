---
{
  "id": "023-integrations",
  "title": "Integrations",
  "kind": "work",
  "status": "ready",
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
- In development and in tests the host reads and writes a Pi configuration inside the development home, never the real `~/.pi/agent`.

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

## Steps

- [x] S1 (A1). The catalog, with each entry's vendor source checked and recorded. 19 services, each from its maker's own page, checked 2026-11-09. Figma is listed as not usable: it lets only clients in its own catalog connect.
- [x] S2 (A1, A7, A8). The screen on sample states: connected, catalog, own servers, and the detail. 43 tests pass; the keyboard walk was done in Chrome, not yet in the Mac window.
- [ ] S3 (A2, A5, A6, A10). Host: read Pi's configuration and state, turn servers on and off, in a development configuration.
- [ ] S4 (A3, A4, A9). Host: connect a service, with OAuth through Pi and with an environment reference.

## Open questions

- Service marks: the vendors' own logos, or simple marks drawn in the app's palette? Logos are recognized at once, but each has its own usage terms. The first version draws its own.
- ~~Gmail and Calendar have no single vendor server that every account can use. The catalog entry must say which server it uses and who makes it.~~ Answered 2026-11-09: Google makes remote servers for Gmail, Calendar and Drive. They are in Developer Preview, need membership in Google Workspace's Developer Preview Program, and sign in through an OAuth client of the user's own. Gmail's has no send tool, only drafts, and Calendar's lists only read scopes.
