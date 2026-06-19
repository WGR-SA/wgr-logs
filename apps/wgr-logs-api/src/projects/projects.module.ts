import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthModule } from '../auth/auth.module'
import { Problem } from '../problems/problem.entity'
import { Remediation } from '../remediations/remediation.entity'
import { ProjectsService } from './projects.service'
import { ProjectsController } from './projects.controller'

@Module({
  imports: [TypeOrmModule.forFeature([Problem, Remediation]), AuthModule],
  providers: [ProjectsService],
  controllers: [ProjectsController],
})
export class ProjectsModule {}
