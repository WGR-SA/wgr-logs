import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ProjectContext } from './project-context.entity'
import { UpsertProjectContextDto } from './dto/upsert-project-context.dto'

@Injectable()
export class ProjectContextService {
  constructor(
    @InjectRepository(ProjectContext)
    private readonly contexts: Repository<ProjectContext>,
  ) {}

  get(repo: string): Promise<ProjectContext | null> {
    return this.contexts.findOne({ where: { repo } })
  }

  async upsert(repo: string, dto: UpsertProjectContextDto): Promise<ProjectContext> {
    const existing = await this.contexts.findOne({ where: { repo } })
    if (existing) {
      existing.tech = dto.tech ?? null
      existing.summary = dto.summary
      return this.contexts.save(existing)
    }
    return this.contexts.save(this.contexts.create({ repo, tech: dto.tech ?? null, summary: dto.summary }))
  }
}
