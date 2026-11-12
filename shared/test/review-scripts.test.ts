import assert from 'node:assert/strict'
import { test } from 'node:test'
import { captureChange } from '../review/capture.ts'
import { lines, memoryReader, type Tree } from '../review/memory.ts'
import { fileRole } from '../review/paths.ts'
import { prepareReview } from '../review/prepare.ts'
import type { Review } from '../review/types.ts'
import { validateReview } from '../review/validate.ts'
import type { Vicinity } from '../review/vicinity.ts'

test('a file with no extension is code when its first line names Ruby or Node to run it, and a shell script stays a file', () => {
  assert.equal(fileRole('bin/report', '#!/usr/bin/env ruby'), 'code')
  assert.equal(fileRole('bin/report', '#!/usr/local/bin/ruby3.3 -w'), 'code')
  assert.equal(fileRole('bin/tool', '#!/usr/bin/env -S node --no-warnings'), 'code')
  assert.equal(fileRole('bin/setup', '#!/usr/bin/env bash'), 'file')
  assert.equal(fileRole('bin/report'), 'file', 'without its first line, a path with no extension says nothing')
  assert.equal(fileRole('notes.txt', '#!/usr/bin/env ruby'), 'file', 'an extension decides')
})

// A change shaped like rpsleague #78: a new Ruby script with no extension, its test that loads it, and a shell script.
const script = lines(
  '#!/usr/bin/env ruby',
  'require "json"',
  '',
  'class Report',
  '  def self.run(args, out: $stdout)',
  '    out.puts new(args).total',
  '    0',
  '  end',
  '',
  '  def initialize(args)',
  '    @args = args',
  '  end',
  '',
  '  def total',
  '    @args.size',
  '  end',
  'end',
  '',
  'exit Report.run(ARGV) if $PROGRAM_NAME == __FILE__',
)
const testFile = lines(
  'require "minitest/autorun"',
  'require "open3"',
  'load File.expand_path("../../bin/report", __dir__)',
  '',
  'class ReportTest < Minitest::Test',
  '  def test_counts_its_arguments',
  '    assert_equal 0, run_report(["a"])',
  '  end',
  '',
  '  def test_counts_nothing',
  '    assert_failure([])',
  '  end',
  '',
  '  def test_counts_nil',
  '    assert_failure(nil)',
  '  end',
  '',
  '  def test_runs_as_a_command',
  '    _out, _err, status = Open3.capture3(File.expand_path("../../bin/report", __dir__), "a")',
  '    assert status.success?',
  '  end',
  '',
  '  private',
  '',
  '  def run_report(args = ARGV)',
  '    Report.run(args, out: StringIO.new)',
  '  end',
  '',
  '  def assert_failure(args = [])',
  '    refute_equal 1, run_report(args)',
  '  end',
  '',
  '  def sample',
  '    { "id" => 1 }',
  '  end',
  'end',
)
const head: Tree = { 'bin/report': script, 'test/bin/report_test.rb': testFile, 'bin/setup': lines('#!/usr/bin/env bash', 'bundle install') }

async function prepared(vicinity: Vicinity): Promise<Review> {
  return prepareReview({
    id: 'r78',
    change: { project: 'rpg', item: 'b78c1d', title: 'Query production errors', branch: 'hobkin/b78c1d-query-production-errors' },
    capture: await captureChange(memoryReader({}, head), 'base', 'head'),
    spec: null,
    readHead: async (path) => (typeof head[path] === 'string' ? (head[path] as string) : null),
    vicinity,
  })
}

test('a Ruby script with no extension is cut into its definitions, and its tests reach them, through their helpers and by running it', async () => {
  // As the scan reads it: run_report calls Report.run, which makes a Report and calls total; nothing outside calls run.
  const run = { path: 'bin/report', symbol: 'Report.run', startLine: 5, endLine: 8 }
  const review = await prepared({
    links: [
      { near: { changed: { path: 'bin/report', line: 15 } }, other: run, direction: 'caller', hops: 1, call: { line: 6, name: 'total' }, proven: false },
      { near: { changed: { path: 'bin/report', line: 11 } }, other: run, direction: 'caller', hops: 1, call: { line: 6, name: 'new' }, proven: true },
    ],
    tests: [{ changed: { path: 'bin/report', line: 6 }, test: { path: 'test/bin/report_test.rb', symbol: 'ReportTest#run_report', line: 26 } }],
    reach: [{ changed: { path: 'bin/report', line: 6 }, symbol: 'Report.run', hops: 0 }, { changed: { path: 'bin/report', line: 15 }, symbol: 'Report#total', hops: 1 }],
  })
  assert.deepEqual(validateReview(review), [])
  const inScript = review.nodes.filter((node) => node.subtitle === 'bin/report')
  assert.deepEqual(inScript.map((node) => [node.kind, node.title]), [['code', 'run'], ['code', 'initialize'], ['code', 'total']])
  assert.ok(inScript.every((node) => node.unwired === undefined), inScript.map((node) => `${node.title}: ${node.unwired}`).join(', '))
  assert.deepEqual(review.nodes.filter((node) => node.subtitle === 'bin/setup').map((node) => node.kind), ['file'], 'a shell script stays a file')

  const node = (title: string) => review.nodes.find((entry) => entry.title === title)!
  const reaches = (title: string) => review.edges.filter((edge) => edge.from === node(title).id && edge.kind === 'exercises').map((edge) => [review.nodes.find((entry) => entry.id === edge.to)!.title, edge.label ?? null])
  assert.deepEqual(reaches('run_report'), [['run', null]], 'the scan says run_report calls Report.run')
  const [helper] = node('run_report').anchors
  assert.ok(helper && helper.startLine <= 25 && helper.endLine >= 27, `a default argument is no endless method: the body and its end are the helper's, ${JSON.stringify(helper)}`)
  assert.deepEqual(reaches('assert_failure'), [['run', 'through run_report']])
  assert.deepEqual(reaches('counts its arguments').map(([title]) => title), ['run'])
  assert.deepEqual(reaches('counts nothing').map(([title]) => title), ['run'])
  assert.deepEqual(reaches('counts nil').map(([title]) => title), ['run'])
  assert.deepEqual(reaches('runs as a command'), [['run', 'runs bin/report']])
  assert.match(node('sample').unwired ?? '', /reaches none of the code this change touched/, 'a data helper calls none of it')
})
