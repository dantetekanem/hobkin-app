import type { LudicrousArea, LudicrousState } from '#shared/protocol/ludicrous.ts'

/** A run that builds, for the page with no host, as the YOLO page has its sample. Nothing in it reaches hobkin. */

const area = (id: string, name: string, depends: string[], agents: number, done: number, total: number, open = true): LudicrousArea => ({
  id, name, depends, open, done: false, steps: { done, total }, agents, leader: open,
})

const AREAS: LudicrousArea[] = [
  area('foundation', 'Foundation', [], 4, 6, 7),
  area('api', 'API', ['foundation'], 21, 5, 14),
  area('payments', 'Payments', ['api'], 12, 2, 9),
  area('web', 'Web app', ['api'], 26, 4, 18),
  area('ios', 'iOS app', ['api'], 18, 1, 16),
  area('shops', 'Shop dashboard', ['api'], 12, 0, 11),
  area('admin', 'Admin console', ['payments', 'shops'], 0, 0, 8, false),
]

const minutes = Array.from({ length: 48 }, (_, minute) => minute)

export const SAMPLE_LUDICROUS: LudicrousState = {
  run: {
    id: '202611271900-tidepool', slug: 'tidepool', name: 'tidepool', branch: 'ludicrous/tidepool',
    idea: 'A marketplace where independent boat repair shops list open slots and boat owners book them.',
    tier: 100, phase: 'building', step: null, round: null, planned: true, compiling: null, waitingUntil: null, pr: null, lines: [],
    running: 93, spawned: 412, tokens: 48_200_000, buildingMs: 47 * 60000, areas: AREAS, plan: null,
    history: minutes.map((minute) => ({
      at: new Date(Date.UTC(2026, 10, 27, 19, minute)).toISOString(),
      running: Math.min(100, minute < 5 ? 5 : 10 + minute * 2),
      spawned: minute < 5 ? 5 + minute : Math.round(5 + minute * 8.5),
    })),
  },
  machine: {
    picked: 50, checks: 3, perAgentMb: 475, spareMb: 43008,
    tiers: [
      { agents: 30, needsMb: 14250, fits: true, line: 'Takes the longest. Leaves about 44 GB of memory for everything else.', risk: null },
      { agents: 50, needsMb: 23750, fits: true, line: 'Done in about three fifths of the time 30 takes. Leaves about 35 GB of memory for everything else.', risk: null },
      { agents: 100, needsMb: 47500, fits: false, line: 'Done in about a third of the time 30 takes. Leaves about 12 GB of memory for everything else.', risk: 'More than this computer measures: its agents need about 46 GB and 42 GB is free beside your other work, so everything slows down while it swaps to disk.' },
    ],
  },
}
