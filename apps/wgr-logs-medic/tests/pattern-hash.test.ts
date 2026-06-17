import { describe, expect, it } from 'vitest'
import { parseError } from '../src/scan/signature.js'

describe('patternHash', () => {
  it('matches the same error class+message across different project paths', () => {
    const a = parseError("2026-06-17 10:00:00 Notice: Trying to get property 'slug' of non-object in [/data01/sites/projA/x.ctp, line 13]")
    const b = parseError("2026-06-18 11:00:00 Notice: Trying to get property 'slug' of non-object in [/var/www/projB/y.ctp, line 99]")
    expect(a.patternHash).toBe(b.patternHash)
    // signature (project-local) still differs because the file path differs
    expect(a.signature).not.toBe(b.signature)
  })

  it('differs for different error messages', () => {
    const a = parseError('2026-06-17 10:00:00 Error: [App\\FooException] boom (/x/Foo.php:9)')
    const b = parseError('2026-06-17 10:00:00 Error: [App\\BarException] bang (/x/Bar.php:9)')
    expect(a.patternHash).not.toBe(b.patternHash)
  })
})
