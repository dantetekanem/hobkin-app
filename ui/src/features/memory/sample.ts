import type { MemoryEntry, MemoryList } from '#shared/protocol/memory.ts'

/**
 * What the Memory page shows with no host (`057-shared-memory`): twelve invented memories, one of every kind and from
 * every kind of author, one private and one past, and a Right now list of five. Nothing here is about the real user.
 */

const day = (date: string, time = '10:00') => `${date}T${time}:00Z`

const SAMPLE_MEMORIES: readonly MemoryEntry[] = [
  {
    name: 'lives-in-lisbon',
    kind: 'user',
    description: 'Lives in Lisbon since 2025; look up Portuguese sites, prices and rules first',
    text: 'Moved to Lisbon in March 2025. For anything that depends on place (prices, laws, stores, a maker\'s service site), look up the Portuguese version first.\n\nThe car is insured there too: see [[car-insurance-renewal]].',
    added: { at: day('2026-11-15', '18:18'), by: { kind: 'outside', title: 'Claude Code' } },
    changed: { at: day('2026-11-20', '09:02'), by: { kind: 'main' } },
    source: { kind: 'remember', said: 'I live in Lisbon now, look up the Portuguese one' },
    links: ['car-insurance-renewal'],
  },
  {
    name: 'partner-is-sam',
    kind: 'user',
    description: 'Partner is called Sam; their birthday is June 12',
    text: 'Sam likes a quiet dinner more than a party.',
    private: true,
    added: { at: day('2026-11-02', '20:40'), by: { kind: 'main' } },
    source: { kind: 'chat', said: 'Sam is my partner, their birthday is June 12, they hate surprise parties' },
  },
  {
    name: 'works-from-home',
    kind: 'user',
    description: 'Works from home on weekdays, 9 to 5, and keeps evenings free',
    added: { at: day('2026-10-04'), by: { kind: 'user' } },
    source: { kind: 'window' },
  },
  {
    name: 'short-replies',
    kind: 'preference',
    description: 'Replies under 100 words, the point first',
    text: 'More only when asked, or when something is unsafe or wrong.',
    added: { at: day('2026-10-01', '08:15'), by: { kind: 'main' } },
    source: { kind: 'chat', said: 'Keep it short. Point first.' },
  },
  {
    name: 'train-over-flying',
    kind: 'preference',
    description: 'Takes the train over flying for trips under 600 km',
    added: { at: day('2026-10-22', '14:30'), by: { kind: 'hobkin', id: 'trip-planner', title: 'Trip planner' } },
    source: { kind: 'chat' },
  },
  {
    name: 'car-insurance-renewal',
    kind: 'date',
    description: 'Car insurance renews every March 3; bring it up two weeks before',
    text: 'The papers are where [[insurance-papers]] says.',
    added: { at: day('2026-10-30', '11:05'), by: { kind: 'main' } },
    links: ['insurance-papers'],
  },
  {
    name: 'passport-expires',
    kind: 'date',
    description: 'Passport expires on 2027-03-10; renew it in January',
    until: '2027-03-10',
    added: { at: day('2026-11-08', '16:20'), by: { kind: 'user' } },
    source: { kind: 'window' },
  },
  {
    name: 'flat-viewing',
    kind: 'date',
    description: 'Flat viewing on Rua das Flores on Oct 31 at 10:00',
    until: '2026-10-31',
    past: true,
    added: { at: day('2026-10-20', '07:00'), by: { kind: 'suggested', title: 'Morning check' } },
    source: { kind: 'suggested', from: 'Morning check' },
  },
  {
    name: 'kept-old-laptop',
    kind: 'decision',
    description: 'Kept the old laptop for travel instead of selling it',
    text: 'The new one is too heavy to carry every day. Decided in October 2026.',
    added: { at: day('2026-10-12', '19:45'), by: { kind: 'main' } },
    source: { kind: 'chat', said: 'I will keep the old one for trips, the new one is too heavy' },
  },
  {
    name: 'moving-house',
    kind: 'project',
    description: 'Moving house in January; quotes and boxes tracked in notes/move.md',
    added: { at: day('2026-11-10', '12:00'), by: { kind: 'main' } },
    changed: { at: day('2026-11-18', '21:10'), by: { kind: 'user' } },
  },
  {
    name: 'insurance-papers',
    kind: 'pointer',
    description: 'Insurance papers are in Documents/Insurance, one folder a year',
    added: { at: day('2026-09-14', '09:30'), by: { kind: 'outside', title: 'Pi' } },
    source: { kind: 'remember' },
  },
  {
    name: 'landlord-on-whatsapp',
    kind: 'pointer',
    description: 'The landlord answers on WhatsApp, not email',
    added: { at: day('2026-09-30', '17:00'), by: { kind: 'main' } },
  },
]

/** The sample Right now list, as the main chat keeps it. */
export const SAMPLE_NOW: readonly string[] = [
  'Reply to the landlord about the deposit by Nov 28',
  'Waiting on two moving quotes; ask again on Friday',
  'Book the dentist for early December',
  'Renew the gym membership before Dec 1',
  'Send Sam the dates for the trip',
]

/** A fresh copy of the sample, each memory with a version of its own, so a change made on it starts from the same list. */
export function sampleMemoryList(): MemoryList {
  return {
    memories: SAMPLE_MEMORIES.map((memory, index) => ({ ...memory, version: `sample-${index + 1}` })),
    now: [...SAMPLE_NOW],
    nowVersion: 'sample-now-1',
  }
}
