import { Controller, Get, UseGuards } from '@nestjs/common'
import { AdminGuard } from '../auth/admin.guard'
import { ProjectsService } from './projects.service'

@Controller('projects')
@UseGuards(AdminGuard)
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  @Get()
  list() {
    return this.service.overview()
  }
}
