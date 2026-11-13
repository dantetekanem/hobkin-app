/** What the app says about itself. Settings shows it; the Mac's About panel carries the same words (src-tauri/src/lib.rs). */
export const ABOUT = {
  name: 'hobkin',
  description: 'Your next level Harness.',
  address: 'https://hobkin.dev',
  author: 'Leonardo Pereira',
  authorAddress: 'https://leonardopereira.com',
  /** The app's version, and the version of the hobkin core it runs. */
  version: __HOBKIN_VERSION__,
  coreVersion: __HOBKIN_CORE_VERSION__,
} as const
