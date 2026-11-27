import { create } from 'zustand'
import type { RoutineTemplate } from './types.ts'

/**
 * Writing a routine stays a conversation with hobkin (010-routines). The screen never writes a prompt
 * itself: it suggests a message, and the message input picks it up (`watchRoutineSuggestion`). Until an
 * input is there, the suggestion waits here.
 */
export interface RoutineSuggestion {
  /** Changes with every suggestion, so the same text asked twice still counts as new. */
  id: number
  text: string
}

interface SuggestionState {
  suggestion: RoutineSuggestion | null
}

export const useRoutineSuggestion = create<SuggestionState>()(() => ({ suggestion: null }))

let made = 0

/** Puts a message on the store for the message input to take. */
export function suggestMessage(text: string): void {
  made += 1
  useRoutineSuggestion.setState({ suggestion: { id: made, text } })
}

/** The message input, as far as taking a suggestion goes: its words are replaced, and nothing is sent. */
interface Draft {
  getState(): { change(action: { type: 'typed'; text: string }): void }
}

/**
 * Puts each suggestion in the draft and hands the input the keyboard, once: the suggestion is cleared as it is taken,
 * so an input drawn again never puts an old one back. One made before an input was there is taken when it comes.
 */
export function watchRoutineSuggestion(draft: Draft, focus: () => void): () => void {
  const take = () => {
    const { suggestion } = useRoutineSuggestion.getState()
    if (!suggestion) return
    useRoutineSuggestion.setState({ suggestion: null })
    draft.getState().change({ type: 'typed', text: suggestion.text })
    focus()
  }
  const unsubscribe = useRoutineSuggestion.subscribe(take)
  take()
  return unsubscribe
}

/** The one action of the empty screen: ask hobkin for a first routine. */
export function askForFirstRoutine(): void {
  suggestMessage('Help me set up my first routine. Ask me what it should check and when it should run.')
}

export function askForNewRoutine(): void {
  suggestMessage('Help me set up a new routine. Ask me what it should check and when it should run.')
}

export function askForTemplate(template: RoutineTemplate): void {
  suggestMessage(`Set up the ${template.title} routine from your templates. Ask me what it needs.`)
}

export function askToFix(file: string, problem: string): void {
  suggestMessage(`The routine file ${file} does not load: ${problem}. Can you fix it?`)
}
