import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import { AdminGuard } from '../auth/admin.guard'
import { ProblemsService } from './problems.service'
import { UpsertProblemDto } from './dto/upsert-problem.dto'

@Controller('projects/:project/problems')
@UseGuards(AdminGuard)
export class ProblemsController {
  constructor(private readonly service: ProblemsService) {}

  @Get()
  list(@Param('project') project: string) {
    return this.service.list(project)
  }

  @Post()
  @HttpCode(200)
  upsert(@Param('project') project: string, @Body() dto: UpsertProblemDto) {
    return this.service.upsert(project, dto)
  }
}
