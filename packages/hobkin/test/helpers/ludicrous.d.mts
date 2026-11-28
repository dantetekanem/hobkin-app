/** What the host's Ludicrous test uses of hobkin's own Ludicrous test home (`ludicrous.mjs` beside this file). */

export interface FakePi {
  args: string[]
  env: Record<string, string>
  cwd: string
  pid: number
  done: boolean
  finish(result?: { code?: number | null; signal?: string | null; error?: string | null }): void
}

export interface LudicrousHome {
  root: string
  folder: string
  pis: { started: FakePi[]; running(): FakePi[] }
  conductor(change?: Record<string, unknown>): { tick(): Promise<void>; view(): unknown }
  ticks(conductor: { tick(): Promise<void> }, count?: number): Promise<void>
  building(plan: unknown, given?: { statuses?: Record<string, unknown>; queues?: Record<string, unknown[]> }): Promise<unknown>
}

export function ludicrousHome(t: { after(fn: () => void): void }, options?: { origin?: boolean; tier?: number }): LudicrousHome
export const PLAN: unknown
