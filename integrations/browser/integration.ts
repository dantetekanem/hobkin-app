import { Type } from 'typebox'
import { defineIntegration } from '#shared/integration/manifest.ts'

/**
 * A browser for hobkin's agents: each agent drives a real Chrome of its own, with a clean profile, through the tool
 * `browser_run`. The engine behind it (agent-browser and Chrome for Testing) is not shipped with the app: the user
 * installs it once from the window. What each command answers is `BrowserResults` in `protocol.ts`.
 */

const nothing = Type.Object({}, { additionalProperties: false })

const receipt = { id: Type.String({ maxLength: 64 }), owner: Type.String({ maxLength: 16 }) }

export default defineIntegration({
  id: 'browser',
  name: 'Browser',
  line: 'A real Chrome for each agent, to open and test pages',
  screens: [],
  commands: {
    'browser.canvas.claim': {
      description: 'Take one pending navigation for the visible canvas.', runs: 'host',
      args: Type.Object(receipt, { additionalProperties: false }),
    },
    'browser.canvas.finish': {
      description: 'Return what happened in the visible canvas.', runs: 'host',
      args: Type.Object({ ...receipt, text: Type.String({ maxLength: 32000 }), failed: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
    },
    'browser.status': {
      description:
        "Look again at what is installed and answer the browser's state: `engine.state` is `missing`, `installing`, `ready` or `failed`, with the versions once it is there and a note saying what an install is doing or why it failed; `sessions` lists the agents that have a browser open now, each with the page it is on. It only reads.",
      runs: 'host',
      args: nothing,
      hobkin: true,
    },
    'browser.install': {
      description:
        'Start installing the browser engine: agent-browser, at a pinned version checked against its known hash, and Chrome for Testing, about 400 MB on disk. It answers at once with the state, `engine.state` being `installing`; progress and the end arrive through the state. It downloads to disk, so it runs only on the user\'s word, from the Install button under Integrations, Browser. Refused with the reason on a computer it has no build for (it installs on a Mac), and while an install is already under way it answers that one.',
      runs: 'host',
      args: nothing,
      outside: true,
    },
    'browser.close': {
      description:
        "Close an agent's browser, or every agent's. `agent` is the agent as `sessions` names it in the state (`#main`, or a run's id); leave it out to close them all. It answers `closed`, how many were closed. An agent whose browser was closed gets a new one, with a clean profile, the next time it opens a page.",
      runs: 'host',
      args: Type.Object({ agent: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })) }, { additionalProperties: false }),
      hobkin: true,
    },
  },
})
