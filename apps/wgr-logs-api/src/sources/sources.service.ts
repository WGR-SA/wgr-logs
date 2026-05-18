import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Source } from './source.entity'
import { Agent } from '../agents/agent.entity'
import { CreateSourceDto } from './dto/create-source.dto'
import { UpdateSourceDto } from './dto/update-source.dto'

@Injectable()
export class SourcesService {
  constructor(
    @InjectRepository(Source)
    private readonly sources: Repository<Source>,
    @InjectRepository(Agent)
    private readonly agents: Repository<Agent>,
  ) {}

  async list(agentId: string): Promise<Source[]> {
    return this.sources.find({
      where: { agent: { id: agentId } },
      order: { position: 'ASC', id: 'ASC' },
    })
  }

  async create(agentId: string, dto: CreateSourceDto): Promise<Source> {
    const agent = await this.agents.findOne({ where: { id: agentId } })
    if (!agent) throw new NotFoundException(`Agent ${agentId} not found`)

    const source = this.sources.create({
      agent,
      type: dto.type,
      config: dto.config,
      enabled: dto.enabled ?? true,
      position: dto.position ?? 0,
    })
    return this.sources.save(source)
  }

  async update(agentId: string, sourceId: number, dto: UpdateSourceDto): Promise<Source> {
    const source = await this.sources.findOne({
      where: { id: sourceId, agent: { id: agentId } },
    })
    if (!source) throw new NotFoundException(`Source ${sourceId} not found on agent ${agentId}`)

    Object.assign(source, dto)
    return this.sources.save(source)
  }

  async remove(agentId: string, sourceId: number): Promise<void> {
    const result = await this.sources.delete({ id: sourceId, agent: { id: agentId } })
    if (result.affected === 0) throw new NotFoundException(`Source ${sourceId} not found on agent ${agentId}`)
  }
}
