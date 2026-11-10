/** A file the viewer shows (_specs/027-links-and-files). */
export interface FileContent {
  /** The file's real path, links followed. */
  path: string
  name: string
  text: string
  bytes: number
  /** Show it as rendered Markdown. Any other text shows as code. */
  markdown: boolean
}
