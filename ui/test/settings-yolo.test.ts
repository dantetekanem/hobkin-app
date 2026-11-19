import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { YoloState } from '#shared/protocol/work.ts'
import { rateChoices, readyCount, SAMPLE_YOLO, sampleAfter, stillNeeded, yoloSays, yoloValue } from '../src/features/settings/yolo.ts'

const project = (name: string, needs: string[] = []) => ({ slug: name, name, ready: needs.length === 0, needs })

test('the tile says how many projects are ready and what the others need', () => {
  const five: YoloState = {
    on: true,
    rate: 9,
    lowest: 6,
    highest: 10,
    ready: 3,
    projects: [project('api'), project('web'), project('lib'), project('docs', ['Tests: The suite does not run here.']), project('jobs', ['Its readiness has not been checked yet.'])],
  }

  assert.equal(readyCount(five), '3 of 5 projects ready')
  assert.equal(yoloValue(five), 'On · 3 of 5 projects ready')
  assert.deepEqual(stillNeeded(five).map(({ name, needs }) => [name, needs]), [
    ['docs', ['Tests: The suite does not run here.']],
    ['jobs', ['Its readiness has not been checked yet.']],
  ])
  assert.match(yoloSays(five), /rates 9 or more merges and deploys by itself/)
  assert.deepEqual(rateChoices(five), [6, 7, 8, 9, 10])

  const off = sampleAfter(five, { on: false })
  assert.equal(yoloValue(off), 'Off')
  assert.match(yoloSays(off), /Turning this on merges nothing/)
  assert.equal(readyCount({ ...five, ready: 1, projects: [project('api')] }), '1 of 1 project ready')
  assert.equal(readyCount({ ...five, ready: 0, projects: [] }), 'No projects yet')

  // With no host the tile shows sample data, and a click changes it as hobkin would.
  assert.equal(readyCount(SAMPLE_YOLO), '1 of 3 projects ready')
  assert.deepEqual([sampleAfter(SAMPLE_YOLO, { rate: 10 }).rate, sampleAfter(SAMPLE_YOLO, { rate: 10 }).on], [10, true])
})
