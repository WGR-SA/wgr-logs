import { describe, expect, it } from 'vitest'
import { TargetSchema, toShipperKind } from '../src/config/targets.js'

describe('toShipperKind', () => {
  it('maps php-mutu to php', () => {
    expect(toShipperKind('php-mutu')).toBe('php')
  })
  it('passes through docker and bash', () => {
    expect(toShipperKind('docker')).toBe('docker')
    expect(toShipperKind('bash')).toBe('bash')
  })
})

describe('TargetSchema', () => {
  it('parses a valid target', () => {
    const t = TargetSchema.parse({
      name: 'mutu-h2web287',
      kind: 'php-mutu',
      ssh: { host: 'h2web287', user: 'uid188825' },
    })
    expect(t.name).toBe('mutu-h2web287')
    expect(t.kind).toBe('php-mutu')
  })

  it('rejects an unknown kind', () => {
    const r = TargetSchema.safeParse({ name: 'x', kind: 'k8s', ssh: { host: 'h', user: 'u' } })
    expect(r.success).toBe(false)
  })

  it('requires ssh host and user', () => {
    expect(TargetSchema.safeParse({ name: 'x', kind: 'bash', ssh: { host: 'h' } }).success).toBe(false)
  })
})
