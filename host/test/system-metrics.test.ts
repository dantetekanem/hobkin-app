import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { cpuPercent, parseBattery, parseDf, parseSwap, parseVmStat, systemMetrics } from '../src/system-metrics.ts'
import { parseDu, usageFacts } from '../src/usage-facts.ts'
import { temporaryDirectory } from './support.ts'

test('cpu use is the busy share between two samples', () => {
  assert.equal(cpuPercent({ idle: 100, total: 200 }, { idle: 150, total: 300 }), 50)
  assert.equal(cpuPercent({ idle: 0, total: 0 }, { idle: 0, total: 100 }), 100)
  assert.equal(cpuPercent({ idle: 5, total: 10 }, { idle: 5, total: 10 }), null)
})

test('df output becomes bytes occupied and total', () => {
  const out = 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s5 1000 400 300 57% /System/Volumes/Data\n'
  assert.deepEqual(parseDf(out), { usedBytes: 700 * 1024, totalBytes: 1000 * 1024 })
  assert.equal(parseDf('nothing'), null)
})

test('vm_stat counts active, wired and compressed pages', () => {
  const out = 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 5.\nPages active: 10.\nPages wired down: 20.\nPages occupied by compressor: 30.\n'
  assert.equal(parseVmStat(out), 60 * 16384)
  assert.equal(parseVmStat('x'), null)
})

test('the machine reading has real numbers', async () => {
  const metrics = await systemMetrics(process.cwd())
  assert.ok(metrics.memory.usedBytes > 0 && metrics.memory.usedBytes <= metrics.memory.totalBytes * 1.01)
  assert.ok(metrics.disk && metrics.disk.usedBytes > 0)
  assert.ok(metrics.cpuPercent === null || (metrics.cpuPercent >= 0 && metrics.cpuPercent <= 100))
})

test('usage facts come from the config and the main session files', async (t) => {
  const home = join(temporaryDirectory(t), 'home')
  mkdirSync(join(home, 'sessions'), { recursive: true })
  writeFileSync(join(home, 'config.json'), '{"initializedAt":"2026-11-02T14:08:32.000Z"}')
  writeFileSync(join(home, 'sessions', 'main.jsonl'), '')
  writeFileSync(join(home, 'sessions', 'main-24e91f10-fff7-4254-b5c0-de30d5ff478a.jsonl'), '')
  writeFileSync(join(home, 'sessions', 'job-1.jsonl'), '')
  assert.deepEqual(await usageFacts(home, join(home, 'none')), { firstLoginAt: '2026-11-02T14:08:32.000Z', conversations: 2, homeBytes: (await usageFacts(home, join(home, 'none'))).homeBytes, backupsBytes: null })
  assert.deepEqual(await usageFacts(join(home, 'nope'), join(home, 'none')), { firstLoginAt: null, conversations: 0, homeBytes: null, backupsBytes: null })
})

test('battery, swap and folder size read from the tools output', () => {
  assert.deepEqual(parseBattery("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t87%; discharging; 4:02 remaining present: true"), { percent: 87, charging: false })
  assert.deepEqual(parseBattery("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged; 0:00 remaining"), { percent: 100, charging: true })
  assert.deepEqual(parseBattery("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t80%; charging; 1:00 remaining"), { percent: 80, charging: true })
  assert.equal(parseBattery("Now drawing from 'AC Power'\n"), null)
  assert.deepEqual(parseSwap('vm.swapusage: total = 2048.00M  used = 1024.50M  free = 1023.50M  (encrypted)'), { usedBytes: 1024.5 * 1024 ** 2, totalBytes: 2048 * 1024 ** 2 })
  assert.equal(parseSwap('nope'), null)
  assert.equal(parseDu('2048\t/home/x\n'), 2048 * 1024)
  assert.equal(parseDu(''), null)
})

test('the machine reading names the machine and the host process', async () => {
  const metrics = await systemMetrics(process.cwd())
  assert.ok(metrics.cpu.cores > 0 && metrics.cpu.arch)
  assert.equal(metrics.host.pid, process.pid)
  assert.equal(metrics.loadAverage.length, 3)
})
