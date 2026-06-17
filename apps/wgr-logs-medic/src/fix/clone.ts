import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cloneUrl, type Runner, execRunner } from './git.js'

/** Shallow-clone `repo` into a throwaway temp dir, run `fn(dir)`, always clean up. */
export async function withClone<T>(
  repo: string,
  token: string,
  fn: (dir: string) => Promise<T>,
  run: Runner = execRunner,
  branch?: string,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'wgr-medic-'))
  try {
    const args = ['clone', '--depth', '1']
    if (branch) args.push('--branch', branch)
    args.push(cloneUrl(repo, token), dir)
    const res = await run('git', args)
    if (res.code !== 0) throw new Error(`clone failed: ${res.stderr.trim()}`)
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
