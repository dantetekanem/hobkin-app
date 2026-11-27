import assert from 'node:assert/strict'
import { test } from 'node:test'
import { binaryFormat, coversChip, foreignPlatformFolder } from '../../scripts/package/binaries.ts'

const bytes = (...values: number[]) => Uint8Array.from(values)

test('tells Mach-O files, including universal ones, from Linux and Windows binaries and from everything else', () => {
  assert.equal(binaryFormat(bytes(0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 0x01)), 'mach-o', 'a 64-bit Mach-O as an Apple chip stores it')
  assert.equal(binaryFormat(bytes(0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2)), 'mach-o', 'a universal file with two slices')
  assert.equal(binaryFormat(bytes(0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 0x41)), null, 'a Java class file shares the magic number but has a version, not a slice count')
  assert.equal(binaryFormat(bytes(0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0)), 'elf')
  assert.equal(binaryFormat(bytes(0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0)), 'pe')
  assert.equal(binaryFormat(bytes(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0)), null, 'WebAssembly is not native code')
  assert.equal(binaryFormat(new TextEncoder().encode('#!/usr/bin/env node')), null)
  assert.equal(binaryFormat(bytes(0xcf, 0xfa)), null, 'a file too short to say')
})

test("drops a native binary only from a folder named for another platform or the other Mac chip", () => {
  const darwin = 'pi-tui/native/darwin/prebuilds'
  assert.equal(foreignPlatformFolder(`${darwin}/darwin-arm64/darwin-platform.node`, 'aarch64'), null)
  assert.equal(foreignPlatformFolder(`${darwin}/darwin-x64/darwin-platform.node`, 'aarch64'), 'darwin-x64')
  assert.equal(foreignPlatformFolder(`${darwin}/darwin-arm64/darwin-platform.node`, 'x86_64'), 'darwin-arm64')
  assert.equal(foreignPlatformFolder(`${darwin}/darwin-x64/darwin-platform.node`, 'x86_64'), null)
  assert.equal(foreignPlatformFolder('pi-tui/native/linux/prebuilds/linux-x64/linux-platform-x11.node', 'x86_64'), 'linux-x64')
  assert.equal(foreignPlatformFolder('sharp/vendor/linux-arm64-musl/lib/libvips.so', 'aarch64'), 'linux-arm64-musl')
  assert.equal(foreignPlatformFolder('pi-tui/native/win32/prebuilds/win32-arm64/win32-platform.node', 'aarch64'), 'win32-arm64')
  assert.equal(foreignPlatformFolder('fsevents/prebuilds/darwin-universal/fsevents.node', 'x86_64'), null, 'a universal build runs on both chips')
  assert.equal(foreignPlatformFolder('tools/linux-tools/helper', 'aarch64'), null, 'a folder whose second word is no chip names no platform')
  assert.equal(foreignPlatformFolder('build/Release/addon.node', 'aarch64'), null)
})

test('a Mach-O file runs on a chip when lipo lists its architecture', () => {
  assert.equal(coversChip('arm64\n', 'aarch64'), true)
  assert.equal(coversChip('arm64e', 'aarch64'), true)
  assert.equal(coversChip('x86_64 arm64', 'x86_64'), true)
  assert.equal(coversChip('x86_64', 'aarch64'), false)
  assert.equal(coversChip('arm64', 'x86_64'), false)
})
