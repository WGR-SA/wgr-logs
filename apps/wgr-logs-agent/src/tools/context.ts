import type { Env } from '../config/env.js'
import type { Target } from '../config/targets.js'
import type { Logger } from '../lib/logger.js'
import type { SshDriver } from './ssh.js'

/**
 * Runtime context the tool handlers close over. Secrets (tokens, ssh creds) live
 * here, never in the tool input schema — so the model never sees or supplies them.
 */
export interface ToolContext {
  target: Target
  env: Env
  ssh: SshDriver
  logger: Logger
  /** Repo root (for shipper assets + docs). */
  repoRoot: string
  /** Sandbox for local_fs_* (defaults to ~/.wgr-logs-agent/workspace). */
  workspaceDir: string
}
