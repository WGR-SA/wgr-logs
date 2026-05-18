import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Agent } from '../agents/agent.entity'
import { AdminGuard } from './admin.guard'
import { AgentGuard } from './agent.guard'

@Module({
  imports: [TypeOrmModule.forFeature([Agent])],
  providers: [AdminGuard, AgentGuard],
  exports: [AdminGuard, AgentGuard],
})
export class AuthModule {}
