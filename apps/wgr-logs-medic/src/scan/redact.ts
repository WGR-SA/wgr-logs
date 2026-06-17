const RULES: Array<[RegExp, string]> = [
  // AWS access key IDs
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED]'],
  // Bearer tokens
  [/\bBearer\s+[A-Za-z0-9._-]{20,}/g, 'Bearer [REDACTED]'],
  // sensitive key=value / key: value (quoted or bare)
  [/\b(password|passwd|secret|token|api[_-]?key|access[_-]?key|authorization)\b(\s*[=:]\s*)("?)[^\s"]+\3/gi, '$1$2[REDACTED]'],
  // long hex/base64 blobs (>=32 chars)
  [/\b[A-Za-z0-9+/]{32,}={0,2}\b/g, '[REDACTED]'],
]

export function redact(input: string): string {
  let out = input
  for (const [re, repl] of RULES) out = out.replace(re, repl)
  return out
}
