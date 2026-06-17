import type { SshConnConfig, SshDriver, SshExecOptions, SshExecResult } from '../../src/tools/ssh.js'

export interface RecordedExec {
  cfg: SshConnConfig
  command: string
  opts?: SshExecOptions
}

/** In-memory SshDriver for tests: records calls, returns scripted exec output. */
export class FakeSshDriver implements SshDriver {
  readonly execs: RecordedExec[] = []
  readonly puts: Array<{ remotePath: string; content: string }> = []
  private readonly files = new Map<string, string>()
  private execResult: SshExecResult = { code: 0, stdout: '', stderr: '' }

  setExecResult(result: SshExecResult): void {
    this.execResult = result
  }

  setRemoteFile(path: string, content: string): void {
    this.files.set(path, content)
  }

  exec(cfg: SshConnConfig, command: string, opts?: SshExecOptions): Promise<SshExecResult> {
    this.execs.push({ cfg, command, opts })
    return Promise.resolve(this.execResult)
  }

  put(_cfg: SshConnConfig, content: string | Buffer, remotePath: string): Promise<void> {
    const text = typeof content === 'string' ? content : content.toString('utf8')
    this.puts.push({ remotePath, content: text })
    this.files.set(remotePath, text)
    return Promise.resolve()
  }

  get(_cfg: SshConnConfig, remotePath: string): Promise<string> {
    return Promise.resolve(this.files.get(remotePath) ?? '')
  }
}
