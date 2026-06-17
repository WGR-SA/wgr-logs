import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { ConfigError } from '../lib/errors.js'
import type { ShipperKind } from '../tools/types.js'

export const TargetKindSchema = z.enum(['docker', 'bash', 'php-mutu'])
export type TargetKind = z.infer<typeof TargetKindSchema>

export const TargetSchema = z.object({
  name: z.string().min(1),
  kind: TargetKindSchema,
  ssh: z.object({
    host: z.string().min(1),
    user: z.string().min(1),
    port: z.number().int().positive().optional(),
    identityFile: z.string().min(1).optional(),
  }),
  apiUrl: z.string().min(1).optional(),
  ingestUrl: z.string().min(1).optional(),
  publicDomain: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
})
export type Target = z.infer<typeof TargetSchema>

const TargetsFileSchema = z.union([
  z.object({ targets: z.array(TargetSchema) }),
  z.array(TargetSchema),
])

export function defaultTargetsPath(): string {
  return join(homedir(), '.wgr-logs-agent', 'targets.yml')
}

export function loadTargets(path: string = defaultTargetsPath()): Target[] {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    throw new ConfigError(`Cannot read targets file at ${path}. Create it with your servers (see README).`)
  }
  const parsed = TargetsFileSchema.safeParse(parseYaml(raw))
  if (!parsed.success) {
    throw new ConfigError(`Invalid targets file (${path}): ${parsed.error.issues.map((i) => i.message).join(', ')}`)
  }
  return Array.isArray(parsed.data) ? parsed.data : parsed.data.targets
}

export function getTarget(name: string, path?: string): Target {
  const target = loadTargets(path).find((t) => t.name === name)
  if (!target) throw new ConfigError(`Unknown target "${name}". Add it to your targets file.`)
  return target
}

/** Map the agent-side `kind` to the API's `shipper_kind` enum (`php-mutu` → `php`). */
export function toShipperKind(kind: TargetKind): ShipperKind {
  return kind === 'php-mutu' ? 'php' : kind
}
