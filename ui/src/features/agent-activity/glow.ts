import type { CSSProperties } from 'react'
import type { AgentTask } from './tasks.ts'

/**
 * Which lines under an agent's header glow. The user, 2026-11-24: "a glow animated border, giving life like the dots
 * and rectangles are, same for subagents, and the scheduled tasks". A line glows only while something on it is live and
 * is still otherwise, so nothing loops while the agent is idle (spec 052). The schedules line's rule is beside its
 * words, `schedulesGlow` in schedules.ts. Pure, so the rules are tested without a window.
 */

/** The tasks line glows while a task is in progress. */
export const tasksGlow = (tasks: readonly AgentTask[]): boolean => tasks.some((task) => task.state === 'now')

/** A line's glow in the agent's color, the one its tasks' dots are drawn in (`--tasks-tint` in TaskList.tsx). */
export const glowIn = (hue: number): CSSProperties => ({ '--aa-glow': `oklch(0.62 0.11 ${hue})` }) as CSSProperties

/** The attribute the glow's CSS (`aa-glow` in agent-activity.css) breathes under. */
export const liveIf = (live: boolean): { 'data-live'?: '' } => (live ? { 'data-live': '' } : {})
