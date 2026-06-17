import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { getDatabaseConfig } from './config/database.config'
import { AuthModule } from './auth/auth.module'
import { AgentsModule } from './agents/agents.module'
import { SourcesModule } from './sources/sources.module'
import { SourceTypesModule } from './source-types/source-types.module'
import { HealthModule } from './health/health.module'
import { ProblemsModule } from './problems/problems.module'
import { RemediationsModule } from './remediations/remediations.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(getDatabaseConfig()),
    AuthModule,
    AgentsModule,
    SourcesModule,
    SourceTypesModule,
    HealthModule,
    ProblemsModule,
    RemediationsModule,
  ],
})
export class AppModule {}
