import type { SetupSaved } from '#shared/protocol/setup.ts'

/**
 * How the setup's questions are asked, and code's three, as 025 asked them: where the projects live, which ones, and
 * validation. The goals' questions are in `goals.ts`. See _specs/025-onboarding and _specs/044-goal-first-setup.
 */

/** What every question has. Its id is kept with the answer, so it never changes once people have answered it. */
interface Asked {
  id: string
  ask: string
}

/**
 * A question hobkin asks for the routines, by how it is answered: words that are typed, a folder that is typed, the
 * projects found in that folder to pick from, a list of things to pick from, or a yes or a no.
 */
export type Question =
  /** Answered in the person's own words, in a field. */
  | (Asked & { kind: 'typed'; placeholder: string })
  | (Asked & { kind: 'folder'; placeholder: string; suggestions: readonly string[] })
  /** `in` is the id of the question whose answer is the folder to look in. */
  | (Asked & { kind: 'projects'; in: string })
  | (Asked & { kind: 'pick'; options: readonly string[] })
  /** `yes` and `no` are the words on the two bubbles, and the answer that is kept. */
  | (Asked & { kind: 'yes'; yes: string; no: string })

/** Left empty, no folder is looked in, so the field shows no folder as if it were the answer. */
const WHERE_PROJECTS_LIVE: Question = {
  id: 'projects-folder',
  ask: 'Where do your projects live? Give me the folder.',
  kind: 'folder',
  placeholder: 'Type a folder, or pick one above',
  suggestions: ['~/Projects', '~/Developer', '~/Code', '~/src'],
}

const WHICH_PROJECTS: Question = { id: 'projects', ask: 'Which ones should I run? Pick as many as you like.', kind: 'projects', in: 'projects-folder' }

const VALIDATION: Question = {
  id: 'validation',
  ask: 'Should I set up validation for them? That is what I run before I call work done.',
  kind: 'yes',
  yes: 'Set it up',
  no: 'Later',
}

/** What code asks (044-goal-first-setup), as 025 asked it: where the projects live, which ones, and validation. */
export const CODE_QUESTIONS: readonly Question[] = [WHERE_PROJECTS_LIVE, WHICH_PROJECTS, VALIDATION]

/** Made-up projects for a browser tab on sample data, which has no folder to look in. More than fit at once, so the filter has something to do. */
export const SAMPLE_PROJECTS: readonly string[] = [
  'my-blog', 'dotfiles', 'recipes', 'home-server', 'cli-tools', 'budget', 'notes', 'garden-sensors', 'photo-wall', 'reading-list',
  'weather-station', 'chess-bot', 'pixel-editor', 'synth', 'trail-maps', 'bookmarks', 'habit-tracker', 'ledger', 'wiki', 'tiny-db',
  'ray-tracer', 'feed-reader', 'card-game', 'api-gateway', 'landing-page', 'design-system', 'docs', 'mobile-app', 'scraper', 'bot',
  'journal', 'timers', 'door-bell', 'plant-care', 'movie-night', 'gift-list', 'run-log', 'pantry', 'tax-helper', 'resume',
  'talks', 'workshop', 'playground', 'sandbox', 'experiments', 'archive', 'backup-scripts', 'fonts', 'icons', 'keyboard',
  'laser-maze', 'lunar-lander', 'music-box', 'night-light', 'origami', 'postcards',
]

const partsOf = (written: string): string[] => written.split(',').map((part) => part.trim()).filter(Boolean)
const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase()

/** The suggestions that are in what is written, however they were typed. */
export function pickedSuggestions(written: string, suggestions: readonly string[]): string[] {
  const parts = partsOf(written)
  return suggestions.filter((suggestion) => parts.some((part) => same(part, suggestion)))
}

/** Picking a suggestion adds it to what is written, after a comma. Picking one that is there takes it out. */
export function toggleSuggestion(written: string, suggestion: string): string {
  const parts = partsOf(written)
  const kept = parts.filter((part) => !same(part, suggestion))
  return (kept.length < parts.length ? kept : [...parts, suggestion]).join(', ')
}

/** Where a typed answer starts: what was answered this time, or else what was saved the last time the setup ran. */
export function startingReply({ replies }: { replies: Readonly<Record<string, string | undefined>> }, earlier: SetupSaved | null, id: string): string {
  return replies[id] ?? earlier?.answers.find((answer) => answer.id === id)?.answer ?? ''
}
