import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common'
import { Request } from 'express'
import { AdminGuard } from '../auth/admin.guard'
import { AgentGuard } from '../auth/agent.guard'
import { AgentsService } from './agents.service'
import { Agent } from './agent.entity'
import { RegisterAgentDto } from './dto/register-agent.dto'
import { UpdateAgentDto } from './dto/update-agent.dto'
import { HeartbeatDto } from './dto/heartbeat.dto'

@Controller('agents')
export class AgentsController {
  constructor(private readonly service: AgentsService) {}

  // --- Public: shipper enrolment ---
  @Post('register')
  @HttpCode(201)
  register(@Body() dto: RegisterAgentDto) {
    return this.service.register(dto)
  }

  // --- Admin: CRUD ---
  @Get()
  @UseGuards(AdminGuard)
  list(): Promise<Agent[]> {
    return this.service.list()
  }

  @Get(':id')
  @UseGuards(AdminGuard)
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Agent> {
    return this.service.findOne(id)
  }

  @Put(':id')
  @UseGuards(AdminGuard)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAgentDto): Promise<Agent> {
    return this.service.update(id, dto)
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.service.remove(id)
  }

  // --- Agent (Bearer agent_token) ---
  @Get(':id/config')
  @UseGuards(AgentGuard)
  getConfig(@Req() req: Request) {
    return this.service.getConfig(req.agent!)
  }

  @Post(':id/heartbeat')
  @HttpCode(200)
  @UseGuards(AgentGuard)
  heartbeat(@Req() req: Request, @Body() dto: HeartbeatDto) {
    return this.service.heartbeat(req.agent!, dto)
  }
}
