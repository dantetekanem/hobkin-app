import { readFileSync } from 'node:fs'
import { HOBKIN_TITLE_MAX } from '#shared/protocol/hobkins.ts'

/**
 * What the agents the window starts for a change share: a prompt file with `{{places}}` and named parts the host
 * chooses among, a title cut to the limit, and one agent for one change at a time.
 */

export interface PromptFile {
  /** The text before the first named part. */
  main: string
  /** The paragraphs after a line `<!-- name -->`. Throws for a name the file does not have. */
  part: (name: string) => string
}

/** Reads a prompt file in which a line `<!-- name -->` begins a part the host chooses among. */
export function readPromptFile(url: URL): PromptFile {
  const [main = '', ...parts] = readFileSync(url, 'utf8').split(/^<!-- (.+) -->\n/m)
  const file = url.pathname.split('/').pop()
  return {
    main: main.trim(),
    part: (name) => {
      const at = parts.indexOf(name)
      if (at < 0 || at % 2 !== 0) throw new Error(`${file} has no part named ${name}.`)
      return parts[at + 1]!.trim()
    },
  }
}

/** Fills each `{{place}}` from `values`, and throws for a place left with no value. */
export function fill(text: string, values: Record<string, string>): string {
  const filled = text.replace(/\{\{(\w+)\}\}/g, (place, name: string) => values[name] ?? place)
  const left = /\{\{\w+\}\}/.exec(filled)
  if (left) throw new Error(`A prompt has a place with no value: ${left[0]}`)
  return filled
}

/** A title with a lead, cut to the title's limit. */
export const titled = (lead: string, title: string): string => `${lead}: ${title}`.slice(0, HOBKIN_TITLE_MAX).trim()

export interface Started {
  hobkin: string
  run: string | null
  already: boolean
}

/**
 * One agent for one review at a time. `begin` starts it; while it is still there, a second ask starts nothing and
 * answers with it. The agents are kept in this host's memory: a restart forgets them.
 */
export function oneAgentAtATime(exists: (hobkin: string) => Promise<boolean>): (id: string, begin: () => Promise<{ id: string; run: string | null }>) => Promise<Started> {
  const started = new Map<string, string>()
  /** Reviews being started now, so two asks at once start one agent. */
  const starting = new Map<string, Promise<Started>>()
  return async (id, begin) => {
    const pending = starting.get(id)
    if (pending) return { ...(await pending), run: null, already: true }
    const there = started.get(id)
    if (there && (await exists(there))) return { hobkin: there, run: null, already: true }
    const starts = begin().then((hobkin) => {
      started.set(id, hobkin.id)
      return { hobkin: hobkin.id, run: hobkin.run, already: false }
    })
    starting.set(id, starts)
    try {
      return await starts
    } finally {
      starting.delete(id)
    }
  }
}
