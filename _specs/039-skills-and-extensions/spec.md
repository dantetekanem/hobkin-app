---
{
  "id": "039-skills-and-extensions",
  "title": "Skills and Pi extensions",
  "kind": "work",
  "status": "doing",
  "depends": ["020-settings", "023-integrations"],
  "updated": "2026-11-13"
}
---
# Skills and Pi extensions

## Outcome

Two pages under Settings, beside Integrations, show what Pi brings to hobkin's agents. Skills lists every skill Pi has. Each one can be read in full, turned off and on again, and handed to main hobkin with a change asked for in the user's own words. Pi extensions lists every Pi package and extension. Each extension has an on and off switch, and each package says whether an update is available. Both open from the Integrations tile in Settings, and both change Pi's configuration only on a click, through Pi's own code, as Integrations does.

## Decisions

- Two pages of their own under Settings, built like Integrations: Settings › Skills and Settings › Pi extensions. The Integrations tile in Settings opens them with two buttons beside Open integrations. Escape on either page steps back up to Settings, as it does from Integrations. No new shortcut for now.
- What Pi has is what `pi config` lists: Pi's own resolution of its resources (`DefaultPackageManager.resolve`) over Pi's settings, for the user's own scope. Project resources are out of scope, as they are for Integrations. Resolving never installs: Pi's resolver is told to skip a configured package that is missing, and the page says the package is not installed. Pi installs it itself when it next starts.
- A skill's name and description are Pi's own reading of its file (`loadSkills`), so a file Pi skips, such as one without a description, shows Pi's reason. Pi loads only the first skill of a name, and a skill that loses that way says which file Pi uses instead.
- Turning a skill or an extension off or on runs the code `pi config` runs when space is pressed on it (`ResourceList.toggleResource`, reached through `ConfigSelectorComponent`). It writes `-path` or `+path` into `skills` or `extensions` in Pi's `settings.json`, or into the package's own filter for a resource that comes from a package. No file of a skill or an extension is moved, edited or deleted, and Pi's settings code keeps everything else in the file. Pi does not export this code by name, so the host imports it by its file next to Pi's entry, as Integrations does Pi's MCP code. A later Pi that moves it shows a message, not a crash.
- After a change the host reads Pi's list again, and says so when Pi does not report the change.
- A change takes hold when Pi next loads its resources: a new session, or `/reload`. The pages say so.
- View more shows the skill's description, where Pi found it, its file (the file a link leads to, when Pi reaches it through one) and the rest of the file as Markdown. The host reads only a file on Pi's list, and at most 256 KB of it.
- Ask for a change: the user writes what should change, and it goes to main hobkin as a chat message the user sent, beginning "Change the skill “name” (file):", the way Settings sends a theme request. A skill from a package names the package too. The composer's draft stays as it is. The skill changes only if hobkin changes it in the conversation.
- Pi extensions shows Pi's packages in the order of Pi's settings. Each says where it comes from (npm, git or a folder on this Mac), its version from its own package.json, how many skills it brings, and its extensions, each with a switch. Then come the extensions in Pi's own extensions folder and in its settings, and last the four extensions built into Pi, by Pi's own list of them.
- Updates come from Pi's own check, the one behind its startup notice (`checkForAvailableUpdates`): `npm view <name> version --json` for an npm package and `git ls-remote` for a git one. It only reads. Nothing is installed or fetched. Pi never checks a folder on this Mac, a version pinned exactly or a pinned git ref, and the page says so for each. Pi gives no reason when a check fails, so the page says "No update found", never "up to date".
- Opening Pi extensions checks for updates once, and not again for ten minutes. Check for updates checks again.
- In development and in tests the host reads and writes the Pi folder that `piAgentDirFor` gives (023-integrations): Pi's own for a live host, the folder in PI_CODING_AGENT_DIR when one is named on purpose, and otherwise `<home>/client/scripted-agent`. Pi also reads the Agent Skills folder `~/.agents/skills` under the home folder, and offers no way to point it elsewhere, so a scripted host lists those skills too, only reading them. Tests point HOME at a folder of their own.
- Pi's messages and package sources go through Integrations' scrubbing (`scrubText`) before they leave the host, so a credential written into a git address never reaches the window.
- The host reads nothing until a page asks, and sends what it read as the command's answer. Nothing is pushed in the host's state messages.
- With no host, both pages show sample data and say so.

