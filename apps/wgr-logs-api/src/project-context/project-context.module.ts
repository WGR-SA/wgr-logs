import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthModule } from '../auth/auth.module'
import { ProjectContext } from './project-context.entity'
import { ProjectContextService } from './project-context.service'
import { ProjectContextController } from './project-context.controller'

@Module({
  imports: [TypeOrmModule.forFeature([ProjectContext]), AuthModule],
  providers: [ProjectContextService],
  controllers: [ProjectContextController],
})
export class ProjectContextModule {}
