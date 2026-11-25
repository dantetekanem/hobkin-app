import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { junitCases, reportArgs, vitestJsonCases } from '../src/case-reports.ts'

/**
 * Reports captured from real runs of one test file, test/cart.test.ts, that imports test/shared.test.ts: node v26.13.1
 * and v22.22.3 with `--test-reporter=junit`, Bun 1.3.14 with `--reporter=junit`, and Vitest 4.1.12 with
 * `--reporter=json --includeTaskLocation`. Only the checkout's folder (now /repo) and the host's name were changed.
 */
const fixture = (name: string) => readFileSync(new URL(`fixtures/cases/${name}`, import.meta.url), 'utf8')
const PATH = 'test/cart.test.ts'

test("node's JUnit report gives each case of the file its own result, nested as suite > case", () => {
  assert.deepEqual(junitCases(fixture('node-junit.xml'), PATH, '/repo'), [
    { path: PATH, name: 'adds two', status: 'passed' },
    { path: PATH, name: 'cart > rounds the total', status: 'passed' },
    { path: PATH, name: 'cart > empty > has no total', status: 'failed' },
    { path: PATH, name: 'cart > later', status: 'skipped' },
    { path: PATH, name: 'cart > someday', status: 'skipped' },
    { path: PATH, name: 'cart > a "quoted" <name> & a > b', status: 'passed' },
    { path: PATH, name: 'a parent > a child', status: 'passed' },
    // A todo test that throws fails nothing: node exits 0 for it.
    { path: PATH, name: 'fails but todo', status: 'skipped' },
    { path: PATH, name: 'skips inside', status: 'skipped' },
  ])
})

test('a JUnit case is only its own file’s: an imported file’s case, a report without files, or a cut report gives none', () => {
  const xml = fixture('node-junit.xml')
  assert.deepEqual(junitCases(xml, 'test/shared.test.ts', '/repo'), [{ path: 'test/shared.test.ts', name: 'shared case', status: 'passed' }])
  assert.deepEqual(junitCases(xml, PATH, '/elsewhere'), [])
  assert.deepEqual(junitCases(fixture('node22-junit.xml'), PATH, '/repo'), [], 'node 22 names no file for a case')
  assert.deepEqual(junitCases(xml.slice(0, xml.indexOf('<testcase name="twice"')), PATH, '/repo'), [])
  assert.deepEqual(junitCases('', PATH, '/repo'), [])
})

test("Bun's JUnit report gives each case its result and line, inside the suite that is its file", () => {
  assert.deepEqual(junitCases(fixture('bun-junit.xml'), PATH, '/repo'), [
    // Bun files an imported file's case under the file that imports it, at the case's line in its own file.
    { path: PATH, name: 'shared case', status: 'passed', line: 3 },
    { path: PATH, name: 'adds two', status: 'passed', line: 4 },
    { path: PATH, name: 'cart > rounds the total', status: 'passed', line: 9 },
    { path: PATH, name: 'cart > empty > has no total', status: 'failed', line: 13 },
    { path: PATH, name: 'cart > later', status: 'skipped', line: 17 },
    { path: PATH, name: 'cart > someday', status: 'skipped', line: 18 },
    { path: PATH, name: 'cart > a "quoted" <name> & a > b', status: 'passed', line: 19 },
    { path: PATH, name: 'fails but todo', status: 'skipped', line: 25 },
  ])
})

test("Vitest's JSON report gives each case of the file its own result and line", () => {
  assert.deepEqual(vitestJsonCases(fixture('vitest.json'), PATH, '/repo'), [
    // Vitest files an imported file's case under the file that imports it, at the import's line.
    { path: PATH, name: 'shared case', status: 'passed', line: 2 },
    { path: PATH, name: 'adds two', status: 'passed', line: 4 },
    { path: PATH, name: 'cart > rounds the total', status: 'passed', line: 9 },
    { path: PATH, name: 'cart > empty > has no total', status: 'failed', line: 13 },
    { path: PATH, name: 'cart > later', status: 'skipped', line: 17 },
    { path: PATH, name: 'cart > someday', status: 'skipped', line: 18 },
    { path: PATH, name: 'cart > a "quoted" <name> & a > b', status: 'passed', line: 19 },
    { path: PATH, name: 'a parent', status: 'failed', line: 25 },
  ])
})

test('a Vitest case is only its own file’s, and a report that does not parse gives none', () => {
  const json = fixture('vitest.json')
  assert.deepEqual(vitestJsonCases(json, 'test/shared.test.ts', '/repo'), [])
  assert.deepEqual(vitestJsonCases(json.slice(0, -10), PATH, '/repo'), [])
  assert.deepEqual(vitestJsonCases('{"testResults": 3}', PATH, '/repo'), [])
  const unlocated = JSON.stringify({ testResults: [{ name: '/repo/test/cart.test.ts', assertionResults: [{ ancestorTitles: [], title: 'adds two', status: 'passed' }] }] })
  assert.deepEqual(vitestJsonCases(unlocated, PATH, '/repo'), [{ path: PATH, name: 'adds two', status: 'passed' }])
})

test('each runner keeps the output it prints and also writes its report to the file', () => {
  assert.deepEqual(reportArgs({ runner: 'node' }, '/tmp/r/cases'), ['--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=junit', '--test-reporter-destination=/tmp/r/cases'])
  assert.deepEqual(reportArgs({ runner: 'bun' }, '/tmp/r/cases'), ['--reporter=junit', '--reporter-outfile=/tmp/r/cases'])
  assert.deepEqual(reportArgs({ runner: 'vitest', lines: true }, '/tmp/r/cases'), ['--reporter=default', '--reporter=json', '--outputFile.json=/tmp/r/cases', '--includeTaskLocation'])
  assert.deepEqual(reportArgs({ runner: 'vitest', lines: false }, '/tmp/r/cases'), ['--reporter=default', '--reporter=json', '--outputFile.json=/tmp/r/cases'])
})
