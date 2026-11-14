/**
 * Prints where the time goes before a reply's first text, by agent kind and engine, from a hobkin home's event log.
 * Run with `node scripts/first-word.ts [home] [--hours 24]`. The home defaults to ~/.hobkin, and all hours are read
 * when none are given. It only reads `<home>/runtime/events/*.jsonl`, which holds numbers, ids and model names.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { firstWordTable, summarizeFirstWord } from '../host/src/first-word.ts'

const args = process.argv.slice(2)
const hoursAt = args.indexOf('--hours')
const hours = hoursAt < 0 ? null : Number(args[hoursAt + 1])
if (hours !== null && !(hours > 0)) throw new Error('--hours takes a number above zero.')
const home = args.find((arg, index) => !arg.startsWith('--') && (hoursAt < 0 || index !== hoursAt + 1)) ?? join(homedir(), '.hobkin')
const folder = join(home, 'runtime', 'events')
const since = hours === null ? 0 : Date.now() - hours * 3600000

const events = readdirSync(folder)
  .filter((name) => /^\d{4}-\d{2}\.jsonl$/.test(name))
  .sort()
  .flatMap((name) => readFileSync(join(folder, name), 'utf8').split('\n'))
  .flatMap((line): unknown[] => {
    try {
      const event = JSON.parse(line) as { at?: string }
      return Date.parse(event.at ?? '') >= since ? [event] : []
    } catch {
      return []
    }
  })

console.log(`${folder}${hours === null ? '' : `, last ${hours} hours`}\n`)
console.log(firstWordTable(summarizeFirstWord(events)))
