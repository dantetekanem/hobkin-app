/** A file the viewer shows (_specs/027-links-and-files): text, or an image it draws. */
export type FileContent = TextFile | ImageFile

interface ShownFile {
  /** The file's real path, links followed. */
  path: string
  name: string
  bytes: number
}

export interface TextFile extends ShownFile {
  kind: 'text'
  text: string
  /** Show it as rendered Markdown. Any other text shows as code. */
  markdown: boolean
}

/** The images the viewer draws, each known by its bytes. */
export type ImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/avif' | 'image/bmp' | 'image/x-icon' | 'image/svg+xml'

export interface ImageFile extends ShownFile {
  kind: 'image'
  type: ImageType
  /** The file's bytes as a base64 `data:` URL, for an `<img>` only: an SVG drawn that way runs no script. */
  url: string
}
