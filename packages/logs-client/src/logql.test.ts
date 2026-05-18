import { describe, expect, it } from 'vitest'
import { logql, LogQL } from './logql.js'

describe('LogQL', () => {
  it('builds a single label matcher', () => {
    expect(logql({ app: 'wgr-clip' }).toString()).toBe('{app="wgr-clip"}')
  })

  it('chains label matchers', () => {
    expect(logql().app('api').env('prod').level('error').toString())
      .toBe('{app="api", env="prod", level="error"}')
  })

  it('escapes label values with quotes and backslashes', () => {
    expect(logql({ msg: 'a "b" \\c' }).toString()).toBe('{msg="a \\"b\\" \\\\c"}')
  })

  it('throws for invalid label names', () => {
    expect(() => logql().eq('1bad', 'x').toString()).toThrow()
    expect(() => logql().eq('with-dash', 'x').toString()).toThrow()
  })

  it('appends contains/notContains filters', () => {
    expect(logql({ app: 'api' }).contains('panic').notContains('healthcheck').toString())
      .toBe('{app="api"} |= `panic` != `healthcheck`')
  })

  it('appends regex filter', () => {
    expect(logql({ app: 'api' }).matches('5\\d\\d').toString())
      .toBe('{app="api"} |~ `5\\d\\d`')
  })

  it('escapes regex literal helper', () => {
    expect(logql({ app: 'api' }).containsLiteral('a.b+c').toString())
      .toBe('{app="api"} |~ `a\\.b\\+c`')
  })

  it('requires at least one matcher', () => {
    expect(() => new LogQL().toString()).toThrow()
  })
})
