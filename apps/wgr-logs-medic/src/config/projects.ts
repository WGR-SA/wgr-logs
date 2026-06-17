import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'

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
  return parseProjects(readFileSync(file, 'utf8'))
}
