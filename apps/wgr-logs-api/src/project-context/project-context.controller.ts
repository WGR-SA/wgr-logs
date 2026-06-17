import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common'
import { AdminGuard } from '../auth/admin.guard'
import { ProjectContextService } from './project-context.service'
import { UpsertProjectContextDto } from './dto/upsert-project-context.dto'

@Controller('project-context')
@UseGuards(AdminGuard)
export class ProjectContextController {
  constructor(private readonly service: ProjectContextService) {}

  @Get(':repo')
  get(@Param('repo') repo: string) {
    return this.service.get(repo)
  }

  @Put(':repo')
  upsert(@Param('repo') repo: string, @Body() dto: UpsertProjectContextDto) {
    return this.service.upsert(repo, dto)
  }
}
