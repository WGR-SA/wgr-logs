import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { randomBytes } from 'crypto'
import * as bcrypt from 'bcryptjs'
import { Agent } from './agent.entity'
import { Source } from '../sources/source.entity'
import { ConfigVersion } from '../config-versions/config-version.entity'
import { RendererService } from '../config-versions/renderer.service'
import { RegisterAgentDto } from './dto/register-agent.dto'
import { UpdateAgentDto } from './dto/update-agent.dto'
import { HeartbeatDto } from './dto/heartbeat.dto'

export interface RegisterResult {
  agent_id: string
  agent_token: string
  status: 'pending'
}

@Injectable()
export class AgentsService {
  constructor(
    @InjectRepository(Agent)
    private readonly agents: Repository<Agent>,
    @InjectRepository(Source)
    private readonly sources: Repository<Source>,
    @InjectRepository(ConfigVersion)
    private readonly versions: Repository<ConfigVersion>,
    private readonly renderer: RendererService,
  ) {}

  async register(dto: RegisterAgentDto): Promise<RegisterResult> {
    const expected = process.env.REGISTER_TOKEN ?? process.env.ADMIN_TOKEN
    if (!expected) throw new UnauthorizedException('Registration disabled (no token configured)')
    if (dto.register_token !== expected) throw new UnauthorizedException('Invalid register token')

    const rawToken = randomBytes(24).toString('hex')
    const tokenHash = await bcrypt.hash(rawToken, 10)

    const agent = this.agents.create({
      name: dto.name,
      hostname: dto.hostname ?? null,
      shipperKind: dto.shipper_kind ?? 'unknown',
      shipperVer: dto.shipper_ver ?? null,
      env: dto.env ?? 'prod',
      tokenHash,
      status: 'pending',
    })
    const saved = await this.agents.save(agent)

    return {
      agent_id: saved.id,
      agent_token: rawToken,
      status: 'pending',
    }
  }

  async list(): Promise<Agent[]> {
    return this.agents.find({
      relations: { sources: true },
      order: { createdAt: 'DESC' },
    })
  }

  async findOne(id: string): Promise<Agent> {
    const agent = await this.agents.findOne({
      where: { id },
      relations: { sources: true },
    })
    if (!agent) throw new NotFoundException(`Agent ${id} not found`)
    return agent
  }

  async update(id: string, dto: UpdateAgentDto): Promise<Agent> {
    const agent = await this.findOne(id)
    Object.assign(agent, dto)
    return this.agents.save(agent)
  }

  async remove(id: string): Promise<void> {
    const result = await this.agents.delete(id)
    if (result.affected === 0) throw new NotFoundException(`Agent ${id} not found`)
  }

  async heartbeat(agent: Agent, dto: HeartbeatDto): Promise<{ ok: true }> {
    agent.lastSeen = new Date()
    if (dto.hostname) agent.hostname = dto.hostname
    if (dto.shipper_ver) agent.shipperVer = dto.shipper_ver
    if (agent.status === 'pending') agent.status = 'active'
    await this.agents.save(agent)
    return { ok: true }
  }

  async getConfig(agent: Agent): Promise<{ etag: string; rendered: unknown }> {
    const sources = await this.sources.find({
      where: { agent: { id: agent.id } },
      order: { position: 'ASC', id: 'ASC' },
    })
    const { rendered, etag } = this.renderer.render(agent, sources)

    // Store the version if it's new
    const existing = await this.versions.findOne({
      where: { agent: { id: agent.id }, etag },
    })
    if (!existing) {
      const version = this.versions.create({
        agent,
        etag,
        rendered: rendered as unknown as Record<string, unknown>,
      })
      await this.versions.save(version)
    }

    // Also bump last_seen on every config poll
    agent.lastSeen = new Date()
    if (agent.status === 'pending') agent.status = 'active'
    await this.agents.save(agent)

    return { etag, rendered }
  }
}
