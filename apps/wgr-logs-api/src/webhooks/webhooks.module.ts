import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Remediation } from '../remediations/remediation.entity'
import { Problem } from '../problems/problem.entity'
import { RemediationsService } from '../remediations/remediations.service'
import { WebhooksService } from './webhooks.service'
import { WebhooksController } from './webhooks.controller'

@Module({
  imports: [TypeOrmModule.forFeature([Remediation, Problem])],
  providers: [WebhooksService, RemediationsService],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
