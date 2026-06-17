import { randomBytes } from 'node:crypto'

/** Generate a random hex secret (e.g. for `.cron-token`). Never logged. */
export function createSecret(bytes = 24): string {
  return randomBytes(bytes).toString('hex')
}
