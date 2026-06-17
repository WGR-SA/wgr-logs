import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCommand, connConfigFromTarget, expandHome, posixQuote } from '../src/tools/ssh.js'
import type { Target } from '../src/config/targets.js'

describe('expandHome', () => {
  it('expands a leading ~/ to the home directory', () => {
    expect(expandHome('~/.ssh/infomaniak_rsa')).toBe(join(homedir(), '.ssh/infomaniak_rsa'))
  })
  it('leaves absolute and relative paths untouched', () => {
    expect(expandHome('/etc/key')).toBe('/etc/key')
    expect(expandHome('./key')).toBe('./key')
  })
})

describe('posixQuote', () => {
  it('wraps a plain argument in single quotes', () => {
    expect(posixQuote('hello')).toBe(`'hello'`)
  })

  it('neutralizes embedded single quotes (no injection)', () => {
    expect(posixQuote(`a'; rm -rf /`)).toBe(`'a'\\''; rm -rf /'`)
  })

  it('quotes shell metacharacters literally', () => {
    expect(posixQuote('$(touch pwned) && echo x')).toBe(`'$(touch pwned) && echo x'`)
  })
})

describe('buildCommand', () => {
  it('joins quoted argv', () => {
    expect(buildCommand(['ls', '-la', '/home/user space'])).toBe(`'ls' '-la' '/home/user space'`)
  })
})

describe('connConfigFromTarget', () => {
  it('maps ssh fields', () => {
    const target = {
      name: 'mutu',
      kind: 'php-mutu',
      ssh: { host: 'h2web287', user: 'uid188825', port: 22, identityFile: '~/.ssh/id' },
    } satisfies Target
    expect(connConfigFromTarget(target)).toEqual({
      host: 'h2web287',
      user: 'uid188825',
      port: 22,
      identityFile: '~/.ssh/id',
    })
  })
})
