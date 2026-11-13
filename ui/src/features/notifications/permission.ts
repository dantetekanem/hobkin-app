import { create } from 'zustand'
import type { NoticePermission } from './rules.ts'

/** What the Mac allows hobkin's notifications, as the shell last said. Settings reads it (`NotificationsLine`). */
export const useNoticePermission = create<{ state: NoticePermission }>()(() => ({ state: 'unknown' }))
