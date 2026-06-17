import { Injectable } from '@nestjs/common'
import { RemediationsService } from '../remediations/remediations.service'

@Injectable()
export class WebhooksService {
  constructor(private readonly remediations: RemediationsService) {}

  /** Map a parsed GitHub event to a remediation update. Returns true if a remediation matched. */
  async handle(eventName: string, payload: Record<string, unknown>): Promise<boolean> {
    const pr = (payload.pull_request ?? payload.issue) as { number?: number; pull_request?: unknown } | undefined
    const prNumber = typeof pr?.number === 'number' ? pr.number : undefined
    if (prNumber === undefined) return false

    if (eventName === 'issue_comment' && payload.action === 'created') {
      const body = ((payload.comment as { body?: string } | undefined)?.body ?? '').toString()
      return (await this.remediations.applyWebhookEvent(prNumber, { kind: 'comment', comment: body })) !== null
    }
    if (eventName === 'pull_request_review' && payload.action === 'submitted') {
      const state = ((payload.review as { state?: string } | undefined)?.state ?? '').toUpperCase()
      if (state === 'APPROVED') return false
      const body = ((payload.review as { body?: string } | undefined)?.body ?? '').toString()
      return (await this.remediations.applyWebhookEvent(prNumber, { kind: 'comment', comment: body })) !== null
    }
    if (eventName === 'pull_request' && payload.action === 'closed') {
      const merged = (payload.pull_request as { merged?: boolean } | undefined)?.merged === true
      return (await this.remediations.applyWebhookEvent(prNumber, merged ? { kind: 'merged' } : { kind: 'closed' })) !== null
    }
    return false
  }
}
