import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  cardRows,
  changeCard,
  changeFields,
  checkChange,
  dropCard,
  firstRunOf,
  keepCard,
  keptCards,
  KEPT_MAX,
  NO_PICKS,
  routinesSaid,
  routinesWritten,
  templateKey,
  WRITING_WAIT,
  writeRequest,
  writingOver,
  type Card,
  type CardPicks,
  type CardRow,
  type GoalCards,
  type NamedRoutine,
  type Writing,
} from '../src/features/onboarding/cards.ts'
import { asksComputer, GOAL_WORDS, GOALS, goalQuestions, goalsOf, projectStart } from '../src/features/onboarding/goals.ts'
import { sampleGoalCards } from '../src/features/onboarding/sample-cards.ts'

/** A card as `setup.watchers` gives it, with every part a template of hobkin's has. */
const card = (id: string, over: Partial<Card> = {}): Card => ({
  id,
  version: 1,
  source: 'hobkin',
  title: `Title of ${id}`,
  summary: `What ${id} watches.`,
  needs: ['mail', 'calendar'],
  recurrence: 'Weekday mornings',
  tells: `When ${id} changes.`,
  skips: 'Newsletters.',
  gives: ['report', 'action'],
  closes: 'Their word.',
  private: false,
  asks: null,
  effort: 'medium',
  ...over,
})

const keep = (picks: CardPicks, id: string) => keepCard(picks, id).picks

test('the goals are picked by their bubbles in a fixed order, and their own words count as a project and start its answer', () => {
  assert.deepEqual(GOALS, ['job', 'business', 'project', 'life', 'code'])
  const words = (goal: (typeof GOALS)[number]) => GOAL_WORDS[goal].bubble

  assert.deepEqual(goalsOf([words('code'), words('job')]), { goals: ['job', 'code'], own: [] }, 'picked in any order, kept in the goals\' order')
  assert.deepEqual(goalsOf(['a garden app', words('life')]), { goals: ['project', 'life'], own: ['a garden app'] })
  assert.deepEqual(goalsOf([words('project'), 'a garden app']), { goals: ['project'], own: ['a garden app'] }, 'the project counts once')
  assert.deepEqual(goalsOf([]), { goals: [], own: [] })

  assert.equal(projectStart(['a garden app', 'a recipe book']), 'a garden app, a recipe book')
  assert.equal(projectStart([]), '')
})

test('whose computer it is matters only for a job, a business or life, whose routines read the person\'s own accounts', () => {
  assert.equal(asksComputer(['job']), true)
  assert.equal(asksComputer(['business']), true)
  assert.equal(asksComputer(['project', 'life']), true)
  assert.equal(asksComputer(['project', 'code']), false)
  assert.equal(asksComputer([]), false)
})

test('each picked goal asks its own question in the goals\' order, life asks none, and code asks the folder, the projects and validation', () => {
  const ids = (goals: Parameters<typeof goalQuestions>[0]) => goalQuestions(goals).map(({ id }) => id)

  assert.deepEqual(ids(['code', 'project', 'job', 'business']), ['job', 'business', 'project', 'projects-folder', 'projects', 'validation'])
  assert.deepEqual(ids(['life']), [])
  assert.deepEqual(ids([]), [])
  // The code questions are 025's own, answered the way they always were.
  assert.deepEqual(goalQuestions(['code']).map(({ kind }) => kind), ['folder', 'projects', 'yes'])
  assert.ok(goalQuestions(['job', 'business', 'project']).every(({ kind }) => kind === 'typed'))
})

test('a card has the parts its template gives, in order', () => {
  const partsOf = (rows: CardRow[]) => rows.map(({ part }) => part)
  const full = card('job-openings', { needs: ['web access'], gives: ['report', 'critical'], private: true })

  assert.deepEqual(partsOf(cardRows(full, {}, { work: false })), ['watches', 'looks', 'often', 'tells', 'skips', 'gives'])
  // On a work computer a private card says so on a line of its own, last.
  assert.equal(partsOf(cardRows(full, {}, { work: true })).at(-1), 'private')
  assert.equal(partsOf(cardRows(card('money'), {}, { work: true })).includes('private'), false, 'only a private card says it')

  // A template of the person's own that lacks a part leaves its row out.
  const theirs = card('my-check', { source: 'yours', needs: [], tells: null, skips: null, gives: [] })
  assert.deepEqual(partsOf(cardRows(theirs, {}, { work: false })), ['watches', 'often'])

  // The person's changes are what the rows say, and an answer to the template's own question shows under Leaves out.
  const email = card('email', { asks: 'Whose mail should it leave out?' })
  const changes = { recurrence: 'Every evening', skips: 'Mail from school.', answer: 'My sister\'s.' }

  const changed = cardRows(email, changes, { work: false })

  assert.equal(changed.find(({ part }) => part === 'often')?.text, 'Every evening')
  assert.equal(changed.find(({ part }) => part === 'skips')?.text, 'Mail from school.')
  assert.deepEqual(partsOf(changed), ['watches', 'looks', 'often', 'tells', 'skips', 'said', 'gives'])
})

