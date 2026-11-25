import type { ImageType } from '#shared/protocol/files.ts'

/**
 * Which image a file is, from its first bytes, never from its name (_specs/027-links-and-files). Null for anything
 * else, text included. The head need only be the first few thousand bytes.
 */
export function imageTypeOf(head: Uint8Array): ImageType | null {
  if (bytesAt(head, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (bytesAt(head, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (textAt(head, 0, 'GIF87a') || textAt(head, 0, 'GIF89a')) return 'image/gif'
  if (textAt(head, 0, 'RIFF') && textAt(head, 8, 'WEBP')) return 'image/webp'
  if (isAvif(head)) return 'image/avif'
  if (isBitmap(head)) return 'image/bmp'
  if (isIcon(head)) return 'image/x-icon'
  if (isSvg(head)) return 'image/svg+xml'
  return null
}

const bytesAt = (head: Uint8Array, at: number, wanted: readonly number[]) => head.length >= at + wanted.length && wanted.every((byte, index) => head[at + index] === byte)

const textAt = (head: Uint8Array, at: number, wanted: string) => bytesAt(head, at, [...wanted].map((char) => char.charCodeAt(0)))

const view = (head: Uint8Array) => new DataView(head.buffer, head.byteOffset, head.byteLength)

/** An ISO media file whose `ftyp` box names an AVIF brand, as its main brand or a compatible one (HEIC does not). */
function isAvif(head: Uint8Array): boolean {
  if (head.length < 16 || !textAt(head, 4, 'ftyp')) return false
  const end = Math.min(view(head).getUint32(0), head.length)
  const brand = (at: number) => textAt(head, at, 'avif') || textAt(head, at, 'avis')
  if (brand(8)) return true
  for (let at = 16; at + 4 <= end; at += 4) if (brand(at)) return true
  return false
}

/** The header sizes a Windows bitmap's second header comes in. "BM" alone starts plenty of text. */
const BITMAP_HEADERS = new Set([12, 40, 52, 56, 64, 108, 124])

function isBitmap(head: Uint8Array): boolean {
  return head.length >= 18 && textAt(head, 0, 'BM') && bytesAt(head, 6, [0, 0, 0, 0]) && BITMAP_HEADERS.has(view(head).getUint32(14, true))
}

/** An icon file: reserved zero, type 1, and at least one picture. */
function isIcon(head: Uint8Array): boolean {
  return head.length >= 6 && bytesAt(head, 0, [0, 0, 1, 0]) && view(head).getUint16(4, true) > 0
}

/** An `<svg>` root, after what may come before it in XML: a byte-order mark, a prolog, comments, a doctype, space. */
const SVG_ROOT = /^﻿?(?:\s|<\?xml[^>]*\?>|<!--[\s\S]*?-->|<!DOCTYPE[^[>]*(?:\[[\s\S]*?\])?\s*>)*<svg[\s/>]/i

function isSvg(head: Uint8Array): boolean {
  return !head.includes(0) && SVG_ROOT.test(new TextDecoder().decode(head))
}
