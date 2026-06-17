import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Target } from '../config/targets.js'
import { SshError } from '../lib/errors.js'

/** Expand a leading `~/` to the home directory (Node's fs does not, unlike the shell). */
export function expandHome(path: string): string {
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
}

export interface SshConnConfig {
  host: string
  user: string
  port?: number
  identityFile?: string
}

export interface SshExecResult {
  code: number | null
  stdout: string
  stderr: string
}

export interface SshExecOptions {
  stdin?: string
  timeoutMs?: number
}

/** Seam so unit tests can inject a FakeSshDriver instead of opening real connections. */
export interface SshDriver {
  exec(cfg: SshConnConfig, command: string, opts?: SshExecOptions): Promise<SshExecResult>
  put(cfg: SshConnConfig, content: string | Buffer, remotePath: string, opts?: { mode?: number }): Promise<void>
  get(cfg: SshConnConfig, remotePath: string): Promise<string>
}

export function connConfigFromTarget(target: Target): SshConnConfig {
  return {
    host: target.ssh.host,
    user: target.ssh.user,
    port: target.ssh.port,
    identityFile: target.ssh.identityFile,
  }
}

/**
 * POSIX single-quote a single argument. SSH `exec` always runs the command through
 * the remote shell, so any value interpolated into a command MUST be quoted to
 * avoid injection. Use `buildCommand` for argv arrays.
 */
export function posixQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

export function buildCommand(argv: readonly string[]): string {
  return argv.map(posixQuote).join(' ')
}

/** Real driver, backed by `ssh2`. Lazily imported so unit tests never load it. */
export class Ssh2Driver implements SshDriver {
  async exec(cfg: SshConnConfig, command: string, opts: SshExecOptions = {}): Promise<SshExecResult> {
    const { Client } = await import('ssh2')
    return new Promise<SshExecResult>((resolve, reject) => {
      const conn = new Client()
      const timer = opts.timeoutMs
        ? setTimeout(() => {
            conn.end()
            reject(new SshError(`SSH exec timed out after ${opts.timeoutMs}ms on ${cfg.host}`, null))
          }, opts.timeoutMs)
        : undefined
      conn
        .on('ready', () => {
          conn.exec(command, (err, stream) => {
            if (err) {
              conn.end()
              if (timer) clearTimeout(timer)
              return reject(new SshError(`SSH exec failed on ${cfg.host}: ${err.message}`, null))
            }
            let stdout = ''
            let stderr = ''
            stream
              .on('close', (code: number | null) => {
                if (timer) clearTimeout(timer)
                conn.end()
                resolve({ code, stdout, stderr })
              })
              .on('data', (d: Buffer) => {
                stdout += d.toString('utf8')
              })
            stream.stderr.on('data', (d: Buffer) => {
              stderr += d.toString('utf8')
            })
            if (opts.stdin !== undefined) {
              stream.end(opts.stdin)
            }
          })
        })
        .on('error', (err) => {
          if (timer) clearTimeout(timer)
          reject(new SshError(`SSH connection failed to ${cfg.host}: ${err.message}`, null))
        })
        .connect(this.connectOptions(cfg))
    })
  }

  async put(cfg: SshConnConfig, content: string | Buffer, remotePath: string, opts: { mode?: number } = {}): Promise<void> {
    const { Client } = await import('ssh2')
    const body = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
    return new Promise<void>((resolve, reject) => {
      const conn = new Client()
      conn
        .on('ready', () => {
          conn.sftp((err, sftp) => {
            if (err) {
              conn.end()
              return reject(new SshError(`SFTP open failed on ${cfg.host}: ${err.message}`, null))
            }
            const stream = sftp.createWriteStream(remotePath, opts.mode ? { mode: opts.mode } : {})
            stream.on('close', () => {
              conn.end()
              resolve()
            })
            stream.on('error', (e: Error) => {
              conn.end()
              reject(new SshError(`SFTP write failed (${remotePath}) on ${cfg.host}: ${e.message}`, null))
            })
            stream.end(body)
          })
        })
        .on('error', (err) => reject(new SshError(`SSH connection failed to ${cfg.host}: ${err.message}`, null)))
        .connect(this.connectOptions(cfg))
    })
  }

  async get(cfg: SshConnConfig, remotePath: string): Promise<string> {
    const { Client } = await import('ssh2')
    return new Promise<string>((resolve, reject) => {
      const conn = new Client()
      conn
        .on('ready', () => {
          conn.sftp((err, sftp) => {
            if (err) {
              conn.end()
              return reject(new SshError(`SFTP open failed on ${cfg.host}: ${err.message}`, null))
            }
            const chunks: Buffer[] = []
            const stream = sftp.createReadStream(remotePath)
            stream.on('data', (d: Buffer) => chunks.push(d))
            stream.on('close', () => {
              conn.end()
              resolve(Buffer.concat(chunks).toString('utf8'))
            })
            stream.on('error', (e: Error) => {
              conn.end()
              reject(new SshError(`SFTP read failed (${remotePath}) on ${cfg.host}: ${e.message}`, null))
            })
          })
        })
        .on('error', (err) => reject(new SshError(`SSH connection failed to ${cfg.host}: ${err.message}`, null)))
        .connect(this.connectOptions(cfg))
    })
  }

  private connectOptions(cfg: SshConnConfig): import('ssh2').ConnectConfig {
    return {
      host: cfg.host,
      username: cfg.user,
      port: cfg.port ?? 22,
      ...(cfg.identityFile ? { privateKey: readFileSync(expandHome(cfg.identityFile)) } : {}),
    }
  }
}