test('a card is kept, changed or dropped, at most five are kept, and one left alone is neither written nor turned down', () => {
  let picks = NO_PICKS
  for (const id of ['a', 'b', 'c', 'd', 'e']) picks = keep(picks, id)
  assert.equal(keptCards([card('a'), card('b'), card('c'), card('d'), card('e'), card('f')], picks).length, KEPT_MAX)

  // A sixth Keep does nothing, and says why.
  const sixth = keepCard(picks, 'f')
  assert.equal(sixth.full, true)
  assert.equal(sixth.picks, picks)

  // Keep again lets a card go, and its place is free again.
  picks = keep(picks, 'a')
  assert.equal(picks.marks.a, undefined)
  assert.equal(keepCard(picks, 'f').full, false)

  // Drop turns a card down, a kept one too, and Undo puts it back as it was left: alone.
  picks = dropCard(picks, 'b')
  assert.equal(picks.marks.b, 'dropped')
  picks = dropCard(picks, 'b')
  assert.equal(picks.marks.b, undefined)
  // Keep on a dropped card keeps it.
  picks = keep(dropCard(picks, 'g'), 'g')
  assert.equal(picks.marks.g, 'kept')
})

test('Change starts from the template\'s words, and keeps only what differs from them', () => {
  const email = card('email', { recurrence: 'Every 2 hours', skips: 'Newsletters.', asks: 'Whose mail should it leave out?' })
  assert.deepEqual(changeFields(email, {}), [
    { part: 'often', label: 'How often', start: 'Every 2 hours' },
    { part: 'skips', label: 'Leaves out', start: 'Newsletters.' },
    { part: 'answer', label: 'Whose mail should it leave out?', start: '' },
  ])
  // Without a question of its own, Change has only the first two.
  assert.deepEqual(changeFields(card('money', { asks: null }), {}).map(({ part }) => part), ['often', 'skips'])

  let picks = changeCard(NO_PICKS, email, { often: ' Every evening ', skips: 'Newsletters.', answer: '' })
  assert.deepEqual(picks.changes.email, { recurrence: 'Every evening' }, 'trimmed, and the same words are no change')
  assert.equal(picks.marks.email, undefined, 'saving a change neither keeps nor drops the card')
  // Fields open again where the change left them.
  assert.equal(changeFields(email, picks.changes.email ?? {})[0]?.start, 'Every evening')

  // Emptied, Leaves out leaves nothing out. Put back to the template's words, there is no change left.
  picks = changeCard(picks, email, { often: 'Every 2 hours', skips: '', answer: 'Mine only' })
  assert.deepEqual(picks.changes.email, { skips: '', answer: 'Mine only' })
  picks = changeCard(picks, email, { often: 'Every 2 hours', skips: 'Newsletters.', answer: '' })
  assert.equal(picks.changes.email, undefined)

  assert.equal(checkChange('x'.repeat(600)), null)
  assert.match(checkChange('x'.repeat(601)) ?? '', /600/)
})

const groups: GoalCards[] = [
  { goal: 'job', starters: [card('job-openings'), card('job-applications', { private: true }), card('interviews')], more: [card('reading')] },
  { goal: 'project', starters: [card('project-milestones'), card('deadlines-ahead', { version: 3 })], more: [] },
]

