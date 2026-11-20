/**
 * TLA+ values as the state graph shows them (_specs/050-tla-proofs, "The state graph"). A value is drawn as TLA+ writes
 * it, in Unicode: `"merged"`, `{1, 2}`, `⟨a, b⟩`, `[i1 ↦ 2]`. A lens reads one variable of a state, whole or at one key
 * of a function or record, such as `state[i1]`. Pure, so the tests run it with Node alone.
 */
import type { ProofTraceState, TlaValue } from '#shared/protocol/proofs.ts'

export type StateVars = ProofTraceState['vars']

/** One variable of a state, whole or at one key: `state`, `state[i1]`, `config.limit`. */
export interface Lens {
  variable: string
  key?: string
  label: string
}

const quoted = (text: string) => (text.length >= 2 && text.startsWith('"') && text.endsWith('"') ? text : `"${text}"`)
const pairsOf = (pairs: { key: string; value: TlaValue }[]) => pairs.map(({ key, value }) => `${key} ↦ ${formatValue(value)}`).join(', ')

export function formatValue(value: TlaValue): string {
  switch (value.kind) {
    case 'string':
      return quoted(value.text)
    case 'boolean':
      return value.text.toUpperCase()
    case 'set':
      return `{${value.items.map(formatValue).join(', ')}}`
    case 'sequence':
      return `⟨${value.items.map(formatValue).join(', ')}⟩`
    case 'function':
    case 'record':
      return `[${pairsOf(value.pairs)}]`
    default:
      return value.text
  }
}

const keyed = (value: TlaValue | undefined): value is Extract<TlaValue, { pairs: unknown }> => value?.kind === 'function' || value?.kind === 'record'

/** A key as written, without the quotes a string key may carry, so `["i1"]` and `[i1]` name the same key. */
export const bareKey = (key: string) => key.trim().replace(/^"(.*)"$/, '$1')

function lensLabel(variable: string, key: string | undefined, record: boolean): string {
  if (key == null) return variable
  return record ? `${variable}.${key}` : `${variable}[${key}]`
}

/**
 * Every way to read a state's variables: each function or record at each of its keys, then whole, and every other
 * variable whole, in the order the state lists them.
 */
export function lensesOf(vars: StateVars): Lens[] {
  return vars.flatMap(({ name, value }) => {
    const whole: Lens = { variable: name, label: name }
    if (!keyed(value)) return [whole]
    return [...value.pairs.map(({ key }) => ({ variable: name, key, label: lensLabel(name, key, value.kind === 'record') })), whole]
  })
}

/** The value a lens reads in a state, or undefined when the state has no such variable or key. */
export function lensValue(vars: StateVars, lens: Pick<Lens, 'variable' | 'key'>): TlaValue | undefined {
  const value = vars.find((entry) => entry.name === lens.variable)?.value
  if (lens.key == null) return value
  if (!keyed(value)) return undefined
  const key = bareKey(lens.key)
  return value.pairs.find((pair) => bareKey(pair.key) === key)?.value
}

/** A state's identity: every variable and its value, so the same state from the trace and the dump is one. */
export function stateKey(vars: StateVars): string {
  return [...vars]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map(({ name, value }) => `${name}=${formatValue(value)}`)
    .join('\n')
}

/** The keys a variable's value has, when it is a function or a record. */
export function keysOf(value: TlaValue | undefined): string[] | null {
  return keyed(value) ? value.pairs.map((pair) => pair.key) : null
}

/** The keys that changed from one state to the next, in any variable that is a function or a record. */
export function changedKeys(before: StateVars, after: StateVars): Set<string> {
  const keys = new Set<string>()
  for (const { name, value } of after) {
    const old = before.find((entry) => entry.name === name)?.value
    for (const key of keysOf(value) ?? []) {
      const [now, was] = [lensValue(after, { variable: name, key }), old ? lensValue(before, { variable: name, key }) : undefined]
      if (!was || !now || formatValue(now) !== formatValue(was)) keys.add(key)
    }
  }
  return keys
}

/** `Fix(i1)` is the action `Fix`. */
export const actionName = (action: string) => action.replace(/\(.*$/s, '').trim()

/** 4906 as "4,906". */
export const count = (value: number) => value.toLocaleString('en-US')
