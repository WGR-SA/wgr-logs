import { createHmac, timingSafeEqual } from 'crypto'

/** Verify a GitHub `X-Hub-Signature-256` header (`sha256=<hex>`) against the raw body + secret. */
export function verifyGithubSignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature) return false
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}
