import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import { Exclude } from 'class-transformer'
import { Source } from '../sources/source.entity'

export type AgentStatus = 'pending' | 'active' | 'disabled'
export type ShipperKind = 'docker' | 'bash' | 'php' | 'cf-tail' | 'browser' | 'unknown'

@Entity('agents')
export class Agent {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column()
  name!: string

  @Column({ nullable: true, type: 'text' })
  hostname!: string | null

  @Column({ default: 'prod' })
  env!: string

  @Column({ default: 'wgr-prod' })
  cluster!: string

  @Exclude()
  @Column({ name: 'token_hash' })
  tokenHash!: string

  @Column({ name: 'shipper_kind', nullable: true, type: 'text' })
  shipperKind!: ShipperKind | null

  @Column({ name: 'shipper_ver', nullable: true, type: 'text' })
  shipperVer!: string | null

  @Index()
  @Column({ type: 'text', default: 'pending' })
  status!: AgentStatus

  @Column({ name: 'last_seen', type: 'timestamptz', nullable: true })
  lastSeen!: Date | null

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date

  @OneToMany(() => Source, (s) => s.agent, { cascade: true })
  sources!: Source[]
}
