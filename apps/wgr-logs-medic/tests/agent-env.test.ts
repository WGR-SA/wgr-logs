import { describe, expect, it } from 'vitest'
import { scrubbedAgentEnv } from '../src/fix/run.js'

describe('scrubbedAgentEnv', () => {
  it('preserves PATH, HOME and ANTHROPIC_API_KEY', () => {
    const result = scrubbedAgentEnv({
      PATH: '/usr/bin:/bin',
      HOME: '/home/user',
      ANTHROPIC_API_KEY: 'sk-ant-abc123',
      WGR_GITHUB_TOKEN: 'ghp_secret',
      WGR_API_ADMIN_TOKEN: 'adm_secret',
      INGEST_AUTH_TOKEN: 'ingest_secret',
      FOO_SECRET: 's3cr3t',
    })
    expect(result['PATH']).toBe('/usr/bin:/bin')
    expect(result['HOME']).toBe('/home/user')
    expect(result['ANTHROPIC_API_KEY']).toBe('sk-ant-abc123')
  })

  it('drops explicit secret keys', () => {
    const result = scrubbedAgentEnv({
      PATH: '/x',
      HOME: '/h',
      ANTHROPIC_API_KEY: 'a',
      WGR_GITHUB_TOKEN: 'g',
      WGR_API_ADMIN_TOKEN: 'adm',
      INGEST_AUTH_TOKEN: 'i',
      GH_TOKEN: 'gh',
      GITHUB_TOKEN: 'github',
      WGR_API_REGISTER_TOKEN: 'reg',
      WGR_INGEST_TOKEN: 'wgr_ingest',
    })
    expect(result).not.toHaveProperty('WGR_GITHUB_TOKEN')
    expect(result).not.toHaveProperty('WGR_API_ADMIN_TOKEN')
    expect(result).not.toHaveProperty('INGEST_AUTH_TOKEN')
    expect(result).not.toHaveProperty('GH_TOKEN')
    expect(result).not.toHaveProperty('GITHUB_TOKEN')
    expect(result).not.toHaveProperty('WGR_API_REGISTER_TOKEN')
    expect(result).not.toHaveProperty('WGR_INGEST_TOKEN')
  })

  it('drops keys matching the generic secret pattern (except ANTHROPIC_API_KEY)', () => {
    const result = scrubbedAgentEnv({
      PATH: '/x',
      HOME: '/h',
      ANTHROPIC_API_KEY: 'a',
      FOO_SECRET: 's',
      DB_PASSWORD: 'pw',
      SOME_APIKEY: 'k',
      MY_API_KEY: 'k2',
      MY_TOKEN: 't',
    })
    expect(result).not.toHaveProperty('FOO_SECRET')
    expect(result).not.toHaveProperty('DB_PASSWORD')
    expect(result).not.toHaveProperty('SOME_APIKEY')
    expect(result).not.toHaveProperty('MY_API_KEY')
    expect(result).not.toHaveProperty('MY_TOKEN')
  })
})
