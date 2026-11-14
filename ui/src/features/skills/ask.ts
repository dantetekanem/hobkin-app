import type { SkillEntry } from '#shared/pi-resources/wire.ts'
import type { HostState } from '@/lib/host/index.ts'

/**
 * Ask for a change (039-skills-and-extensions): the words go to main hobkin as a chat message the user sent, the way
 * Settings sends a theme request, beginning with the skill and its file so hobkin knows what to change. The composer's
 * draft stays as it is. The skill changes only if hobkin changes it in the conversation.
 */

type Skill = Pick<SkillEntry, 'name' | 'file' | 'package'>

/** The message hobkin gets: the skill, the package it comes from when it does, its file, and the words. */
export function changeRequestText(skill: Skill, words: string): string {
  const from = skill.package ? ` from the Pi package ${skill.package.name}` : ''
  return `Change the skill “${skill.name}”${from} (${skill.file}): ${words.trim()}`
}

/** The chat as far as a plain send goes: one that leaves the draft, its images and any report reply alone. */
interface Chat {
  getState(): { send(message: string): Promise<boolean>; problem: string | null }
}

interface Host {
  getState(): Pick<HostState, 'link'>
}

/** Sends the request when a host is there and there are words. The note says what happened, for the line under the field. */
export async function askForChange(skill: Skill, words: string, chat: Chat, host: Host): Promise<{ sent: boolean; note: string }> {
  if (host.getState().link !== 'open') return { sent: false, note: 'Not sent. Connect to hobkin first.' }
  if (!words.trim()) return { sent: false, note: 'Write what should change first.' }
  const sent = await chat.getState().send(changeRequestText(skill, words))
  return sent ? { sent, note: 'Sent to hobkin. Its answer comes in the chat.' } : { sent, note: chat.getState().problem ?? 'Not sent. Try again.' }
}
