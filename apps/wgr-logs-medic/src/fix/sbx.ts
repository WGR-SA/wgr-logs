import { type Runner, execRunner } from './git.js'

const SBX_CPUS = Number(process.env.WGR_MEDIC_SBX_CPUS ?? '2')

export function sbxSetDefaultDenyArgs(): string[] {
  return ['policy', 'set-default', 'deny-all']
}
export function sbxCreateArgs(name: string, workspace: string, cpus: number = SBX_CPUS): string[] {
  return ['create', '--name', name, '--cpus', String(cpus), 'claude', workspace]
}
export function sbxPolicyAllowArgs(name: string, domain: string): string[] {
  return ['policy', 'allow', 'network', '--sandbox', name, domain]
}
export function sbxExecClaudeArgs(name: string, prompt: string): string[] {
  return ['exec', name, 'claude', '-p', prompt]
}
export function sbxRmArgs(name: string): string[] {
  return ['rm', '--force', name]
}

export interface SandboxOptions {
  name: string
  workspace: string
  prompt: string
  allowDomain?: string
}

/** Run the fix agent as native claude inside an egress-locked sbx microVM over `workspace`; return its stdout. Always cleans up. */
export async function runAgentInSandbox(opts: SandboxOptions, run: Runner = execRunner): Promise<{ resultText: string }> {
  const sbx = async (args: string[]): Promise<string> => {
    const res = await run('sbx', args)
    if (res.code !== 0) throw new Error(`sbx ${args[0]} failed: ${res.stderr.trim()}`)
    return res.stdout
  }
  await sbx(sbxSetDefaultDenyArgs()) // idempotent baseline: deny all egress
  await sbx(sbxCreateArgs(opts.name, opts.workspace))
  try {
    await sbx(sbxPolicyAllowArgs(opts.name, opts.allowDomain ?? 'api.anthropic.com'))
    const resultText = await sbx(sbxExecClaudeArgs(opts.name, opts.prompt))
    return { resultText }
  } finally {
    await run('sbx', sbxRmArgs(opts.name)) // best-effort cleanup
  }
}
