import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthModule } from '../auth/auth.module'
import { Source } from './source.entity'
import { Agent } from '../agents/agent.entity'
import { SourcesService } from './sources.service'
import { SourcesController } from './sources.controller'

@Module({
  imports: [
    TypeOrmModule.forFeature([Source, Agent]),
    AuthModule,
  ],
  providers: [SourcesService],
  controllers: [SourcesController],
})
export class SourcesModule {}
