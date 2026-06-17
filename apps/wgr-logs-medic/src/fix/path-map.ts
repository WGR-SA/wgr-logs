/** Map a stack-trace server path to a repo-relative path by stripping the project's pathPrefix. */
export function mapServerPath(serverPath: string, pathPrefix?: string): string | null {
  if (!serverPath) return null
  if (!pathPrefix) return serverPath.replace(/^\/+/, '') || null
  const prefix = pathPrefix.replace(/\/+$/, '')
  if (serverPath !== prefix && !serverPath.startsWith(`${prefix}/`)) return null
  return serverPath.slice(prefix.length).replace(/^\/+/, '') || null
}
