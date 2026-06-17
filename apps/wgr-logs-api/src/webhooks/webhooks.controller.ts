import { BadRequestException, Controller, Headers, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common'
import type { RawBodyRequest } from '@nestjs/common'
import type { Request } from 'express'
import { verifyGithubSignature } from './github-signature'
import { WebhooksService } from './webhooks.service'

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}

  @Post('github')
  @HttpCode(204)
  async github(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-event') event: string | undefined,
  ): Promise<void> {
    const secret = process.env.GITHUB_WEBHOOK_SECRET
    if (!secret) throw new UnauthorizedException('GITHUB_WEBHOOK_SECRET not configured')
    const raw = req.rawBody
    if (!raw) throw new BadRequestException('missing raw body')
    if (!verifyGithubSignature(raw, signature, secret)) throw new UnauthorizedException('bad signature')
    const payload = JSON.parse(raw.toString('utf8')) as Record<string, unknown>
    await this.service.handle(event ?? '', payload)
  }
}