test('the writing message names the goals, each kept card by template and version with its changes, the ones turned down and the guide\'s section, and none goes with nothing kept', () => {
  let picks = keep(keep(NO_PICKS, 'job-openings'), 'deadlines-ahead')
  picks = changeCard(picks, card('job-openings'), { often: 'Twice a week', skips: 'Contract roles.', answer: '' })
  picks = dropCard(picks, 'interviews')
  const answers = [{ id: 'job', ask: 'What kind of job are you after?', answer: 'Product design in Toronto' }]

  const message = writeRequest({ goals: ['job', 'project'], answers, cards: groups, picks, checks: false })
  assert.ok(message)
  assert.match(message, /a new job and a project/)
  assert.match(message, /What kind of job are you after\?\n {2}Product design in Toronto/)
  assert.match(message, /job-openings@1.*\n {2}How often: Twice a week\n {2}Leaves out: Contract roles\./)
  assert.match(message, /deadlines-ahead@3/)
  assert.match(message, /turned down.*interviews@1/s)
  assert.match(message, /From the app's setup/)
  assert.match(message, /hobkin setup/)
  assert.match(message, /turn each routine on/i)
  assert.match(message, /ask me before you connect anything/i)
  assert.match(message, /run none of them/i)
  // A card left alone is neither written nor turned down, so the message does not name it.
  assert.doesNotMatch(message, /job-applications|reading|project-milestones/)
  // The projects' checks are asked for only when code's validation was said yes to with projects picked.
  assert.doesNotMatch(message, /directions\.md/)
  assert.match(writeRequest({ goals: ['code'], answers: [], cards: groups, picks, checks: true }) ?? '', /directions\.md/)

  assert.equal(writeRequest({ goals: ['job'], answers, cards: groups, picks: dropCard(NO_PICKS, 'interviews'), checks: false }), null)
})

const routine = (id: string, template: string | undefined, enabled = true): NamedRoutine => ({ id, title: `Routine ${id}`, ...(template ? { template } : {}), enabled })

test('what hobkin says it wrote is true to the routines that name the kept templates', () => {
  const kept = [card('job-openings'), card('interviews'), card('deadlines-ahead', { version: 3 })]
  const before = [routine('old-deadlines', 'deadlines-ahead@3'), routine('inbox', undefined)]
  const now = [
    before[0]!,
    // Rewritten from a kept card since, so written now.
    routine('inbox', 'interviews@1'),
    routine('roles', 'job-openings@1'),
    routine('other-version', 'interviews@2'),
    routine('not-kept', 'money@1'),
    routine('by-hand', undefined),
  ]

  // One that named its template before the message went was not written now. Another version is another template.
  const written = routinesWritten(kept, now, before)
  assert.deepEqual(written.map(({ card: one, routine: made }) => [one.id, made.id]), [['job-openings', 'roles'], ['interviews', 'inbox']], 'in card order')

  assert.equal(templateKey(card('deadlines-ahead', { version: 3 })), 'deadlines-ahead@3')

  // All, some, or none, said in one bubble.
  assert.notEqual(routinesSaid(3, 3), routinesSaid(3, 1))
  assert.notEqual(routinesSaid(3, 1), routinesSaid(3, 0))
  assert.match(routinesSaid(3, 3), /three/)
  assert.match(routinesSaid(3, 2), /two of the three/)
})

test('the writing is over when every kept card has its routine, hobkin stops with nothing open, the person says enough, the message did not go, or nothing was asked for two minutes', () => {
  const at = 1_000_000
  const going: Writing = { takenAt: at, failed: false, busy: true, open: false, enough: false, stirredAt: at, kept: 3, written: 1 }
  assert.equal(writingOver(going, at + 1000), false)

  assert.equal(writingOver({ ...going, written: 3 }, at + 1000), true)
  assert.equal(writingOver({ ...going, enough: true }, at + 1000), true)
  assert.equal(writingOver({ ...going, takenAt: null, failed: true }, at + 1000), true)
  // Not working right after the message is not yet stopping: it may not have started.
  assert.equal(writingOver({ ...going, busy: false }, at + WRITING_WAIT.startMs - 1), false)
  assert.equal(writingOver({ ...going, busy: false }, at + WRITING_WAIT.startMs), true)
  // An open question waits for the person, however long they take.
  assert.equal(writingOver({ ...going, busy: false, open: true }, at + WRITING_WAIT.quietMs * 3), false)
  // Two minutes with nothing asked, even while it says it works.
  assert.equal(writingOver(going, at + WRITING_WAIT.quietMs), true)
  // While the message is on its way, only the two minutes end it.
  assert.equal(writingOver({ ...going, takenAt: null, busy: false }, at + WRITING_WAIT.startMs), false)
})

test('the first run offered is the written routine with the lowest effort, and only a real model with a routine written offers one', () => {
  const pairs = [
    { card: card('job-openings', { effort: 'high' }), routine: routine('roles', 'job-openings@1') },
    { card: card('interviews', { effort: 'low' }), routine: routine('talks', 'interviews@1', false) },
    { card: card('email', { effort: 'medium' }), routine: routine('mail', 'email@1') },
    { card: card('money', { effort: 'medium' }), routine: routine('cash', 'money@1') },
  ]
  // A routine written turned off is not run. Of the rest the lowest effort, then the first in card order.
  assert.equal(firstRunOf(pairs, true)?.id, 'mail')
  assert.equal(firstRunOf(pairs, false), null, 'not on the scripted host, nor on sample data')
  assert.equal(firstRunOf([], true), null)
  assert.equal(firstRunOf([pairs[1]!], true), null)
})

test('on sample data each card shows once, under the first picked goal that has it, and only picked goals come back', () => {
  const [project, life] = sampleGoalCards(['life', 'project'])

  assert.deepEqual([project?.goal, life?.goal], ['project', 'life'])
  const ids = [project!, life!].flatMap(({ starters, more }) => [...starters, ...more].map(({ id }) => id))
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(project!.starters.some(({ id }) => id === 'deadlines-ahead'))
  assert.equal(life!.starters.length, 2, 'life shows two cards when the project has Deadlines ahead')
})
