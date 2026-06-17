import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Problem } from './problem.entity'
import { UpsertProblemDto } from './dto/upsert-problem.dto'

@Injectable()
export class ProblemsService {
  constructor(
    @InjectRepository(Problem)
    private readonly problems: Repository<Problem>,
  ) {}

  list(project: string): Promise<Problem[]> {
    return this.problems.find({
      where: { project },
      order: { fixabilityScore: 'DESC', count: 'DESC', id: 'ASC' },
    })
  }

  async upsert(project: string, dto: UpsertProblemDto): Promise<Problem> {
    const existing = await this.problems.findOne({ where: { project, signature: dto.signature } })
    if (existing) {
      existing.category = dto.category
      existing.tech = dto.tech ?? null
      existing.patternHash = dto.patternHash ?? null
      existing.file = dto.file ?? null
      existing.line = dto.line ?? null
      existing.sample = dto.sample
      existing.count = dto.count
      existing.fixabilityScore = dto.fixabilityScore
      return this.problems.save(existing)
    }
    const created = this.problems.create({
      project,
      signature: dto.signature,
      category: dto.category,
      tech: dto.tech ?? null,
      patternHash: dto.patternHash ?? null,
      file: dto.file ?? null,
      line: dto.line ?? null,
      sample: dto.sample,
      count: dto.count,
      fixabilityScore: dto.fixabilityScore,
      status: 'open',
    })
    return this.problems.save(created)
  }
}