## Out of scope

- Installing, updating or removing packages and extensions.
- Editing a skill in the app.
- Project-level skills and extensions (`.pi/settings.json`).
- Prompts and themes, which `pi config` also turns on and off.

## Acceptance

- A1. Skills lists every skill `pi config` lists for the user, with Pi's name and description for it and whether it is on.
- A2. Turning a skill off writes Pi's own exclusion for it, and Pi's resolution then reports it off. Turning it on again reports it on. No skill file is moved, edited or deleted, and the rest of settings.json keeps its values.
- A3. View more shows a skill's description and the rest of its file. The host refuses to read a path that is not one of Pi's skills.
- A4. Ask for a change sends one chat message that names the skill, its file and the user's words, and leaves the composer's draft as it was.
- A5. Pi extensions lists every package in Pi's settings and every extension Pi resolves, including the ones built into Pi, each extension with whether it is on.
- A6. Turning an extension off or on writes Pi's own entry, and Pi's resolution agrees. An extension from a package is filtered in that package's entry.
- A7. A package whose registry has a newer version says an update is available. The check runs only reading commands, and nothing is installed, even for a package that is missing.
- A8. A host started for development or a test never reads or writes `~/.pi/agent`.
- A9. Both pages open from the Integrations tile in Settings, the menu shows them as Settings › Skills and Settings › Pi extensions, and Escape steps back up to Settings.
- A10. Every action on both pages can be reached and used with the keyboard alone.

## Proof

- A1. `host/test/skills.test.ts` › "lists every skill Pi resolves, with Pi's own name and description"
- A2. `host/test/skills.test.ts` › "off and on go through pi config's own toggle, and Pi agrees"
- A3. `host/test/skills.test.ts` › "reads only a skill on Pi's list, with its description and the rest of its file"
- A4. `ui/test/skills-ask.test.ts` › "a change request names the skill and its file, and keeps the draft"
- A5. `host/test/pi-extensions.test.ts` › "lists Pi's packages, their extensions and the ones built into Pi"
- A6. `host/test/pi-extensions.test.ts` › "off and on write Pi's own entry, in the package's filter for a package"
- A7. `host/test/pi-extensions.test.ts` › "updates come from Pi's own check, and nothing is installed"
- A8. `host/test/skills.test.ts` › "a scripted host reads the skills of its own Pi folder"
- A9. `ui/test/skills-extensions-pages.test.ts` › "Skills and Pi extensions sit under Settings, as Integrations does"; check: open each page from Settings in the window, then press Escape.
- A10. check: walk both pages with the keyboard.

## Steps

- [x] S1 (A1, A2, A3, A8). Host: skills through Pi's own code, with tests against a Pi folder of their own. 6 host tests pass, through Pi's own resolver, `loadSkills` and `pi config`'s toggle, with HOME pointed at the test's folder.
- [x] S2 (A5, A6, A7). Host: packages, extensions and updates through Pi's own code, with a stand-in npm. 4 host tests pass. The update check runs Pi's own `checkForAvailableUpdates` against a stand-in npm and a git remote in the test's folder: npm was asked only `view` and `root -g`, and the clone fetched nothing.
- [ ] S3 (A9). The two pages under Settings, opened from the Integrations tile. Done in source, with tests for the way in and back and for Escape. Not yet seen in the window.
- [ ] S4 (A1, A3, A4, A10). The Skills page. Done in source and seen in a still render on sample data, light and dark. Not yet walked with the keyboard in the window.
- [ ] S5 (A5, A6, A7, A10). The Pi extensions page. Done in source and seen in a still render on sample data, light and dark. Not yet walked with the keyboard in the window.

## Open questions

- A skill from an npm or git package is a copy Pi replaces when the package updates, so a change hobkin makes there does not last. The request names the package so hobkin can say so. Should the page warn first, or offer no change for a package's skills?
- A shortcut for each page, as Cmd+I opens Integrations?
