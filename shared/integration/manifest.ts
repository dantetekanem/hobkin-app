import type { CommandDefinition } from '../commands/registry.ts'

/**
 * An integration is a folder under `integrations/` at the repository's root, such as `integrations/github/`. The app's
 * core never imports one: the host and the window find each folder when they start, and a folder that is not there
 * leaves nothing behind. See _specs/064-integration-drops and `integrations/README.md`.
 *
 * The manifest is the folder's `integration.ts`, whose default export is the value `defineIntegration` returns. It is
 * plain data the host and the window both read, with no Node and no DOM.
 */

/** An id is the folder's name. It names the integration's commands (`<id>.<name>`), its slice of the state, and its keys. */
export const INTEGRATION_ID = /^[a-z][a-z0-9-]{0,31}$/

/** A screen of its own in the menu, after Work. The user can take it out of the menu, and the spotlight still finds it. */
export interface IntegrationScreen {
  /** Unique across the app, and never a core screen's id. */
  id: string
  label: string
  /** What it holds, in a line, for the spotlight. */
  line: string
  /** Other names it is found by in the spotlight. */
  keywords: readonly string[]
}

export interface IntegrationManifest {
  /** The folder's name. */
  id: string
  name: string
  /** What it connects, in one line. */
  line: string
  /**
   * Its commands, each named `<id>.<something>`. They are checked and run exactly as the app's own: the window's clicks
   * and keys, and hobkin's `client` tool for those marked `hobkin`. A name the app already has is refused.
   */
  commands: Readonly<Record<string, CommandDefinition>>
  screens: readonly IntegrationScreen[]
}

/** The manifest as written, with its literal names kept, so each side can type its commands from it. */
export const defineIntegration = <const Manifest extends IntegrationManifest>(manifest: Manifest): Manifest => manifest
