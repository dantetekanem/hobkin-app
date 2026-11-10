import { create } from 'zustand'
import type { RoutineTemplate } from './types.ts'

/**
 * Writing a routine stays a conversation with hobkin (010-routines). The screen never writes a prompt
 * itself: it suggests a message, and the message input picks it up. The frame wires this store to the
 * composer; until then the suggestion waits here.
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

/** For the composer: the waiting suggestion, which is then gone. */
export function takeSuggestion(): RoutineSuggestion | null {
  const { suggestion } = useRoutineSuggestion.getState()
  if (suggestion) useRoutineSuggestion.setState({ suggestion: null })
  return suggestion
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
