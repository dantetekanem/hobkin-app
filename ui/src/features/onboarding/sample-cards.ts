import type { Card, GoalCards } from './cards.ts'
import { GOALS, type Goal } from './goals.ts'

/**
 * Made-up routine cards for a browser tab on sample data, which has no hobkin to read templates from. Nothing picked
 * here is saved or sent. See _specs/044-goal-first-setup.
 */

const card = (id: string, parts: Omit<Card, 'id' | 'version' | 'source' | 'closes'> & Partial<Pick<Card, 'source'>>): Card => ({
  id,
  version: 1,
  source: 'hobkin',
  closes: null,
  ...parts,
})

const DEADLINES = card('deadlines-ahead', {
  title: 'Deadlines ahead',
  summary: 'Dates and deadlines in the next two weeks, from bills to forms to a trip to plan for.',
  needs: ['calendar', 'mail'],
  recurrence: 'Daily, early in the morning',
  tells: 'A deadline comes within a week, or one moved.',
  skips: 'Birthdays and holidays already on the calendar.',
  gives: ['report', 'critical'],
  private: true,
  asks: 'How many days ahead should a deadline first show up?',
  effort: 'low',
})

const SAMPLE: Record<Goal, { starters: Card[]; more: Card[] }> = {
  job: {
    starters: [
      card('job-openings', {
        title: 'Roles that fit',
        summary: 'New openings that fit the role and places you named, at the companies and boards you watch.',
        needs: ['web access'],
        recurrence: 'Twice a week',
        tells: 'A new posting fits, or one you kept changed or closed.',
        skips: 'Roles you ruled out, each with its date.',
        gives: ['report'],
        private: false,
        asks: 'Which companies or job boards should it watch?',
        effort: 'medium',
      }),
      card('job-applications', {
        title: 'Applications',
        summary: 'Each application you sent, where it stands, and the ones gone quiet.',
        needs: ['mail'],
        recurrence: 'Daily',
        tells: 'A reply, a request such as a form or a test, a no, or one quiet past the days you set.',
        skips: 'Automatic receipts that only say it arrived.',
        gives: ['report', 'action'],
        private: true,
        asks: 'How many quiet days before it drafts a follow-up?',
        effort: 'medium',
      }),
      card('interviews', {
        title: 'Interviews',
        summary: 'Interviews, take-home tasks and offer deadlines in the next 7 days, each with a short brief.',
        needs: ['calendar', 'mail'],
        recurrence: 'Weekday mornings',
        tells: 'One is coming up or moved, 3 days ahead and the day before.',
        skips: null,
        gives: ['report', 'critical'],
        private: true,
        asks: null,
        effort: 'low',
      }),
    ],
    more: [
      card('paperwork', {
        title: 'Paperwork',
        summary: 'Official paperwork with a date on it, such as a permit, a renewal or a form that waits on you.',
        needs: ['mail'],
        recurrence: 'Weekly',
        tells: 'A date is a month away, a reply came, or something new is asked of you.',
        skips: 'Letters that only confirm what you already know.',
        gives: ['report', 'action'],
        private: true,
        asks: 'Which papers should it follow?',
        effort: 'medium',
      }),
    ],
  },
  business: {
    starters: [
      card('business-leads', {
        title: 'Leads and customers',
        summary: 'People who wrote to the business and wait on an answer, and deals gone quiet.',
        needs: ['mail'],
        recurrence: 'Weekday mornings and afternoons',
        tells: 'A new lead or customer waits on you, or a deal is quiet past the days you set.',
        skips: 'Newsletters, cold pitches and receipts.',
        gives: ['report', 'action'],
        private: true,
        asks: 'How many quiet days before a deal counts as gone quiet?',
        effort: 'medium',
      }),
      card('runway', {
        title: 'Runway',
        summary: 'How many months the business can run at its spending, and what moved it.',
        needs: ['a read-only source for the money'],
        recurrence: 'Monthly',
        tells: 'The months left, what changed since last month, and money due before the next run.',
        skips: null,
        gives: ['report', 'critical'],
        private: true,
        asks: 'Below how many months should it warn you?',
        effort: 'high',
      }),
      card('competitors', {
        title: 'Competitors',
        summary: 'What changed on the sites of the competitors you name.',
        needs: ['web access'],
        recurrence: 'Weekly',
        tells: 'A new price or plan, a new product, or a launch post.',
        skips: 'Wording and design changes that do not change what is sold.',
        gives: ['report'],
        private: false,
        asks: 'Which competitors should it watch?',
        effort: 'medium',
      }),
    ],
    more: [
      card('meetings', {
        title: 'Meetings',
        summary: "Tomorrow's meetings, with what each one is for and what to bring.",
        needs: ['calendar', 'mail'],
        recurrence: 'Weekday afternoons',
        tells: 'A meeting tomorrow needs something from you first.',
        skips: 'Meetings you only watch.',
        gives: ['report'],
        private: true,
        asks: null,
        effort: 'low',
      }),
    ],
  },
  project: {
    starters: [
      card('project-milestones', {
        title: 'Milestones',
        summary: 'The next milestones, against the date the project must be done by.',
        needs: ['notes', 'calendar'],
        recurrence: 'The first working day of the week',
        tells: 'A milestone due within two weeks is behind, one passed undone, or the plan or its date changed.',
        skips: null,
        gives: ['report', 'action'],
        private: false,
        asks: 'Where does the plan live?',
        effort: 'medium',
      }),
      card('project-blockers', {
        title: 'Blockers',
        summary: 'What the project waits on, such as a reply, a delivery or someone else\'s part.',
        needs: ['mail', 'notes'],
        recurrence: 'Monday, Wednesday and Friday mornings',
        tells: 'Something you wait on is past its date.',
        skips: null,
        gives: ['report', 'action', 'follow-up'],
        private: true,
        asks: null,
        effort: 'medium',
      }),
      DEADLINES,
    ],
    more: [
      card('weekly-plan', {
        title: 'Weekly plan',
        summary: 'A short plan for the week ahead, from what is due and what slipped.',
        needs: ['calendar', 'notes'],
        recurrence: 'Late in the week',
        tells: 'Every week, in a few lines.',
        skips: null,
        gives: ['report'],
        private: false,
        asks: null,
        effort: 'low',
      }),
    ],
  },
  life: {
    starters: [
      DEADLINES,
      card('email', {
        title: 'Email',
        summary: 'Threads that wait on your reply or on someone else\'s, and a nudge when an answer is overdue.',
        needs: ['mail'],
        recurrence: 'Every 2 hours in working hours',
        tells: 'A thread you wait on has gone the days you set without an answer.',
        skips: 'Newsletters and mailing lists.',
        gives: ['report', 'action', 'follow-up'],
        private: true,
        asks: 'How many days without an answer before a nudge?',
        effort: 'medium',
      }),
      card('money', {
        title: 'Money',
        summary: 'Bills due, charges that look wrong, and subscriptions that renewed.',
        needs: ['a read-only source for your finances'],
        recurrence: 'Weekly',
        tells: 'A bill is due within a week, a charge is new or larger than usual, or a trial turns paid.',
        skips: 'Charges you marked as expected.',
        gives: ['report', 'critical'],
        private: true,
        asks: null,
        effort: 'medium',
      }),
    ],
    more: [
      card('home', {
        title: 'Home',
        summary: 'Things the home needs on a schedule, such as filters, a service visit or a lease date.',
        needs: [],
        recurrence: 'Monthly',
        tells: 'Something is due this month.',
        skips: null,
        gives: ['report'],
        private: false,
        asks: 'What does your home need on a schedule?',
        effort: 'low',
      }),
      card('my-garden', {
        title: 'Garden',
        summary: 'What to plant, water or cover this week, from the forecast.',
        needs: ['web access'],
        recurrence: 'Weekly',
        tells: null,
        skips: null,
        gives: [],
        private: false,
        asks: null,
        effort: 'low',
        source: 'yours',
      }),
    ],
  },
  code: {
    starters: [
      card('review-queue', {
        title: 'Review queue',
        summary: 'Pull requests that wait on your review, and yours that wait on someone else.',
        needs: ["the gh CLI or your code host's own"],
        recurrence: 'Weekday mornings, with a refresh at midday and mid-afternoon',
        tells: 'A review is asked of you, or one of yours got an answer.',
        skips: 'Drafts and bots.',
        gives: ['report', 'action'],
        private: false,
        asks: null,
        effort: 'low',
      }),
      card('dependency-watch', {
        title: 'Dependency watch',
        summary: 'Security notices and major releases for what your projects depend on.',
        needs: ['web access'],
        recurrence: 'Weekly',
        tells: 'A notice touches a version you use, or a major release is out.',
        skips: 'Patch releases with nothing to act on.',
        gives: ['report', 'critical'],
        private: false,
        asks: null,
        effort: 'medium',
      }),
      card('unblocker', {
        title: 'Unblocker',
        summary: 'Your pull requests that are stuck, and the one step that moves each.',
        needs: ["the gh CLI or your code host's own"],
        recurrence: 'Hourly in working hours',
        tells: 'A check failed, a review asked for changes, or a merge is blocked.',
        skips: null,
        gives: ['report', 'action', 'follow-up'],
        private: false,
        asks: null,
        effort: 'high',
      }),
    ],
    more: [],
  },
}

/** The sample's cards for the goals picked, each card once: under the first picked goal that has it, as hobkin's own do. */
export function sampleGoalCards(goals: readonly Goal[]): GoalCards[] {
  const shown = new Set<string>()
  const notShownYet = (cards: readonly Card[]): Card[] => {
    const fresh = cards.filter(({ id }) => !shown.has(id))
    for (const { id } of fresh) shown.add(id)
    return fresh
  }

  const picked = GOALS.filter((goal) => goals.includes(goal))
  return picked.map((goal) => ({
    goal,
    starters: notShownYet(SAMPLE[goal].starters),
    more: notShownYet(SAMPLE[goal].more),
  }))
}
