import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common'
import { AdminGuard } from '../auth/admin.guard'
import { SourcesService } from './sources.service'
import { CreateSourceDto } from './dto/create-source.dto'
import { UpdateSourceDto } from './dto/update-source.dto'

@Controller('agents/:agentId/sources')
@UseGuards(AdminGuard)
export class SourcesController {
  constructor(private readonly service: SourcesService) {}

  @Get()
  list(@Param('agentId', ParseUUIDPipe) agentId: string) {
    return this.service.list(agentId)
  }

  @Post()
  @HttpCode(201)
  create(@Param('agentId', ParseUUIDPipe) agentId: string, @Body() dto: CreateSourceDto) {
    return this.service.create(agentId, dto)
  }

  @Put(':sourceId')
  update(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Param('sourceId', ParseIntPipe) sourceId: number,
    @Body() dto: UpdateSourceDto,
  ) {
    return this.service.update(agentId, sourceId, dto)
  }

  @Delete(':sourceId')
  @HttpCode(204)
  async remove(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Param('sourceId', ParseIntPipe) sourceId: number,
  ): Promise<void> {
    await this.service.remove(agentId, sourceId)
  }
}
