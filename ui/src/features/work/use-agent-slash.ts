import { useEffect, useId, useMemo, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react'
import type { SlashAgent, SlashCommand } from '#shared/protocol/slash.ts'
import { changeTarget } from '@/app/agent-model.ts'
import { findAgent } from '@/app/running-agents.ts'
import type { ChangeTarget } from '@/features/chat/send-change.ts'
import { closedSlash, slashList, type SlashKey, type SlashState } from '@/features/chat/slash.ts'
import { slashRowId, type SlashPanelProps } from '@/features/chat/SlashPanel.tsx'
import { runCommand } from '@/lib/host/index.ts'
import { agentCommands, agentSlashKey, agentSlashSent, type AgentSlashKeyResult, type AgentSlashRun } from './agent-slash.ts'

const LIST_KEYS: readonly string[] = ['ArrowDown', 'ArrowUp', 'Tab', 'Enter', 'Escape'] satisfies SlashKey[]

interface AgentSlashOptions {
  /** Whose own session the commands are for, or null for a sample agent, which has none. */
  agent: SlashAgent | null
  /** What the message box holds, and how to change it. */
  text: string
  setText: (text: string) => void
  /** Whether the box takes messages now. A finished agent's lists nothing. */
  open: boolean
  /** A command was chosen: the choice of tier or model to open, or one of Pi's to run. */
  onRun: (run: AgentSlashRun) => void
}

/**
 * The list of commands over an agent's message box, as the main chat has it over its own: what Pi offers that agent's
 * session, asked when the page opens, each time a message starts with a slash and after a command ran, plus the
 * window's /model and /effort. The keyboard stays in the box, which is the list's combobox.
 */
export function useAgentSlash({ agent, text, setText, open, onRun }: AgentSlashOptions) {
  const [pi, setPi] = useState<readonly SlashCommand[]>([])
  // The list's state for the text it was made for. New text opens the list again, on the best match.
  const [kept, setKept] = useState<{ text: string; state: SlashState }>({ text, state: closedSlash })
  const [ran, setRan] = useState(0)
  const listId = useId()
  const commands = useMemo(() => agentCommands(pi), [pi])
  const state = kept.text === text ? kept.state : closedSlash
  const list = open ? slashList(text, commands, state) : null

  const who = agent && ('run' in agent ? `run:${agent.run}` : `hobkin:${agent.hobkin}`)
  const typing = text.startsWith('/')
  useEffect(() => {
    if (!agent || !open) return
    let current = true
    runCommand('slash.list', agent).then(
      ({ commands: listed }) => current && setPi(listed),
      // Without the list a slash is the start of a message, as before the agent's session could be asked.
      () => {},
    )
    return () => {
      current = false
    }
    // `who` names the agent, so a new object for the same one asks nothing.
  }, [who, open, typing, ran])

  const apply = (result: AgentSlashKeyResult) => {
    setKept({ text: result.text ?? text, state: result.state })
    if (result.text !== undefined) setText(result.text)
    if (result.run) onRun(result.run)
  }

  /** The list's keys come first while it is open. True when the key was the list's. */
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!list || event.nativeEvent.isComposing) return false
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
    const result = plain && LIST_KEYS.includes(event.key) ? agentSlashKey({ text, commands, state }, event.key as SlashKey) : null
    // The frame leaves Tab to an open list, so with nothing to complete it must not walk the keyboard out of the box.
    if (!result && event.key !== 'Tab') return false
    event.preventDefault()
    if (result) apply(result)
    return true
  }

  const reach = (index: number) => setKept({ text, state: { ...state, selected: index } })
  const panel: SlashPanelProps = {
    list,
    id: listId,
    onReach: reach,
    onChoose: (index) => {
      const result = agentSlashKey({ text, commands, state: { ...state, selected: index } }, 'Enter')
      if (result) apply(result)
    },
  }

  // While the list is open the box is its combobox, which is also how the frame knows to leave Tab to the list.
  const inputProps = list
    ? {
        role: 'combobox',
        'aria-expanded': true,
        'aria-controls': listId,
        'aria-autocomplete': 'list' as const,
        'aria-activedescendant': list.selected === null ? undefined : slashRowId(listId, list.selected),
      }
    : {}

  return {
    panel,
    inputProps,
    onKeyDown,
    /** What a finished message does when it is a command, or null when it is a message. */
    sent: (message: string) => agentSlashSent(message, commands),
    /** A command ran: its count changed, which can change the order of the list. */
    counted: () => setRan((count) => count + 1),
  }
}

interface PageSlashOptions extends Omit<AgentSlashOptions, 'onRun' | 'setText'> {
  /** The agent's id in the window's lists: a run's id, or a durable hobkin's agent id. */
  agentId: string
  setText: Dispatch<SetStateAction<string>>
  /** The lines under the box: why not, or what was done. */
  setProblem: (why: string | null) => void
  setSaid: (said: string | null) => void
  /** Pi took the command as a message, as it takes a template or a skill: the page shows it as sent. */
  onSent: (words: string, sent: { run: string; started: boolean }) => void
}

/**
 * The commands of an agent's page, whole: the list over its message box, /model opening the choice of tier or model
 * the dock's pill has (`AgentSlashOver` draws both), and Pi's commands run in the agent's own session, with what came
 * of each said under the box.
 */
export function usePageSlash({ agentId, agent, text, setText, open, setProblem, setSaid, onSent }: PageSlashOptions) {
  // Where /model's choice sends a change, once it was opened, and whether it is open now.
  const [target, setTarget] = useState<ChangeTarget | null>(null)
  const [choosing, setChoosing] = useState(false)

  const runPi = async (name: string, args: string) => {
    if (!agent) return
    const words = args ? `${name} ${args}` : name
    setText('')
    try {
      const done = await runCommand('slash.run', { name, ...(args ? { args } : {}), ...agent })
      if (done.sent) onSent(words, done.sent)
      if (done.said) setSaid(done.said)
      slash.counted()
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
      // Nothing ran: the words come back to the box, unless the user has written again.
      setText((now) => now || words)
    }
  }

  const run = (asked: AgentSlashRun) => {
    setProblem(null)
    setSaid(null)
    if (asked.kind === 'pi') return void runPi(asked.name, asked.args)
    // The agent as it is now: one on Claude Code, or a run that waits for its time, says why it keeps its model.
    const found = findAgent(agentId)
    const offer = found ? changeTarget(found) : { why: 'It has left the list, so it has no model to change.' }
    if ('why' in offer) return setProblem(offer.why)
    setTarget(offer.target)
    setChoosing(true)
  }

  const slash = useAgentSlash({ agent, text, setText, open, onRun: run })
  return {
    panel: slash.panel,
    inputProps: slash.inputProps,
    onKeyDown: slash.onKeyDown,
    /** A finished message that is a command runs as one. True when it was. */
    sendCommand: (message: string): boolean => {
      const asked = slash.sent(message)
      if (!asked) return false
      setText('')
      run(asked)
      return true
    },
    choice: { target, open: choosing, onOpenChange: setChoosing },
  }
}

export type PageSlash = ReturnType<typeof usePageSlash>
