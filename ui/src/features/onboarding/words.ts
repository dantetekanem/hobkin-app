import type { Effort } from '#shared/tiers/tiers.ts'
import type { Mood } from '@/avatar/moods.tsx'
import type { Step } from './flow.ts'

/** Pi's thinking levels in plain words, for the first settings. */
export const THINKING_WORDS: Record<Effort, string> = {
  off: 'no thinking',
  minimal: 'barely thinks',
  low: 'thinks a little',
  medium: 'thinks it through',
  high: 'thinks hard',
  xhigh: 'thinks as hard as it can',
}

/** The character's face on each step. */
export const STEP_MOODS: Record<Step, Mood> = {
  welcome: 'hello',
  about: 'thinking',
  connect: 'listening',
  settings: 'working',
  ready: 'celebrating',
}

/** What each step is called, for the dots and for screen readers. */
export const STEP_TITLES: Record<Step, string> = {
  welcome: 'Welcome',
  about: 'What hobkin does',
  connect: 'Connect a model',
  settings: 'First settings',
  ready: 'Ready',
}
