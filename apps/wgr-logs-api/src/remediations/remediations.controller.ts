import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common'
import { AdminGuard } from '../auth/admin.guard'
import { RemediationsService } from './remediations.service'
import { CreateRemediationDto } from './dto/create-remediation.dto'
import { UpdateRemediationDto } from './dto/update-remediation.dto'

@Controller()
@UseGuards(AdminGuard)
export class RemediationsController {
  constructor(private readonly service: RemediationsService) {}

  @Get('projects/:project/remediations')
  list(@Param('project') project: string) {
    return this.service.list(project)
  }

  @Post('projects/:project/remediations')
  create(@Body() dto: CreateRemediationDto) {
    return this.service.create(dto)
  }

  @Patch('remediations/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRemediationDto) {
    return this.service.update(id, dto)
  }
}
