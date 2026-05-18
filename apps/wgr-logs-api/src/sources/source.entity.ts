import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import { Agent } from '../agents/agent.entity'

export type SourceType =
  | 'pm2'
  | 'cakephp'
  | 'wordpress'
  | 'prestashop'
  | 'nginx'
  | 'journald'
  | 'docker'
  | 'files'

@Entity('sources')
export class Source {
  @PrimaryGeneratedColumn()
  id!: number

  @Index()
  @ManyToOne(() => Agent, (a) => a.sources, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'agent_id' })
  agent!: Agent

  @Column({ type: 'text' })
  type!: SourceType

  @Column({ type: 'jsonb' })
  config!: Record<string, unknown>

  @Column({ default: true })
  enabled!: boolean

  @Column({ default: 0 })
  position!: number

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date
}
