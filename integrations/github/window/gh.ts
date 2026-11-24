import type { GitHubConnection } from '../protocol.ts'

/** How gh stands. GitHub connects through gh, with the login gh already has (024-github). */
export interface GhLink {
  connection: GitHubConnection
  login: string | null
}

/** How gh stands, in a few words, for GitHub's card. */
export function ghLine({ connection, login }: GhLink): string {
  switch (connection) {
    case 'connected':
      return `Signed in as @${login ?? 'unknown'} through gh`
    case 'signed-out':
      return 'gh is not signed in'
    case 'missing':
      return 'gh is not installed'
    case 'unknown':
      return 'Looking at gh'
  }
}
