import { describe, expect, it } from 'vitest'
import { parseError } from '../src/scan/signature.js'

const CAKE_ERROR =
  '2026-06-17 10:49:00 Error: [Cake\\View\\Exception\\MissingHelperException] Helper class AttachmentHelper could not be found. (/data01/sites/prometerre/prod/prometerre.ch/vendor/cakephp/cakephp/src/View/HelperRegistry.php:126)'

const CAKE_NOTICE =
  "2026-06-17 10:52:10 Notice: Notice (8): Trying to get property 'slug' of non-object in [/data01/sites/prometerre/prod/prometerre.ch/src/Template/Services/view.ctp, line 13]"

describe('parseError', () => {
  it('extracts category, exception class and file:line for a CakePHP error', () => {
    const p = parseError(CAKE_ERROR)
    expect(p.category).toBe('Error')
    expect(p.exceptionClass).toBe('Cake\\View\\Exception\\MissingHelperException')
    expect(p.file).toBe('/data01/sites/prometerre/prod/prometerre.ch/vendor/cakephp/cakephp/src/View/HelperRegistry.php')
    expect(p.line).toBe(126)
  })

  it('extracts file:line from the "[file, line N]" notice form', () => {
    const p = parseError(CAKE_NOTICE)
    expect(p.category).toBe('Notice')
    expect(p.file).toBe('/data01/sites/prometerre/prod/prometerre.ch/src/Template/Services/view.ctp')
    expect(p.line).toBe(13)
  })

  it('produces the same signature for two occurrences differing only by line number in the message', () => {
    const a = parseError("2026-06-17 10:52:10 Notice: Notice (8): Trying to get property 'slug' of non-object in [/x/view.ctp, line 13]")
    const b = parseError("2026-06-17 11:00:00 Notice: Notice (8): Trying to get property 'slug' of non-object in [/x/view.ctp, line 14]")
    expect(a.signature).toBe(b.signature)
  })

  it('produces different signatures for different messages', () => {
    expect(parseError(CAKE_ERROR).signature).not.toBe(parseError(CAKE_NOTICE).signature)
  })

  it('is stable when the leading timestamp differs', () => {
    const a = parseError('2026-06-17 10:49:00 Error: boom (/x.php:1)')
    const b = parseError('2026-06-18 23:11:59 Error: boom (/x.php:1)')
    expect(a.signature).toBe(b.signature)
  })
})
