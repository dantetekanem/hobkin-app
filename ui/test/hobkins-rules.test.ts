import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ModelChoice } from '#shared/tiers/tiers.ts'
import { CLAUDE_MODELS } from '#shared/protocol/claude-code.ts'
import { HOBKIN_CLAUDE_EFFORTS } from '#shared/protocol/hobkins.ts'
import { LEAD_FOLLOWS, type TiersView } from '../src/features/tiers/host-tiers.ts'
import {
  CLAUDE_EFFORT_CHOICES,
  CLAUDE_MODEL_CHOICES,
  HOME_FOLDER,
  chosenFolder,
  claudeStart,
  engineLabel,
  engineOf,
  engineOffers,
  folderOffers,
  shownChoice,
  startArgs,
} from '../src/features/hobkins/rules.ts'

const models: ModelChoice[] = [
  { id: 'openai/gpt-5', name: 'GPT-5', provider: 'OpenAI', efforts: ['minimal', 'low', 'medium', 'high'] },
  { id: 'openai/gpt-5-mini', name: 'GPT-5 mini', provider: 'OpenAI', efforts: ['low', 'medium'] },
  { id: 'local/plain', name: 'Plain', provider: 'Local', efforts: [] },
]

const tiers: Pick<TiersView, 'config' | 'follows' | 'checks'> = {
  config: {
    lead: { model: 'openai/gpt-5', effort: 'medium' },
    tiers: {
      fast: { model: 'openai/gpt-5-mini', effort: 'low' },
      mid: null,
      high: { model: 'openai/gpt-5', effort: 'high' },
      max: null,
    },
  },
  follows: LEAD_FOLLOWS,
  checks: null,
}

test('the form offers what can run and starts with a folder alone', () => {
  // The four tiers, each with what it runs on now; Custom with Pi's models; Claude Code only while it is installed.
  const offers = engineOffers({ tiers, models, claudeInstalled: false })
  assert.deepEqual(
    offers.filter((offer) => offer.kind === 'tier').map((offer) => [offer.tier, offer.model, offer.effort]),
    [
      ['fast', 'GPT-5 mini', 'low'],
      ['mid', 'GPT-5', 'medium'],
      ['high', 'GPT-5', 'high'],
      ['max', 'GPT-5', 'medium'],
    ],
  )
  assert.deepEqual(offers.map((offer) => offer.kind), ['tier', 'tier', 'tier', 'tier', 'pi'], 'no Claude Code while it is not installed')
  assert.deepEqual(engineOffers({ tiers, models, claudeInstalled: true }).map((offer) => offer.kind), ['tier', 'tier', 'tier', 'tier', 'claude', 'pi'])
  assert.deepEqual(engineOffers({ tiers, models: [], claudeInstalled: true }).map((offer) => offer.kind), ['tier', 'tier', 'tier', 'tier', 'claude'], 'no Custom without a model Pi can reach')

  // A custom model runs at one of its own thinking levels.
  assert.deepEqual(engineOf({ kind: 'pi', model: 'openai/gpt-5-mini', effort: 'high' }, models), { kind: 'pi', model: 'openai/gpt-5-mini', effort: 'medium' }, 'a level it lacks moves to its nearest')
  assert.deepEqual(engineOf({ kind: 'pi', model: 'openai/gpt-5', effort: 'minimal' }, models), { kind: 'pi', model: 'openai/gpt-5', effort: 'minimal' })
  const deepest: ModelChoice = { id: 'ollama/qwen3.6', name: 'qwen3.6', provider: 'Ollama', efforts: ['off', 'low', 'medium', 'high', 'xhigh', 'max'] }
  assert.deepEqual(engineOf({ kind: 'pi', model: deepest.id, effort: 'max' }, [deepest]), { kind: 'pi', model: deepest.id, effort: 'max' }, 'max, for a model that has it')
  assert.deepEqual(engineOf({ kind: 'pi', model: 'local/plain', effort: null }, models), { kind: 'pi', model: 'local/plain', effort: 'off' }, 'a model that does not think runs with thinking off')
  assert.equal(engineOf({ kind: 'pi', model: null, effort: null }, models), null, 'Custom needs a model')
  assert.equal(engineOf({ kind: 'pi', model: 'gone/model', effort: 'low' }, models), null, 'only a model Pi can reach now')
  assert.deepEqual(engineOf({ kind: 'tier', tier: 'high' }, models), { kind: 'tier', tier: 'high' })

  // The folders: the user's home, then each project hobkin knows that has a folder.
  const folders = folderOffers([
    { slug: 'site', name: 'site', state: 'chosen', path: '/Users/someone/code/site' },
    { slug: 'api', name: 'Billing API', state: 'proposed', path: '/Users/someone/code/api' },
    { slug: 'old', name: 'old', state: 'dropped', path: '/Users/someone/code/old' },
    { slug: 'remote', name: 'remote', state: 'chosen', path: null },
    { slug: 'twice', name: 'site again', state: 'chosen', path: '/Users/someone/code/site' },
    'not a project',
  ])
  assert.deepEqual(folders.map(({ cwd, label }) => [cwd, label]), [
    [HOME_FOLDER, 'Home folder'],
    ['/Users/someone/code/site', 'site'],
    ['/Users/someone/code/api', 'Billing API'],
  ])
  assert.deepEqual(folderOffers(undefined).map(({ cwd }) => cwd), [HOME_FOLDER], 'home is there without projects')
  assert.equal(chosenFolder(folders, '/Users/someone/code/api'), '/Users/someone/code/api', 'the last folder chosen, while it is offered')
  assert.equal(chosenFolder(folders, '/Users/someone/code/old'), HOME_FOLDER, 'or home')

  // A folder and something to run on are all it needs: no first message and no name, so Command+N and Enter start one.
  const engine = { kind: 'tier', tier: 'mid' } as const
  assert.deepEqual(startArgs({ cwd: HOME_FOLDER, engine }), { cwd: HOME_FOLDER, engine })
  assert.deepEqual(startArgs({ cwd: ' /Users/someone/code/site ', engine }), { cwd: '/Users/someone/code/site', engine })
  assert.equal(startArgs({ cwd: ' ', engine }), null, 'not without a folder')
  assert.equal(startArgs({ cwd: HOME_FOLDER, engine: null }), null, 'nor without something to run on')

  // How the page names what it runs on.
  assert.equal(engineLabel({ kind: 'tier', tier: 'max' }), 'Max')
  assert.equal(engineLabel({ kind: 'pi', model: 'openai/gpt-5', effort: 'high' }, models), 'GPT-5 · high')
  assert.equal(engineLabel({ kind: 'pi', model: 'gone/model-x', effort: 'low' }, models), 'model-x · low', 'a model Pi no longer lists, by its id')
})

