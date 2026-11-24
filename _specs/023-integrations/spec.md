---
{
  "id": "023-integrations",
  "title": "Integrations",
  "kind": "work",
  "status": "doing",
  "depends": ["002-host", "019-keyboard", "020-settings"],
  "updated": "2026-11-24"
}
---
# Integrations

## Outcome

Integrations is a canvas screen where the user sees every service hobkin can reach, of two kinds. A full integration connects its own way and has a whole page in the app: for now GitHub, through gh. MCP servers are the rest: the ones in Pi's configuration, which the user adds with `pi mcp add`. Each says whether it is connected, which tools it brings and which of them read and which change something, and why it failed when it did. There is no catalog of services to add (the user, 2026-11-24).

## Decisions

- Integrations are of two kinds. A full integration connects its own way and provides a whole page in the app. An MCP integration is an MCP server in Pi's configuration (`~/.pi/agent/mcp.json`, under `mcpServers`): Pi connects them, and routines and agents get their tools. The client adds no second mechanism for MCP servers, so the terminal app and `pi mcp list` see the same connections.
- Each full integration is a folder under `integrations/` and draws its own card above the MCP servers (`065-integration-drops`). GitHub is the first. It connects through gh, GitHub's command line tool, with the login gh already has (`024-github`), and its page is Pages › GitHub. Its card says how gh stands and as which account, what the page holds, opens the page, and holds the setting that shows GitHub in the menu. A GitHub MCP server the user configured themselves shows with the other servers, like any other.
- The screen shows the full integrations' cards first, then the MCP servers Pi's configuration has, in the order of its file.
- The catalog is gone. On 2026-11-24 the user, looking at the section "10 more hobkin can reach" (Linear, Notion, Jira and Confluence, Sentry, Stripe, Cloudflare, Supabase, GitLab, Intercom, Todoist, each "Signs in"), said: "remove this too, they dont exist". No service is offered for adding, `integrations.add` is gone, and a server that matched a catalog entry shows like any other configured server, by its own name.
- A server is listed with its name, whether it is a remote address or a local command, its state, its tools, and its last error.
- States: connecting, needs sign-in, connected with its number of tools, off (kept but not used), and failed with Pi's own message.
- A server that needs a sign-in shows the command to run in a terminal, `pi mcp login <name>`, and "Check again" looks once the user has approved. No key is typed into the app; an entry reads one from the environment, as Pi does.
- Turning one off keeps its entry with `enabled` false. Removing deletes the entry. Changes to `mcp.json` leave everything else in the file as it was.
- A tile opens to the server's detail: its state, its tools marked as reading or changing, the routines that use it, its entry in Pi's configuration, and its actions (turn off, turn on, remove, check again).
- Look: tiles on the canvas in the manner of Settings, with a mark for each server drawn in the app's palette from its name. A full integration has a larger card than an MCP tile.
- Integrations opens from a tile in Settings and with Cmd+I. Everything works from the keyboard by the rule of `019-keyboard`.
- In development and in tests the host reads and writes a Pi configuration inside the development home, never the real `~/.pi/agent`. A live host uses Pi's own folder. A scripted host uses the folder named in `PI_CODING_AGENT_DIR` when one is named on purpose, and otherwise `<home>/client/scripted-agent`.
- The host reads and writes Pi's configuration only through Pi's own code: `loadMcpConfig`, each server as `McpServerConnection` reaches it the way `pi mcp list` does, and `updateMcpServerConfig` and `removeMcpServerConfig` for changes. Pi does not export these by name, so the host imports them by their files next to Pi's entry, as it already does Pi's model resolver. A later Pi that moves them shows a message on the screen, not a crash.
- It reads nothing and starts nothing until the screen asks. Opening the screen looks at the servers once, and not again within a minute. "Check again" looks again. A look connects to each server that is on, reports where it got to and its tools, and closes again. Only the user-level file is read.
- Before anything leaves the host, entries and messages lose their secrets (`shared/integrations/redact.ts`). A value written into a header, an environment variable, a client secret, a secret option or the address shows as `[hidden]`, and so does anything shaped like a credential, or what a referenced variable holds, in Pi's messages. A reference such as `${NAME}` stays, since it holds no secret.
- With a host connected the screen shows only what the host read from Pi. The sample is for a window with no host, and says so. Pulses of a tool in use and the routines that use a server are sample life, so a live screen leaves them out until the host reports them.

## Out of scope

- Writing MCP servers.
- Per-project servers (`.pi/mcp.json`). The first version shows user-level servers.
- Storing secrets in the app.

## Acceptance

- A2. Every server in Pi's configuration appears with the state and tool count `pi mcp list` reports for it.
- A5. Turning a server off and on writes `enabled` in `mcp.json`, and `pi mcp list` agrees. Other entries and unknown fields in the file are unchanged.
- A6. A server that fails to connect shows Pi's message and a way to try again.
- A7. A server's detail lists its tools, each marked as reading or changing.
- A8. Every tile, card control and action can be reached and used with the keyboard alone.
- A9. No token, key or OAuth credential appears in any message to the UI or in the host's log.
- A10. The host started in development never reads or writes `~/.pi/agent/mcp.json`.
- A11. With a host connected, the screen shows only what the host read from Pi's configuration. Sample data shows only in a window with no host, and says so.
- A12. A full integration's card shows above the MCP servers. The screen has no catalog and no way to add a service.

## Proof

- A2. `host/test/integrations.test.ts` › "lists configured servers with Pi's state"
- A5. `host/test/integrations.test.ts` › "off and on change only enabled"
- A6. `host/test/integrations.test.ts` › "a failed server carries Pi's message"
- A7. check: open a connected server's detail.
- A8. check: walk the screen with the keyboard, from a card's controls to the servers.
- A9. `host/test/integrations.test.ts` › "no credential reaches the socket or the log"; `shared/test/integrations-redact.test.ts`
- A10. `host/test/integrations.test.ts` › "development uses its own Pi configuration"
- A11. `ui/test/integrations-live.test.ts` › "with a host, the screen shows only what the host read from Pi, never the sample"
- A12. `ui/test/integrations-sample.test.ts`, `ui/test/integrations-marks.test.ts`; check: open Integrations in light and dark.

## Steps

- [x] S2 (A7, A8). The screen on sample states: the servers and the detail. The keyboard walk was done in Chrome, not yet in the Mac window.
- [x] S3 (A2, A5, A6, A10, A11). Host: read Pi's configuration and state, turn servers on and off, in a development configuration. The host tests pass through Pi's own code against a test Pi folder and a local stdio server, with no network.
- [x] S4 (A9). Secrets hidden throughout, and removing a server.
- [ ] S5 (A12). The full integrations' cards above the MCP servers, from each integration's window part. Source and tests done; not yet seen in the window.
- [x] S6 (A12). The catalog gone, 2026-11-24 (`065-integration-drops`, S6): its file, the add flow and `integrations.add`, the catalog's tiles and form, and the sample catalog data. S1, the catalog with each entry's vendor source, went with it.

## Open questions

- Service marks: the vendors' own logos, or simple marks drawn in the app's palette? The app draws its own, from the server's name.
- Signing in from the app: call Pi's own `signInMcpServer` from the host, or keep the terminal step (`pi mcp login`) that hobkin's setup already teaches? The second works today and keeps every sign-in in Pi's hands.
- Which routines use a server, and which tool is in use now: hobkin does not record either yet. Routine files that name `mcp__<server>__` tools, and the tool calls in the turns the host relays, could say. Until then a live screen shows neither.
- The user's running host loads this code only after a restart. Until then a host connected to the window says it does not read Pi's configuration yet.
