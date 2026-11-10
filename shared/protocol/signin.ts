/**
 * Where the sign-in stands. Pi owns the flow and the credentials (`ModelRuntime.login`).
 * Nothing here ever holds a token or a key: only what the user needs to see and answer.
 */

/** Something Pi asks during a sign-in. The answer goes back with the `signin.answer` command. A secret is never asked for. */
export interface SignInPrompt {
  id: string
  /** `manual_code` takes the redirect URL pasted from the browser. */
  kind: 'manual_code' | 'text' | 'select'
  message: string
  placeholder?: string
  options?: { id: string; label: string; description?: string }[]
}

export interface SignInProblem {
  /** `port-busy`: another program holds the port Pi listens on for the browser's callback. */
  code: 'port-busy' | 'failed'
  message: string
  /** The provider whose sign-in it was. */
  provider?: string
  port?: number
}

export type SignInState =
  /** Pi has not said yet. */
  | { status: 'unknown' }
  /** Pi can use at least one model. `problem` is a sign-in that failed while another provider kept working. */
  | { status: 'signed-in'; problem?: SignInProblem }
  /** Pi can use no model. */
  | { status: 'signed-out'; problem?: SignInProblem }
  | {
      status: 'signing-in'
      provider: string
      /** The page to approve on. It opens in the system browser. */
      authUrl?: string
      instructions?: string
      prompt?: SignInPrompt
      /** What Pi said along the way, oldest first. */
      lines: string[]
    }

/** Pi's "Sign in with ChatGPT". */
export const OPENAI_PROVIDER = 'openai'
