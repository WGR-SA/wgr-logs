import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import type { Logger } from '../lib/logger.js'
import { classifyAdminCall } from '../tools/http.js'

export type ConfirmFn = (prompt: string) => Promise<boolean>

export interface CanUseToolOptions {
  /** Mutations are never executed; the agent is told what it would have done. */
  dryRun: boolean
  /** Skip confirmation for ordinary mutations (NOT for deletions). */
  autoApprove: boolean
  confirm: ConfirmFn
  logger: Logger
  /** Shown in confirmation prompts, e.g. "mutu-h2web287 (h2web287)". */
  targetLabel: string
}

const WGR_PREFIX = 'mcp__wgr__'

interface Decision {
  mutating: boolean
  strong: boolean
  description: string
}

function classify(toolName: string, input: Record<string, unknown>, targetLabel: string): Decision {
  const bare = toolName.slice(WGR_PREFIX.length)
  switch (bare) {
    case 'ssh_exec': {
      const mutating = input.mutating === true
      return { mutating, strong: false, description: `SSH ${targetLabel}: ${String(input.command ?? '')}` }
    }
    case 'ssh_put':
      return { mutating: true, strong: false, description: `SFTP write ${targetLabel}:${String(input.remotePath ?? '')}` }
    case 'local_fs_write':
      return { mutating: true, strong: false, description: `Write workspace file ${String(input.path ?? '')}` }
    case 'http_admin_api': {
      const method = String(input.method ?? 'GET')
      const path = String(input.path ?? '')
      const cls = classifyAdminCall(method, path)
      const mutating = method !== 'GET'
      return { mutating, strong: cls?.gate === 'strong', description: `API ${method} ${path}` }
    }
    default:
      // ssh_get, http_loki_query, secret_create, local_fs_read — read-only / utility.
      return { mutating: false, strong: false, description: bare }
  }
}

export function makeCanUseTool(opts: CanUseToolOptions): CanUseTool {
  return async (toolName, input): Promise<PermissionResult> => {
    // Backstop: only our namespaced tools are ever allowed (built-ins are also
    // disallowed via options, this denies anything that slips through).
    if (!toolName.startsWith(WGR_PREFIX)) {
      return { behavior: 'deny', message: `Tool ${toolName} is not permitted; use the mcp__wgr__* tools.` }
    }

    const { mutating, strong, description } = classify(toolName, input, opts.targetLabel)
    if (!mutating) return { behavior: 'allow' }

    if (opts.dryRun) {
      opts.logger.info(`[dry-run] would run: ${description}`)
      return { behavior: 'deny', message: `[dry-run] Not executed — would have run: ${description}` }
    }

    // Deletions always require explicit confirmation, even with --yes.
    if (opts.autoApprove && !strong) return { behavior: 'allow' }

    const approved = await opts.confirm(`${strong ? '⚠️ DESTRUCTIVE — ' : ''}${description}`)
    return approved
      ? { behavior: 'allow' }
      : { behavior: 'deny', message: `Operator denied: ${description}` }
  }
}
