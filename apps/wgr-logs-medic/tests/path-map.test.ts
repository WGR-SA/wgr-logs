import { describe, expect, it } from 'vitest'
import { mapServerPath } from '../src/fix/path-map.js'

const PREFIX = '/data01/sites/prometerre/prod/prometerre.ch'

describe('mapServerPath', () => {
  it('strips the configured prefix to a repo-relative path', () => {
    expect(mapServerPath(`${PREFIX}/src/Template/Topics/view.ctp`, PREFIX)).toBe('src/Template/Topics/view.ctp')
  })

  it('tolerates a trailing slash on the prefix', () => {
    expect(mapServerPath(`${PREFIX}/src/x.php`, `${PREFIX}/`)).toBe('src/x.php')
  })

  it('returns null when the path is outside the prefix', () => {
    expect(mapServerPath('/usr/lib/php/other.php', PREFIX)).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(mapServerPath('', PREFIX)).toBeNull()
    expect(mapServerPath(undefined as unknown as string, PREFIX)).toBeNull()
  })

  it('returns the path unchanged (minus leading slash) when no prefix is configured', () => {
    expect(mapServerPath('/src/x.php', undefined)).toBe('src/x.php')
  })
})
