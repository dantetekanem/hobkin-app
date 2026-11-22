import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CLAUDE_CODE_DEFAULTS, type ClaudeCodeStatus } from '../protocol/claude-code.ts'
import {
  CLAUDE_LEVELS,
  changeClaudeCodeSettings,
  chooseLevel,
  chooseModel,
  claudeChoices,
  claudeCodeWithTiers,
  claudeGroup,
  claudeTierName,
  claudeTiersChange,
  claudeTiersOf,
  followAgain,
  shownClaude,
  type TiersDraft,
} from '../tiers/claude-code.ts'
import type { ModelChoice } from '../tiers/tiers.ts'

const FOUND: ClaudeCodeStatus = { installed: true, version: '2.1.323', signedIn: true, authMethod: 'claude.ai', plan: 'max' }
const MISSING: ClaudeCodeStatus = { installed: false, version: null, signedIn: null, authMethod: null, plan: null }
const keeping = { ...CLAUDE_CODE_DEFAULTS, tiers: {} }

const PI: ModelChoice = { id: 'openai-codex/gpt-6-sol', name: 'gpt-6-sol', provider: 'ChatGPT', efforts: ['off', 'low', 'medium', 'high', 'xhigh'] }
const DRAFT: TiersDraft = {
  config: {
    lead: { model: 'openai-codex/gpt-6.1-sol', effort: 'medium' },
    tiers: { fast: { model: 'openai-codex/gpt-6-luna', effort: 'off' }, mid: null, high: { model: 'anthropic/claude-opus-5-5', effort: 'high' }, max: null },
  },
  claude: {},
}
const opus = claudeChoices().find((choice) => choice.name === 'opus')!

test('the Claude Code group is offered only when the host keeps tiers on it and found Claude Code', () => {
  // No host yet, and a host from before that reports no tiers: no group at all, so nothing is offered that cannot be kept.
  assert.equal(claudeGroup('high', null), null)
  assert.equal(claudeGroup('high', { status: FOUND, settings: CLAUDE_CODE_DEFAULTS }), null)

  assert.deepEqual(claudeGroup('high', { status: FOUND, settings: keeping }), { offered: true })
  const missing = claudeGroup('high', { status: MISSING, settings: keeping })
  assert.equal(missing?.offered, false)
  assert.match(missing && !missing.offered ? missing.note : '', /not installed on this Mac/)

  // The lead runs in Pi: its list says so where the group would be, found or not.
  for (const status of [FOUND, MISSING]) {
    const lead = claudeGroup('lead', { status, settings: keeping })
    assert.equal(lead?.offered, false)
    assert.match(lead && !lead.offered ? lead.note : '', /Pi/)
  }

  // The group is Claude Code's models, each thinking at Claude Code's levels.
  assert.deepEqual(
    claudeChoices().map((choice) => [choice.provider, choice.name]),
    [['Claude Code', 'Account default'], ['Claude Code', 'opus'], ['Claude Code', 'sonnet'], ['Claude Code', 'haiku'], ['Claude Code', 'fable']],
  )
  assert.ok(claudeChoices().every((choice) => choice.efforts === CLAUDE_LEVELS))
})

