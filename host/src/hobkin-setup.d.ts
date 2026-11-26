/**
 * The part of `hobkin setup` the setup's review reads git and gh through, typed here because hobkin ships plain
 * JavaScript. Paths and signatures are those of `packages/hobkin` on `main`.
 */

declare module 'hobkin/src/cli/setup.mjs' {
  /** What a program printed, or that it failed: `absent` when it is not there at all. */
  export type Asked = { text: string; failed?: undefined; absent?: undefined } | { text?: undefined; failed: true; absent: boolean }
  export type Ask = (command: string, args: readonly string[]) => Promise<Asked>
  /** Turns a runner that throws as execFile does into an ask that never throws. */
  export function askWith(exec: (command: string, args: readonly string[]) => Promise<string>): Ask

  /** `no-tools`: the Mac's /usr/bin/git stands in for command line tools it does not have. */
  export type GitState = { found: true; version: string | null } | { found: false; why: 'absent' | 'failed' | 'no-tools' }
  export function gitState(ask: Ask, options?: { which?: (name: string) => string | null; platform?: NodeJS.Platform }): Promise<GitState>
  export function ghState(ask: Ask): Promise<{ installed: boolean; signedIn: boolean }>
}
