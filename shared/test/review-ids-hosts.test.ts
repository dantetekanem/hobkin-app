import assert from 'node:assert/strict'
import { test } from 'node:test'
import { codeHostOf, learnCodeHosts, pullUrl, reviewFolder, reviewIdOf, targetOfReviewFolder, targetOfReviewId } from '../review/ids.ts'

test('a pull request on a named code host carries its host in its id, its folder and its page; one on GitHub keeps the names it always had', () => {
  learnCodeHosts([{ name: 'corp', web: 'https://git.example.invalid' }])
  try {
    const onGitHub = { kind: 'pull', owner: 'acme', repo: 'shop', number: 482 } as const
    const named = { kind: 'pull', host: 'corp', owner: 'acme', repo: 'shop', number: 482 } as const
    assert.deepEqual([reviewIdOf(onGitHub), reviewFolder(onGitHub), pullUrl(onGitHub)], ['pr:acme/shop/482', 'pr+acme+shop+482', 'https://github.com/acme/shop/pull/482'])
    assert.deepEqual([reviewIdOf(named), reviewFolder(named), pullUrl(named)], ['pr:corp:acme/shop/482', 'pr+corp+acme+shop+482', 'https://git.example.invalid/acme/shop/pull/482'])
    assert.notEqual(reviewFolder(named), reviewFolder(onGitHub), 'two hosts never share a folder')
    for (const target of [onGitHub, named]) {
      assert.deepEqual(targetOfReviewId(reviewIdOf(target)), target)
      assert.deepEqual(targetOfReviewFolder(reviewFolder(target)), target)
    }
    // A pull request page on a named host reads as its review, as one on github.com does.
    assert.deepEqual(targetOfReviewId('https://git.example.invalid/Acme/Shop/pull/482/files'), named)
    assert.deepEqual(codeHostOf('corp'), { name: 'corp', web: 'https://git.example.invalid' })
    // A page on a host nobody named is no review's, and GitHub's own name is never a named host's.
    assert.equal(targetOfReviewId('https://elsewhere.invalid/acme/shop/pull/1'), null)
    assert.equal(targetOfReviewId('pr:github:acme/shop/1'), null)
  } finally {
    learnCodeHosts([])
  }
  // An id reads by its shape, before its host is learned, so no review is misread meanwhile; only its page waits for the host.
  assert.deepEqual(targetOfReviewId('pr:corp:acme/shop/482'), { kind: 'pull', host: 'corp', owner: 'acme', repo: 'shop', number: 482 })
  assert.equal(pullUrl({ kind: 'pull', host: 'corp', owner: 'acme', repo: 'shop', number: 482 }), null)
  assert.equal(targetOfReviewId('https://git.example.invalid/acme/shop/pull/482'), null)
})
