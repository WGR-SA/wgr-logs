import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm'
import { Agent } from '../agents/agent.entity'

@Entity('config_versions')
@Index(['agent', 'etag'])
export class ConfigVersion {
  @PrimaryGeneratedColumn()
  id!: number

  @ManyToOne(() => Agent, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'agent_id' })
  agent!: Agent

  @Column()
  etag!: string

  @Column({ type: 'jsonb' })
  rendered!: Record<string, unknown>

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date
}
