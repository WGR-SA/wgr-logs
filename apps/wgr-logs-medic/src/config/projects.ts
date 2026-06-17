import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'
import { ConfigError } from './env.js'

export const ProjectSchema = z.object({
  name: z.string().min(1),
  /** A LogQL stream selector identifying this project's app logs in Loki. */
  lokiSelector: z.string().min(1),
})
export type Project = z.infer<typeof ProjectSchema>

const FileSchema = z.object({ projects: z.array(ProjectSchema) })

export function parseProjects(yaml: string): Project[] {
  return FileSchema.parse(parse(yaml)).projects
}

export function loadProjects(path?: string): Project[] {
  const file = path ?? join(homedir(), '.wgr-logs-medic', 'projects.yml')
  try {
    return parseProjects(readFileSync(file, 'utf8'))
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ConfigError(`No projects file found at ${file}. Create it or pass --projects <path>.`)
    }
    throw error
  }
}
