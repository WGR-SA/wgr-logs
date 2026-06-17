import { spawn } from 'node:child_process'

export interface RunResult {
  stdout: string
  stderr: string
  code: number
}
export type Runner = (cmd: string, args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv }) => Promise<RunResult>

export const execRunner: Runner = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts?.cwd, env: opts?.env ?? process.env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('error', reject)
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }))
  })

/** Build an authenticated https clone URL from `owner/name`, `github.com/owner/name`, or a full URL. */
export function cloneUrl(repo: string, token: string): string {
  const path = repo
    .replace(/^https?:\/\//, '')
    .replace(/^github\.com\//, '')
    .replace(/\.git$/, '')
  return `https://x-access-token:${token}@github.com/${path}.git`
}

/** Build a token-less https URL (same path normalization as cloneUrl but no credentials). */
export function plainUrl(repo: string): string {
  const path = repo
    .replace(/^https?:\/\//, '')
    .replace(/^github\.com\//, '')
    .replace(/\.git$/, '')
  return `https://github.com/${path}.git`
}

export function branchName(signature: string, now: number): string {
  return `medic/fix-${signature}-${now}`
}

export function prCreateArgs(o: { title: string; body: string; base: string; head: string }): string[] {
  return ['pr', 'create', '--title', o.title, '--body', o.body, '--base', o.base, '--head', o.head]
}

export class Git {
  constructor(
    private readonly dir: string,
    private readonly run: Runner = execRunner,
  ) {}

  private async git(args: string[]): Promise<RunResult> {
    const res = await this.run('git', args, { cwd: this.dir })
    if (res.code !== 0) throw new Error(`git ${args[0]} failed: ${res.stderr.trim()}`)
    return res
  }

  checkoutNewBranch(branch: string): Promise<RunResult> {
    return this.git(['checkout', '-b', branch])
  }
  addAll(): Promise<RunResult> {
    return this.git(['add', '-A'])
  }
  commit(message: string): Promise<RunResult> {
    return this.git(['commit', '-m', message])
  }
  push(branch: string, authUrl?: string): Promise<RunResult> {
    if (authUrl) return this.git(['push', '-u', authUrl, branch])
    return this.git(['push', '-u', 'origin', branch])
  }
  async diffStat(base: string): Promise<string> {
    const res = await this.git(['diff', '--stat', `${base}...HEAD`])
    return res.stdout.trim()
  }
}

export class Gh {
  constructor(
    private readonly dir: string,
    private readonly token: string,
    private readonly run: Runner = execRunner,
  ) {}

  private gh(args: string[]): Promise<RunResult> {
    return this.run('gh', args, { cwd: this.dir, env: { ...process.env, GH_TOKEN: this.token } })
  }

  async prCreate(o: { title: string; body: string; base: string; head: string }): Promise<string> {
    const res = await this.gh(prCreateArgs(o))
    if (res.code !== 0) throw new Error(`gh pr create failed: ${res.stderr.trim()}`)
    return res.stdout.trim() // PR URL
  }

  async prComments(pr: string): Promise<string> {
    const res = await this.gh(['pr', 'view', pr, '--comments'])
    if (res.code !== 0) throw new Error(`gh pr view failed: ${res.stderr.trim()}`)
    return res.stdout
  }
}
