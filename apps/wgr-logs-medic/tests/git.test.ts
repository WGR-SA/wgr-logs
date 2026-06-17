import { describe, expect, it } from 'vitest'
import { cloneUrl, branchName, prCreateArgs } from '../src/fix/git.js'

describe('cloneUrl', () => {
  it('injects an x-access-token into an owner/name repo', () => {
    expect(cloneUrl('github.com/wgr-sa/prometerre', 'TKN')).toBe('https://x-access-token:TKN@github.com/wgr-sa/prometerre.git')
  })
  it('normalizes a full https URL and a .git suffix', () => {
    expect(cloneUrl('https://github.com/wgr-sa/prometerre.git', 'TKN')).toBe('https://x-access-token:TKN@github.com/wgr-sa/prometerre.git')
  })
})

describe('branchName', () => {
  it('is deterministic and signature-scoped', () => {
    expect(branchName('abcd1234', 1_700_000_000_000)).toBe('medic/fix-abcd1234-1700000000000')
  })
})

describe('prCreateArgs', () => {
  it('builds gh pr create args with title/body/base/head', () => {
    const args = prCreateArgs({ title: 'T', body: 'B', base: 'main', head: 'medic/x' })
    expect(args).toEqual(['pr', 'create', '--title', 'T', '--body', 'B', '--base', 'main', '--head', 'medic/x'])
  })
})
