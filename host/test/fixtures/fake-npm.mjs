// A stand-in for npm in tests, named in a test Pi folder's `npmCommand`. It answers the two things Pi asks npm to
// read, `view <name> version --json` and `root -g`, from a small registry file, and refuses everything else. Every call
// is written to `<registry>.log`, one JSON array of arguments per line, so a test can see that nothing was installed.
import { appendFileSync, readFileSync } from 'node:fs'

const [registry, ...args] = process.argv.slice(2)
appendFileSync(`${registry}.log`, `${JSON.stringify(args)}\n`)
const { root, versions } = JSON.parse(readFileSync(registry, 'utf8'))

if (args[0] === 'view' && args[2] === 'version') {
  // A spec is a name with an optional @version: `pi-tool`, `@scope/pi-tool@^1`.
  const name = args[1].replace(/(?!^)@.*$/, '')
  if (!(name in versions)) {
    process.stderr.write(`npm error 404 Not Found - ${name}\n`)
    process.exit(1)
  }
  process.stdout.write(`${JSON.stringify(versions[name])}\n`)
  process.exit(0)
}

if (args[0] === 'root' && args[1] === '-g') {
  process.stdout.write(`${root}\n`)
  process.exit(0)
}

process.stderr.write(`The test npm refuses: npm ${args.join(' ')}\n`)
process.exit(1)
