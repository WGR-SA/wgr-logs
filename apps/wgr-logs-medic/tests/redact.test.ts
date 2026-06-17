import { describe, expect, it } from 'vitest'
import { redact } from '../src/scan/redact.js'

describe('redact', () => {
  it('masks AWS-style access keys', () => {
    expect(redact('key AKIAIOSFODNN7EXAMPLE here')).toBe('key [REDACTED] here')
  })

  it('masks bearer tokens and long hex/base64 secrets', () => {
    expect(redact('Authorization: Bearer abcDEF123ghiJKL456mnoPQR789stu')).toContain('[REDACTED]')
    expect(redact('token=0123456789abcdef0123456789abcdef')).toContain('[REDACTED]')
  })

  it('masks key=value pairs for sensitive keys', () => {
    expect(redact('password=hunter2 foo=bar')).toBe('password=[REDACTED] foo=bar')
    expect(redact('api_key: "s3cr3tValue"')).toContain('[REDACTED]')
  })

  it('leaves ordinary text untouched', () => {
    expect(redact('Helper class AttachmentHelper could not be found.')).toBe('Helper class AttachmentHelper could not be found.')
  })
})
