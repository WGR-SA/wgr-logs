import { describe, expect, it } from 'vitest'
import { FakeSshDriver } from './fixtures/fakeSsh.js'
import type { SshConnConfig } from '../src/tools/ssh.js'

const conn: SshConnConfig = { host: 'h2web287', user: 'uid188825' }

describe('FakeSshDriver', () => {
  it('records exec calls and returns the scripted result', async () => {
    const ssh = new FakeSshDriver()
    ssh.setExecResult({ code: 0, stdout: 'ok', stderr: '' })
    const r = await ssh.exec(conn, 'hostname')
    expect(r.stdout).toBe('ok')
    expect(ssh.execs).toHaveLength(1)
    expect(ssh.execs[0].command).toBe('hostname')
  })

  it('round-trips put/get through its in-memory file map', async () => {
    const ssh = new FakeSshDriver()
    await ssh.put(conn, 'token=abc', '/home/x/.cron-token')
    expect(ssh.puts[0].remotePath).toBe('/home/x/.cron-token')
    expect(await ssh.get(conn, '/home/x/.cron-token')).toBe('token=abc')
  })
})
