import { type Runner, execRunner } from './git.js'

/** Build the `sbx` arg arrays. Exact flags confirmed at the live task; kept pure + tested. */
export function sbxCreateArgs(name: string, workspace: string): string[] {
  return ['create', '--name', name, 'claude', workspace]
}
export function sbxPolicyAllowArgs(name: string, domain: string): string[] {
  return ['policy', 'allow', '--sandbox', name, 'network', domain]
}
export function sbxRunClaudeArgs(name: string, prompt: string): string[] {
  return ['run', '--name', name, '--', '-p', prompt]
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

/** Create an egress-locked claude sandbox over `workspace`, run the prompt headless, capture stdout, always clean up. */
export async function runAgentInSandbox(opts: SandboxOptions, run: Runner = execRunner): Promise<{ resultText: string }> {
  const sbx = async (args: string[]): Promise<string> => {
    const res = await run('sbx', args)
    if (res.code !== 0) throw new Error(`sbx ${args[0]} failed: ${res.stderr.trim()}`)
    return res.stdout
  }
  await sbx(sbxCreateArgs(opts.name, opts.workspace))
  try {
    await sbx(sbxPolicyAllowArgs(opts.name, opts.allowDomain ?? 'api.anthropic.com'))
    const resultText = await sbx(sbxRunClaudeArgs(opts.name, opts.prompt))
    return { resultText }
  } finally {
    await run('sbx', sbxRmArgs(opts.name)) // best-effort cleanup
  }
}
