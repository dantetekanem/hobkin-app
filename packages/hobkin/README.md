# hobkin's runtime

This folder is hobkin's runtime. The hobkin-client host loads it as the `hobkin` package, through `link:packages/hobkin` in the client's `package.json`. It has no window or screen of its own. For the app and how to use it, see the [main README](../../README.md).

## What it holds

- `src/cli/application.mjs` is the application the host opens. It runs the main conversation with Pi, routines, work mode, schedules, memory, Action Items, reports and durable hobkins.
- `src/cli/main.mjs` is the `hobkin` command. The host and hobkin's agents run it, and `hobkin help` lists what it does.
- `src/cli/work/` is work mode. `src/cli/proof/` runs TLA+ checks for `hobkin proof`.
- `src/prompts/` holds what each agent is told, the routine templates and the personas. `src/prompts/hobkin-skill.md` teaches agents outside hobkin to use the `hobkin` command, and `hobkin skill install` puts it where they load skills.
- `src/skills/` holds the Pi skills hobkin's agents load.
- Homes moved over from pi-companion still run through a compatibility layer: `compatibility.mjs`, the `legacy-*.mjs` modules, `delivery.mjs` and `migration/`.
- `test/` holds the tests.

## Run the tests

The runtime is a pnpm project of its own. Use pnpm 11.12.0, the version pinned in `package.json`. `pnpm install` downloads Node 26.3.1, the development runtime set in `devEngines.runtime`, and pnpm scripts run on that Node. Your global Node and pnpm launcher stay as they are. The runtime itself runs on Node 22.19 or newer.

Point `HOBKIN_HOME` at a temporary folder, so no test can reach your real `~/.hobkin`:

```sh
cd packages/hobkin
pnpm install
HOBKIN_HOME=$(mktemp -d) pnpm test:cli
HOBKIN_HOME=$(mktemp -d) pnpm test:migration
HOBKIN_HOME=$(mktemp -d) node --test test/cli-main.test.mjs
```

The last line runs one file.

When qmd is installed, the CLI suite tests it too. The tests use temporary private indexes and do not load embedding models. qmd's native addons must support the development runtime (Node 26, ABI 147).

`qmd --version` does not load qmd's database addon, so it can work while indexing fails. In that case, run `pnpm exec qmd --index probe status` here, with both `XDG_CACHE_HOME` and `XDG_CONFIG_HOME` set to temporary folders. If qmd does not work with this runtime, install a version that does. Do not skip these tests.

`pnpm-workspace.yaml` turns off the optional build scripts it lists. Dependency preflight checks still run.

## Start Pi through a launcher

If Pi must start through a wrapper, such as one that sets up credentials or loads required extensions, add `launcher` to `config.json` in hobkin's home:

```json
"launcher": { "command": ["my-pi-launcher", "pi"], "env": { "EXAMPLE_MODE": "1" }, "managedExtensions": true }
```

hobkin then starts every Pi process with that command. The main chat runs as an RPC child (`my-pi-launcher pi --mode rpc`), and every job hobkin starts uses the same command. `env` adds variables, and it refuses names that look like credentials, such as ones with `KEY`, `TOKEN` or `SECRET` in them. hobkin passes its own environment through and never reads credentials. Set `managedExtensions` when the launcher loads required extensions and refuses `--no-extensions`. Jobs without tools then keep their other isolation flags.

If the main chat's child exits, hobkin says so and keeps running routines. Your next message opens the same conversation again in a new child. Quitting hobkin or resetting the chat ends a child that does not answer its stop: a quit after 2 seconds, a reset after the stop's 30 seconds. Without `launcher`, hobkin runs `pi` directly.

## Use a Pi provider extension

A Pi provider extension can supply models and sign-in that `models.json` cannot describe. To use one that is already installed, add its provider id and the absolute path to its entry file to `config.json` in hobkin's home:

```json
"providerExtensions": { "my-provider": "/absolute/path/to/provider-entry.ts" }
```

The model picker and the main Pi session then register that provider through Pi. They do not turn on its other tools, commands or hooks. The host reads the choice when it next starts. Sign in through Pi as usual, and remove the entry to undo it. A configured launcher stays in charge of its own providers. Only choose provider code you trust.

## What leaves your machine

Your chats, reports, memory and event history stay on your machine. Three kinds of data leave it.

### Your agents' work goes to your AI model

Your messages, and whatever your agents read while they work, are sent to the model provider you use. A tool you connect, such as GitHub, gets whatever your agents send it.

### Usage counts go to hobkin's server only after you say yes

Usage counts say which parts of hobkin you used and how runs and decisions ended. They hold fixed labels, counts and durations. They never hold a message, a report, a name or a file path, and each one gets a new random id that is not used anywhere on your machine. Chat tells you the first time they are sent.

- To start sending them: `hobkin telemetry upload on`
- To stop sending them: `hobkin telemetry upload off`
- To see what is sent and where: `hobkin telemetry upload status`

### Feedback goes to hobkin's server only when you send it

Sending feedback from the app is not built yet. Nothing goes until it is, and then only after you read exactly what goes and say yes. A crash report already waiting on this machine is offered that way when hobkin starts.

- To see what you sent: `hobkin feedback list`
- To delete a report on your machine and on the server: `hobkin feedback delete <id>`
- To stop sending feedback, including reports still waiting: `hobkin feedback off`

### Sending nothing at all

To send anything, your machine needs its own key from hobkin's server. It gets one the first time it sends usage counts, and keeps it in `runtime/remote.json`. If you turn usage counts off before that happens, your machine never gets a key and nothing goes to hobkin's server. If it already has a key, turn feedback off too.
