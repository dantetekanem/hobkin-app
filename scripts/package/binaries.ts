/**
 * Pure rules for the native code in a staged tree: which files are machine code, which belong to another platform
 * or the other Mac chip, and which chip a Mach-O file runs on. `stage.ts` drops what is foreign and `sign.ts` signs
 * every Mach-O file left, because notarization rejects an app holding any Mach-O file that is not signed.
 */
import type { Chip } from './feed.ts'

export type BinaryFormat = 'mach-o' | 'elf' | 'pe'

/** Node's name for a Mac chip, as folders of prebuilt modules and nodejs.org's downloads use it. */
export const nodeArch = (chip: Chip): 'arm64' | 'x64' => (chip === 'aarch64' ? 'arm64' : 'x64')

const THIN_MACH_O = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe])
const UNIVERSAL = new Set([0xcafebabe, 0xcafebabf])
// A universal file counts its slices where a Java class file, which shares its magic number, keeps its version (45 and up).
const MOST_SLICES = 30

/** What kind of machine code a file holds, from its first eight bytes, or null when it is not machine code. */
export function binaryFormat(head: Uint8Array): BinaryFormat | null {
  if (head.length < 8) return null
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
  const magic = view.getUint32(0)
  if (THIN_MACH_O.has(magic)) return 'mach-o'
  if (UNIVERSAL.has(magic)) return view.getUint32(4) <= MOST_SLICES ? 'mach-o' : null
  if (magic === 0x7f454c46) return 'elf'
  if (head[0] === 0x4d && head[1] === 0x5a) return 'pe'
  return null
}

const PLATFORMS = ['darwin', 'linux', 'win32', 'freebsd', 'openbsd', 'netbsd', 'android', 'sunos', 'aix']
const ARCHES = ['arm64', 'x64', 'ia32', 'arm', 'armv6', 'armv7', 'ppc64', 's390x', 'riscv64', 'loong64', 'mips64el', 'universal']
const PLATFORM_FOLDER = new RegExp(`^(${PLATFORMS.join('|')})-(${ARCHES.join('|')})(?:-[a-z0-9]+)*$`)

/**
 * The folder in a path that names another platform or the other Mac chip, as packages name their prebuilt modules
 * (`prebuilds/darwin-x64/`, `linux-arm64-musl/`), or null. A loader picks such a folder by the platform it runs on, so
 * one for another platform is never loaded there and is safe to leave out. A universal Mac build is kept for both chips.
 */
export function foreignPlatformFolder(path: string, chip: Chip): string | null {
  for (const folder of path.split('/').slice(0, -1)) {
    const named = PLATFORM_FOLDER.exec(folder)
    if (!named) continue
    const [, platform, arch] = named
    const runsOnChip = platform === 'darwin' && (arch === nodeArch(chip) || arch === 'universal')
    if (!runsOnChip) return folder
  }
  return null
}

/** Whether `lipo -archs` lists an architecture the chip runs natively. */
export function coversChip(archs: string, chip: Chip): boolean {
  const listed = archs.trim().split(/\s+/)
  if (chip === 'aarch64') return listed.some((arch) => arch.startsWith('arm64'))
  return listed.includes('x86_64') || listed.includes('x86_64h')
}