test('the form shows what the user wanted as soon as it can run, and Mid until then', () => {
  // Whether Claude Code is installed, and which models Pi has, are learned after the sheet opens.
  const early = engineOffers({ tiers, models: [], claudeInstalled: false })
  const known = engineOffers({ tiers, models, claudeInstalled: true })
  const claude = { kind: 'claude', model: 'opus', effort: 'high' } as const
  const custom = { kind: 'pi', model: 'openai/gpt-5', effort: 'high' } as const

  // The last hobkin ran on Claude Code: the sheet shows Mid only until Claude Code is known to be there.
  assert.deepEqual(shownChoice(claude, early), { kind: 'tier', tier: 'mid' })
  assert.deepEqual(shownChoice(claude, known), claude)
  assert.deepEqual(shownChoice(custom, early), { kind: 'tier', tier: 'mid' })
  assert.deepEqual(shownChoice(custom, known), custom)
  // A tier always runs, and nothing wanted is Mid.
  assert.deepEqual(shownChoice({ kind: 'tier', tier: 'max' }, early), { kind: 'tier', tier: 'max' })
  assert.deepEqual(shownChoice(null, known), { kind: 'tier', tier: 'mid' })
})

test('Claude Code offers every model and effort, and starts on what the last Claude hobkin used', () => {
  // All of them, in Claude Code's own order.
  assert.deepEqual(CLAUDE_MODEL_CHOICES.map(({ value }) => value), [...CLAUDE_MODELS])
  assert.deepEqual(CLAUDE_EFFORT_CHOICES.map(({ value }) => value), [...HOBKIN_CLAUDE_EFFORTS])

  // What the last Claude hobkin used, else the Claude Code tile's own settings, whose tier effort is Claude Code's default.
  const tile = { model: 'sonnet', effort: 'tier' } as const
  assert.deepEqual(claudeStart({ model: 'opus', effort: 'high' }, tile), { model: 'opus', effort: 'high' })
  assert.deepEqual(claudeStart(null, tile), { model: 'sonnet', effort: 'default' })
  assert.deepEqual(claudeStart(undefined, { model: 'haiku', effort: 'max' }), { model: 'haiku', effort: 'max' })
  assert.deepEqual(claudeStart(null, null), { model: 'default', effort: 'default' }, 'before the tile is read')
  assert.deepEqual(claudeStart({ model: 'gone', effort: 'loud' } as never, tile), { model: 'sonnet', effort: 'default' }, 'a kept choice it no longer has')

  // Choosing Claude Code shows those, and what the user changes then is kept.
  const known = engineOffers({ tiers, models, claudeInstalled: true })
  const start = claudeStart(null, tile)
  assert.deepEqual(shownChoice({ kind: 'claude' }, known, start), { kind: 'claude', model: 'sonnet', effort: 'default' })
  assert.deepEqual(shownChoice({ kind: 'claude', model: 'fable', effort: 'xhigh' }, known, start), { kind: 'claude', model: 'fable', effort: 'xhigh' })

  // It runs on the model and effort chosen, and Claude Code's own where none is.
  assert.deepEqual(engineOf({ kind: 'claude', model: 'opus', effort: 'low' }, models), { kind: 'claude', model: 'opus', effort: 'low' })
  assert.deepEqual(engineOf({ kind: 'claude' }, models), { kind: 'claude', model: 'default', effort: 'default' })

  // Where its engine is named, it says the model and effort that are not the defaults.
  assert.equal(engineLabel({ kind: 'claude' }), 'Claude Code')
  assert.equal(engineLabel({ kind: 'claude', model: 'default', effort: 'default' }), 'Claude Code')
  assert.equal(engineLabel({ kind: 'claude', model: 'opus', effort: 'xhigh' }), 'Claude Code · Opus · extra high')
  assert.equal(engineLabel({ kind: 'claude', model: 'sonnet', effort: 'default' }), 'Claude Code · Sonnet')
  assert.equal(engineLabel({ kind: 'claude', model: 'default', effort: 'low' }), 'Claude Code · low')
})
