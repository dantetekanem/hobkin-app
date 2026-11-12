import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lineKinds } from '../src/comments.ts'

/** Each line's kind, in order, as one string. */
const kinds = (path: string, lines: string[]) => lineKinds(path, lines.join('\n')).join(' ')

test('JavaScript and TypeScript: comments are what the language reads as comments, through strings, templates and regular expressions', () => {
  assert.equal(kinds('src/a.ts', ['/**', ' * Sums the items.', ' */', 'const a = 1 // trailing', '// a line', '', 'const b = 2']), 'comment comment comment code comment blank code')
  // A `*` line is a comment only inside a block comment; elsewhere it continues an expression.
  assert.equal(kinds('src/a.ts', ['const total = price', '  * qty']), 'code code')
  // Inside a template literal every line is the string, a blank one included.
  assert.equal(kinds('src/a.ts', ['const url = `', '  //api.example.com/v1', '', '`', '// after']), 'code code code code comment')
  assert.equal(kinds('src/a.js', ["const url = 'http://example.com' // a comment", '// after']), 'code comment')
  assert.equal(kinds('src/a.js', ['const s = `${`', '//`}`', '// after']), 'code code comment')
  // A regular expression holding `/*` opens no comment; a division before one does not hide it.
  assert.equal(kinds('src/a.js', ['const slashes = /\\/*$/', 'run()']), 'code code')
  assert.equal(kinds('src/a.js', ['const half = a / b /* why */', '// after']), 'code comment')
  // A block comment that never closes was misread: nothing from where it opened is taken for a comment.
  assert.equal(kinds('src/a.js', ['run() /* open', 'more']), 'code code')
})

test('JSX: text between tags is shown, so a `//` there is never a comment; comments outside the elements still are', () => {
  const view = ['export function Help() {', '  return (', '    <p title="a // b">', "      // shown, and don't hide it", '      {/* hidden */}', '    </p>', '  )', '}', '// after']
  assert.equal(kinds('ui/help.tsx', view), 'code code code code code code code code comment')
  assert.equal(kinds('ui/list.jsx', ['const l = <ul>{items.map((i) => <li>{i}</li>)}</ul>', '// after']), 'code comment')
  // Plain TypeScript has no JSX: `<T>` there is a type.
  assert.equal(kinds('src/id.ts', ['const id = <T>(x: T) => x', '// after']), 'code comment')
})

test('Ruby: `#` starts a comment outside strings, heredocs and literals; `=begin` blocks are comments', () => {
  assert.equal(kinds('app/a.rb', ['# a comment', 'x = 1 # trailing', '', '=begin', 'docs', '=end', 'run(**opts)', '*rest = list']), 'comment code blank comment comment comment code code')
  // A splat is code, never a comment, wherever the line starts.
  assert.equal(kinds('app/a.rb', ['run(', '  **opts', ')']), 'code code code')
  assert.equal(kinds('app/a.rb', ['sql = <<~SQL', '  # part of the query', 'SQL', '# after']), 'code code code comment')
  // A heredoc opened with a plain `<<` ends only at its name at the start of a line.
  assert.equal(kinds('app/a.rb', ['text = <<EOS', '  EOS', '# still the text', 'EOS', '# after']), 'code code code code comment')
  assert.equal(kinds('app/a.rb', ['s = "a', '# inside the string', '"', '# after']), 'code code code comment')
  assert.equal(kinds('app/a.rb', ['words = %w[', '  # inside the list', ']', '# after']), 'code code code comment')
  assert.equal(kinds('app/a.rb', ['s = "#{', '  name }', '# inside the string', '"']), 'code code code code')
  assert.equal(kinds('app/a.rb', ['quote = ?"', '# after']), 'code comment')
  // A line that opens with `#{` may be a string read wrong: it is code.
  assert.equal(kinds('app/a.rb', ['#{name}']), 'code')
  // What follows __END__ is data the program may read.
  assert.equal(kinds('app/a.rb', ['x = 1', '__END__', '# data']), 'code code code')
})

test('a language not read here has no comments: what looks like one is code', () => {
  assert.equal(kinds('script/run.py', ['# looks like a comment', '', 'x = 1']), 'code blank code')
})
