import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Remediation, type RemediationStatus } from './remediation.entity'
import { Problem } from '../problems/problem.entity'
import { CreateRemediationDto } from './dto/create-remediation.dto'
import { UpdateRemediationDto } from './dto/update-remediation.dto'

@Injectable()
export class RemediationsService {
  constructor(
    @InjectRepository(Remediation)
    private readonly remediations: Repository<Remediation>,
    @InjectRepository(Problem)
    private readonly problems: Repository<Problem>,
  ) {}

  list(project: string): Promise<Remediation[]> {
    return this.remediations.find({
      where: { problem: { project } },
      relations: { problem: true },
      order: { updatedAt: 'DESC', id: 'DESC' },
    })
  }

  create(dto: CreateRemediationDto): Promise<Remediation> {
    const created = this.remediations.create({
      problemId: dto.problemId,
      repo: dto.repo,
      branch: dto.branch ?? null,
      prUrl: dto.prUrl ?? null,
      prNumber: dto.prNumber ?? null,
      sessionId: dto.sessionId ?? null,
      status: (dto.status as RemediationStatus | undefined) ?? 'open',
      costUsd: dto.costUsd ?? 0,
      summary: dto.summary ?? null,
      diffStat: dto.diffStat ?? null,
      notVerified: dto.notVerified ?? null,
    })
    return this.remediations.save(created)
  }

  async update(id: number, dto: UpdateRemediationDto): Promise<Remediation> {
    const existing = await this.remediations.findOne({ where: { id } })
    if (!existing) throw new NotFoundException(`remediation ${id} not found`)
    if (dto.branch !== undefined) existing.branch = dto.branch
    if (dto.prUrl !== undefined) existing.prUrl = dto.prUrl
    if (dto.prNumber !== undefined) existing.prNumber = dto.prNumber
    if (dto.sessionId !== undefined) existing.sessionId = dto.sessionId
    if (dto.status !== undefined) existing.status = dto.status as RemediationStatus
    if (dto.costUsd !== undefined) existing.costUsd = dto.costUsd
    if (dto.summary !== undefined) existing.summary = dto.summary
    if (dto.diffStat !== undefined) existing.diffStat = dto.diffStat
    if (dto.notVerified !== undefined) existing.notVerified = dto.notVerified
    if (dto.pendingComment !== undefined) existing.pendingComment = dto.pendingComment
    return this.remediations.save(existing)
  }

  findByPrNumberAndRepo(prNumber: number, repo: string): Promise<Remediation | null> {
    return this.remediations.findOne({ where: { prNumber, repo }, relations: { problem: true } })
  }

  /** Apply a GitHub PR event to the matching remediation. Returns it, or null if no match. */
  async applyWebhookEvent(prNumber: number, repo: string, event: { kind: 'comment'; comment: string } | { kind: 'merged' } | { kind: 'closed' }): Promise<Remediation | null> {
    const rem = await this.findByPrNumberAndRepo(prNumber, repo)
    if (!rem) return null
    if (event.kind === 'comment') {
      rem.status = 'changes_requested'
      rem.pendingComment = event.comment
    } else if (event.kind === 'merged') {
      rem.status = 'merged'
      if (rem.problem) rem.problem.status = 'merged'
    } else {
      rem.status = 'wontfix'
    }
    if (event.kind === 'merged' && rem.problem) await this.problems.save(rem.problem)
    return this.remediations.save(rem)
  }
}
