import { Column, CreateDateColumn, Entity, Index, ManyToOne, JoinColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'
import { Problem } from '../problems/problem.entity'

export type RemediationStatus = 'open' | 'fixing' | 'pr_open' | 'needs_input' | 'changes_requested' | 'merged' | 'wontfix'

@Entity('remediations')
export class Remediation {
  @PrimaryGeneratedColumn()
  id!: number

  @Index()
  @Column({ name: 'problem_id', type: 'int' })
  problemId!: number

  @ManyToOne(() => Problem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'problem_id' })
  problem!: Problem

  @Column({ type: 'text' })
  repo!: string

  @Column({ type: 'text', nullable: true })
  branch!: string | null

  @Column({ name: 'pr_url', type: 'text', nullable: true })
  prUrl!: string | null

  @Column({ name: 'pr_number', type: 'int', nullable: true })
  prNumber!: number | null

  @Column({ name: 'session_id', type: 'text', nullable: true })
  sessionId!: string | null

  @Column({ type: 'text', default: 'open' })
  status!: RemediationStatus

  @Column({ name: 'cost_usd', type: 'float', default: 0 })
  costUsd!: number

  @Column({ type: 'text', nullable: true })
  summary!: string | null

  @Column({ name: 'diff_stat', type: 'text', nullable: true })
  diffStat!: string | null

  @Column({ name: 'not_verified', type: 'text', nullable: true })
  notVerified!: string | null

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date
}
