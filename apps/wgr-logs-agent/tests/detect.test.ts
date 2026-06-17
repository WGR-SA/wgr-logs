import { describe, expect, it } from 'vitest'
import { parseInventory } from '../src/tools/detect.js'

describe('parseInventory', () => {
  it('parses services with no structure assumptions', () => {
    const stdout = [
      'svc\tjournald\tpersistent',
      'svc\tnginx\t',
      'svc\tdocker\t7',
      'svc\tpm2\t/home/deploy/.pm2/logs',
    ].join('\n')

    const inv = parseInventory(stdout)
    expect(inv.services).toContainEqual({ type: 'journald', config: {}, reason: 'systemd journal (persistent)' })
    expect(inv.services).toContainEqual({ type: 'nginx', config: {}, reason: '/var/log/nginx logs present' })
    expect(inv.services).toContainEqual({ type: 'pm2', config: { path: '/home/deploy/.pm2/logs' }, reason: 'pm2 logs at /home/deploy/.pm2/logs' })
    const docker = inv.services.find((s) => s.type === 'docker')
    expect(docker?.reason).toContain('7 running containers')
  })

  it('returns raw log directories with counts (no globbing — that is the agent\'s job)', () => {
    const stdout = [
      'logdir\t/data01/sites/prometerre/prod/prometerre.ch/logs\t5',
      'logdir\t/srv/app/storage/logs\t2',
    ].join('\n')

    const inv = parseInventory(stdout)
    expect(inv.logDirs).toEqual([
      { dir: '/data01/sites/prometerre/prod/prometerre.ch/logs', count: 5 },
      { dir: '/srv/app/storage/logs', count: 2 },
    ])
    expect(inv.services).toEqual([])
  })

  it('returns empty inventory for empty output', () => {
    expect(parseInventory('')).toEqual({ services: [], logDirs: [] })
  })
})
