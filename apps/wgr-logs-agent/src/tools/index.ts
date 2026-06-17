import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { requireAdminApi, requireIngest } from '../config/env.js'
import type { ToolContext } from './context.js'
import { DETECT_SCRIPT, parseInventory } from './detect.js'
import { adminApiCall, lokiQueryRange } from './http.js'
import { createSecret } from './secret.js'
import { readLocal, writeLocal } from './localFs.js'
import { connConfigFromTarget } from './ssh.js'

export const WGR_SERVER_NAME = 'wgr'

/** Fully-qualified tool names (as the model sees them) for `allowedTools`. */
export const WGR_TOOL_NAMES = [
  'mcp__wgr__ssh_exec',
  'mcp__wgr__ssh_get',
  'mcp__wgr__ssh_put',
  'mcp__wgr__detect_sources',
  'mcp__wgr__http_loki_query',
  'mcp__wgr__http_admin_api',
  'mcp__wgr__secret_create',
  'mcp__wgr__local_fs_read',
  'mcp__wgr__local_fs_write',
] as const

/** Minimal MCP tool result (structurally assignable to the SDK's CallToolResult). */
interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
  [key: string]: unknown
}

function ok(text: string): ToolResult {
  return { content: [{ type: 'text', text }] }
}

function fail(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function buildToolServer(ctx: ToolContext) {
  const conn = connConfigFromTarget(ctx.target)

  const sshExec = tool(
    'ssh_exec',
    'Run a shell command on the target server over SSH. Set `mutating:true` for any command that changes state (writes files, reloads services, installs). The command runs through the remote shell.',
    { command: z.string(), mutating: z.boolean().optional() },
    async (args): Promise<ToolResult> => {
      try {
        const r = await ctx.ssh.exec(conn, args.command, { timeoutMs: 120_000 })
        return ok(JSON.stringify({ code: r.code, stdout: r.stdout, stderr: r.stderr }))
      } catch (err) {
        return fail(errMessage(err))
      }
    },
  )

  const sshGet = tool(
    'ssh_get',
    'Read a remote file over SFTP and return its contents.',
    { remotePath: z.string() },
    async (args): Promise<ToolResult> => {
      try {
        return ok(await ctx.ssh.get(conn, args.remotePath))
      } catch (err) {
        return fail(errMessage(err))
      }
    },
  )

  const sshPut = tool(
    'ssh_put',
    'Write content to a remote file over SFTP. Mutating: always gated.',
    { remotePath: z.string(), content: z.string(), mode: z.number().optional() },
    async (args): Promise<ToolResult> => {
      try {
        await ctx.ssh.put(conn, args.content, args.remotePath, args.mode ? { mode: args.mode } : {})
        return ok(`wrote ${args.remotePath}`)
      } catch (err) {
        return fail(errMessage(err))
      }
    },
  )

  const detectSources = tool(
    'detect_sources',
    'Read-only inventory of the target: standard services (journald, nginx, apache, docker/compose, pm2) and the directories where *.log files live — with NO assumption about the layout. Returns { services, logDirs }; reason over logDirs yourself to propose `files` globs adapted to this server.',
    {},
    async (): Promise<ToolResult> => {
      try {
        const r = await ctx.ssh.exec(conn, DETECT_SCRIPT, { timeoutMs: 90_000 })
        return ok(JSON.stringify(parseInventory(r.stdout), null, 2))
      } catch (err) {
        return fail(errMessage(err))
      }
    },
  )

  const httpLokiQuery = tool(
    'http_loki_query',
    'Run a LogQL query_range against Loki (read-only). Use to verify a host ships logs or to investigate.',
    {
      query: z.string(),
      start: z.string().optional(),
      end: z.string().optional(),
      limit: z.number().optional(),
      step: z.string().optional(),
    },
    async (args): Promise<ToolResult> => {
      try {
        const ingest = requireIngest(ctx.env)
        const res = await lokiQueryRange(ingest, args)
        return ok(JSON.stringify(res))
      } catch (err) {
        return fail(errMessage(err))
      }
    },
  )

  const httpAdminApi = tool(
    'http_admin_api',
    'Call the wgr-logs management API. Only whitelisted /mgmt routes are allowed; mutations are gated. For agent registration the register token is injected automatically (do not include it).',
    {
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
      path: z.string(),
      body: z.record(z.string(), z.unknown()).optional(),
    },
    async (args): Promise<ToolResult> => {
      try {
        const config = requireAdminApi(ctx.env)
        const res = await adminApiCall(config, { method: args.method, path: args.path, body: args.body })
        return ok(JSON.stringify(res))
      } catch (err) {
        return fail(errMessage(err))
      }
    },
  )

  const secretCreate = tool(
    'secret_create',
    'Generate a random hex secret (e.g. a cron token). The value is returned once; place it where needed.',
    { bytes: z.number().optional() },
    async (args): Promise<ToolResult> => {
      const value = createSecret(args.bytes ?? 24)
      ctx.logger.redact(value)
      return ok(value)
    },
  )

  const localFsRead = tool(
    'local_fs_read',
    'Read a local file under the repo root (assets/docs) or the agent workspace.',
    { path: z.string() },
    async (args): Promise<ToolResult> => {
      try {
        return ok(readLocal(args.path, { repoRoot: ctx.repoRoot, workspaceDir: ctx.workspaceDir }))
      } catch (err) {
        return fail(errMessage(err))
      }
    },
  )

  const localFsWrite = tool(
    'local_fs_write',
    'Write a local file inside the agent workspace sandbox.',
    { path: z.string(), content: z.string() },
    async (args): Promise<ToolResult> => {
      try {
        const abs = writeLocal(args.path, args.content, ctx.workspaceDir)
        return ok(`wrote ${abs}`)
      } catch (err) {
        return fail(errMessage(err))
      }
    },
  )

  return createSdkMcpServer({
    name: WGR_SERVER_NAME,
    version: '0.1.0',
    tools: [sshExec, sshGet, sshPut, detectSources, httpLokiQuery, httpAdminApi, secretCreate, localFsRead, localFsWrite],
  })
}
