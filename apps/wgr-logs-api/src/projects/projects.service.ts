import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Problem } from '../problems/problem.entity'
import { Remediation } from '../remediations/remediation.entity'

export interface ProjectOverview {
  name: string
  problemsTotal: number
  problemsOpen: number
  remediationsTotal: number
  prOpen: number
  changesRequested: number
  merged: number
  failed: number
}

/** Aggregates the medic's per-project state for the desktop overview. */
@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Problem)
    private readonly problems: Repository<Problem>,
    @InjectRepository(Remediation)
    private readonly remediations: Repository<Remediation>,
  ) {}

  async overview(): Promise<ProjectOverview[]> {
    const [problems, remediations] = await Promise.all([
      this.problems.find(),
      this.remediations.find({ relations: { problem: true } }),
    ])

    const byName = new Map<string, ProjectOverview>()
    const row = (name: string): ProjectOverview => {
      let o = byName.get(name)
      if (!o) {
        o = { name, problemsTotal: 0, problemsOpen: 0, remediationsTotal: 0, prOpen: 0, changesRequested: 0, merged: 0, failed: 0 }
        byName.set(name, o)
      }
      return o
    }

    for (const p of problems) {
      const o = row(p.project)
      o.problemsTotal++
      if (p.status === 'open') o.problemsOpen++
    }
    for (const r of remediations) {
      const name = r.problem?.project
      if (!name) continue
      const o = row(name)
      o.remediationsTotal++
      if (r.status === 'pr_open') o.prOpen++
      else if (r.status === 'changes_requested') o.changesRequested++
      else if (r.status === 'merged') o.merged++
      else if (r.status === 'failed') o.failed++
    }

    return [...byName.values()].sort(
      (a, b) =>
        b.changesRequested - a.changesRequested ||
        b.problemsOpen - a.problemsOpen ||
        a.name.localeCompare(b.name),
    )
  }
}
