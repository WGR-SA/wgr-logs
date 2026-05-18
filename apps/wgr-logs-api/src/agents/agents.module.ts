import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthModule } from '../auth/auth.module'
import { Agent } from './agent.entity'
import { Source } from '../sources/source.entity'
import { ConfigVersion } from '../config-versions/config-version.entity'
import { RendererService } from '../config-versions/renderer.service'
import { AgentsService } from './agents.service'
import { AgentsController } from './agents.controller'

@Module({
  imports: [
    TypeOrmModule.forFeature([Agent, Source, ConfigVersion]),
    AuthModule,
  ],
  providers: [AgentsService, RendererService],
  controllers: [AgentsController],
  exports: [AgentsService, TypeOrmModule],
})
export class AgentsModule {}