test("choosing a Claude model keeps the tier's Pi model, and a Pi model takes Claude Code off", () => {
  const onClaude = chooseModel(DRAFT, 'high', opus, { model: 'anthropic/claude-opus-5-5', effort: 'high' })
  assert.deepEqual(onClaude.draft.config, DRAFT.config, "hobkin's tiers are untouched")
  assert.deepEqual(onClaude.draft.claude, { high: { model: 'opus', effort: 'high' } })
  assert.equal(onClaude.effortMovedFrom, null)

  // A level Claude Code does not have moves to the nearest it has, as spec 033 maps a tier's level, and says so.
  const fromOff = chooseModel(DRAFT, 'fast', opus, { model: 'openai-codex/gpt-6-luna', effort: 'off' })
  assert.deepEqual(fromOff.draft.claude, { fast: { model: 'opus', effort: 'low' } })
  assert.equal(fromOff.effortMovedFrom, 'off')

  // A Pi model takes Claude Code off and starts from the level the card showed.
  const shown = shownClaude(onClaude.draft.claude, 'high')!
  const back = chooseModel({ ...onClaude.draft, claude: { ...onClaude.draft.claude, high: { model: 'opus', effort: 'xhigh' } } }, 'high', PI, { ...shown, effort: 'xhigh' })
  assert.deepEqual(back.draft.claude, {})
  assert.deepEqual(back.draft.config.tiers.high, { model: 'openai-codex/gpt-6-sol', effort: 'xhigh' })

  // A tier that follows keeps following while it runs on Claude Code; letting it follow again takes Claude Code off.
  const following = chooseModel(DRAFT, 'mid', opus, { model: DRAFT.config.lead.model, effort: 'medium' })
  assert.equal(following.draft.config.tiers.mid, null)
  assert.deepEqual(followAgain(following.draft, 'mid'), DRAFT)

  // The lead never runs on Claude Code.
  assert.deepEqual(chooseModel(DRAFT, 'lead', opus, { model: DRAFT.config.lead.model, effort: 'medium' }), { draft: DRAFT, effortMovedFrom: null })

  // A level chosen on the card is the tier's Claude level while it runs there, and its Pi level otherwise.
  assert.deepEqual(chooseLevel(onClaude.draft, 'high', 'max', shown).claude, { high: { model: 'opus', effort: 'max' } })
  assert.deepEqual(chooseLevel(DRAFT, 'high', 'xhigh', { model: 'anthropic/claude-opus-5-5', effort: 'high' }).config.tiers.high, { model: 'anthropic/claude-opus-5-5', effort: 'xhigh' })

  // Apply sends only what changed, a tier taken off as null, and nothing when nothing did.
  assert.equal(claudeTiersChange({}, {}), null)
  assert.deepEqual(claudeTiersChange({ high: { model: 'opus', effort: 'high' } }, { fast: { model: 'haiku', effort: 'low' } }), { high: null, fast: { model: 'haiku', effort: 'low' } })
})

test("a tier on Claude Code reads so, with Claude Code's levels", () => {
  const shown = shownClaude({ max: { model: 'opus', effort: 'xhigh' } }, 'max')!
  const choice = claudeChoices().find((each) => each.id === shown.model)!
  assert.deepEqual([choice.provider, choice.name, shown.effort, shown.follows], ['Claude Code', 'opus', 'xhigh', null])
  assert.deepEqual(choice.efforts, ['low', 'medium', 'high', 'xhigh', 'max'])
  assert.equal(shownClaude({ max: { model: 'opus', effort: 'xhigh' } }, 'high'), null)
  assert.equal(claudeTierName({ model: 'opus', effort: 'xhigh' }), 'Claude Code · opus')
  assert.equal(claudeTierName({ model: 'default', effort: 'low' }), 'Claude Code · Account default')
})

test('settings from before have no tier on Claude Code, and a change keeps what the host said of them', () => {
  // A file from before this change.
  const old = { enabled: true, kinds: { work: true, sessions: false, routines: true }, model: 'sonnet', effort: 'tier', permissions: 'ask' }
  assert.deepEqual(claudeCodeWithTiers(old), { ...old, tiers: {} })
  assert.deepEqual(claudeCodeWithTiers(null), keeping)
  // Anything that is not a tier with a Claude model and level is left out.
  assert.deepEqual(claudeCodeWithTiers({ tiers: { high: { model: 'opus', effort: 'max' }, mid: { model: 'gpt', effort: 'high' }, fast: { model: 'haiku', effort: 'off' }, lead: { model: 'opus', effort: 'low' } } }).tiers, {
    high: { model: 'opus', effort: 'max' },
  })

  // A host from before reports none, and the window's own changes never make it look as if it kept them.
  assert.equal(claudeTiersOf(CLAUDE_CODE_DEFAULTS), null)
  assert.deepEqual(claudeTiersOf(keeping), {})
  assert.equal(claudeTiersOf(changeClaudeCodeSettings(CLAUDE_CODE_DEFAULTS, { model: 'opus' })), null)

  const saved = changeClaudeCodeSettings(keeping, { tiers: { high: { model: 'opus', effort: 'max' } } })
  assert.deepEqual(saved.tiers, { high: { model: 'opus', effort: 'max' } })
  const tileChange = changeClaudeCodeSettings(saved, { enabled: true })
  assert.deepEqual([tileChange.enabled, tileChange.tiers], [true, { high: { model: 'opus', effort: 'max' } }])
  assert.deepEqual(changeClaudeCodeSettings(saved, { tiers: { high: null } }).tiers, {})
})
