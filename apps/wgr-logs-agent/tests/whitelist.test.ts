import { describe, expect, it } from 'vitest'
import { classifyAdminCall } from '../src/tools/http.js'

describe('classifyAdminCall', () => {
  it('allows GET /mgmt/agents (auto, admin)', () => {
    expect(classifyAdminCall('GET', '/mgmt/agents')).toEqual({ gate: 'auto', auth: 'admin' })
  })

  it('treats register as register-body auth, confirm gate', () => {
    expect(classifyAdminCall('POST', '/mgmt/agents/register')).toEqual({ gate: 'confirm', auth: 'register-body' })
  })

  it('flags agent DELETE as strong gate', () => {
    expect(classifyAdminCall('DELETE', '/mgmt/agents/abc-123')).toEqual({ gate: 'strong', auth: 'admin' })
  })

  it('matches nested source routes', () => {
    expect(classifyAdminCall('POST', '/mgmt/agents/abc/sources')).toEqual({ gate: 'confirm', auth: 'admin' })
    expect(classifyAdminCall('DELETE', '/mgmt/agents/abc/sources/7')).toEqual({ gate: 'strong', auth: 'admin' })
  })

  it('ignores the query string when matching', () => {
    expect(classifyAdminCall('GET', '/mgmt/agents?foo=bar')).toEqual({ gate: 'auto', auth: 'admin' })
  })

  it('rejects non-whitelisted paths and the old flat /mgmt/sources', () => {
    expect(classifyAdminCall('GET', '/mgmt/sources')).toBeNull()
    expect(classifyAdminCall('POST', '/mgmt/agents/abc')).toBeNull()
    expect(classifyAdminCall('GET', '/mgmt/secrets')).toBeNull()
  })
})
