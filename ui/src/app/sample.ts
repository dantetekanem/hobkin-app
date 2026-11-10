import type { Mood } from '@/avatar/moods.tsx'
import type { ModelsState } from '#shared/protocol/models.ts'

/**
 * Sample data for the frame. `002-host` replaces these with hobkin's live state.
 * Shapes here are only what the frame needs to draw. They are not the protocol.
 */

export type Tier = 'fast' | 'mid' | 'high' | 'max'

export interface SampleAgent {
  id: string
  title: string
  project: string
  doing: string
  tier: Tier
  /** Hue of the agent's small hood, in degrees. */
  hue: number
  mood: Mood
  kind: 'work' | 'routine' | 'session'
}

export interface SampleProject {
  slug: string
  name: string
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  queued: number
  waiting: number
}

export interface SampleSession {
  id: string
  title: string
  when: string
  messages: number
}

export interface SampleMessage {
  id: string
  role: 'user' | 'hobkin' | 'notice'
  text: string
  tone?: 'useful' | 'critical' | 'blocked' | 'quiet'
}

export const sampleAgents: SampleAgent[] = [
  { id: 'a1', title: 'Fix the login redirect loop', project: 'storefront', doing: 'running the auth tests', tier: 'high', hue: 262, mood: 'working', kind: 'work' },
  { id: 'a2', title: 'Look for dependency updates', project: 'billing-api', doing: 'reading the changelog', tier: 'fast', hue: 200, mood: 'searching', kind: 'work' },
  { id: 'a3', title: 'Morning recap', project: 'routine', doing: 'writing the report', tier: 'mid', hue: 86, mood: 'thinking', kind: 'routine' },
]

export const sampleProjects: SampleProject[] = [
  { slug: 'storefront', name: 'storefront', priority: 'P0', queued: 4, waiting: 2 },
  { slug: 'billing-api', name: 'billing-api', priority: 'P1', queued: 7, waiting: 1 },
  { slug: 'docs-site', name: 'docs-site', priority: 'P2', queued: 2, waiting: 0 },
]

export const sampleSessions: SampleSession[] = [
  { id: 's4', title: 'Planning the review flow', when: 'Yesterday', messages: 42 },
  { id: 's3', title: 'Routines for the release week', when: 'Nov 5', messages: 18 },
  { id: 's2', title: 'Setting up work mode', when: 'Nov 2', messages: 64 },
  { id: 's1', title: 'First conversation', when: 'Oct 28', messages: 23 },
]

export const sampleMessages: SampleMessage[] = [
  { id: 'm1', role: 'user', text: 'What happened overnight?' },
  {
    id: 'm2',
    role: 'hobkin',
    text: 'Two things finished. The login redirect fix is on its branch with passing tests, ready for you to review. The dependency look found one update worth taking in billing-api.',
  },
  { id: 'm3', role: 'notice', tone: 'useful', text: 'Morning recap finished. 3 things worth a look.' },
  { id: 'm4', role: 'user', text: 'Walk me through the redirect fix.' },
  {
    id: 'm5',
    role: 'hobkin',
    text: 'Open it in Review and I will take you through it step by step: what the change promised, the tests that prove it, then the code.',
  },
]

export const sampleStatus = {
  connection: 'sample' as 'sample' | 'live' | 'offline',
  actionItems: 3,
  doing: 'delegating',
  mood: 'idle' as Mood,
  model: 'sample model',
  effort: 'medium',
}

/** Model providers and models, in the shape the host sends, for the frame before a host answers. Names are Pi's. */
export const sampleModels: ModelsState = {
  providers: [
    { id: 'openai', name: 'OpenAI', signIn: { label: 'Sign in with ChatGPT', subscription: true }, apiKey: { label: 'OpenAI API key', env: ['OPENAI_API_KEY'] }, connected: true },
    { id: 'anthropic', name: 'Anthropic', signIn: { label: 'Anthropic (Claude Pro/Max)', subscription: true }, apiKey: { label: 'Anthropic API key', env: ['ANTHROPIC_API_KEY'] }, connected: false },
    { id: 'google', name: 'Google', apiKey: { label: 'Gemini API key', env: ['GEMINI_API_KEY'] }, connected: false },
    { id: 'amazon-bedrock', name: 'Amazon Bedrock', cloud: { label: 'An AWS profile, access keys or a Bedrock bearer token' }, connected: false },
  ],
  models: [
    { id: 'sample-large', provider: 'openai', name: 'Sample large model', thinking: ['low', 'medium', 'high', 'xhigh'], contextWindow: 400000 },
    { id: 'sample-small', provider: 'openai', name: 'Sample small model', thinking: ['off', 'low', 'medium'], contextWindow: 128000 },
  ],
}
