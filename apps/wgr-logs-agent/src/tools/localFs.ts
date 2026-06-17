import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { AgentError } from '../lib/errors.js'

/** Throw unless `target` resolves inside `base` (blocks path traversal). */
function assertWithin(base: string, target: string): string {
  const abs = resolve(base, target)
  const rel = relative(base, abs)
  if (rel.startsWith('..') || resolve(rel) === rel) {
    throw new AgentError(`Path "${target}" escapes the allowed directory ${base}.`, 'FS')
  }
  return abs
}

/** Read a file. Allowed under either the repo root (assets/docs) or the workspace. */
export function readLocal(path: string, roots: { repoRoot: string; workspaceDir: string }): string {
  for (const base of [roots.repoRoot, roots.workspaceDir]) {
    try {
      return readFileSync(assertWithin(base, path), 'utf8')
    } catch (err) {
      if (err instanceof AgentError) continue
      throw err
    }
  }
  throw new AgentError(`Cannot read "${path}" — outside repo root and workspace.`, 'FS')
}

/** Write a file. Restricted to the workspace sandbox only. */
export function writeLocal(path: string, content: string, workspaceDir: string): string {
  const abs = assertWithin(workspaceDir, path)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content, 'utf8')
  return abs
}
