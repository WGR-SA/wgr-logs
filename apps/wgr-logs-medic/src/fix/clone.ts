import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cloneUrl, plainUrl, type Runner, execRunner } from './git.js'

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
    // Strip the PAT from origin so the fixer agent's Bash cannot git push.
    const strip = await run('git', ['remote', 'set-url', 'origin', plainUrl(repo)], { cwd: dir })
    if (strip.code !== 0) throw new Error(`remote set-url failed: ${strip.stderr.trim()}`)
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
