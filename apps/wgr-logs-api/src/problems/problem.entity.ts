import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm'

export type ProblemStatus = 'open' | 'fixing' | 'pr' | 'merged' | 'wontfix'

@Entity('problems')
@Unique(['project', 'signature'])
export class Problem {
  @PrimaryGeneratedColumn()
  id!: number

  @Index()
  @Column({ type: 'text' })
  project!: string

  @Column({ type: 'text' })
  signature!: string

  @Column({ type: 'text' })
  category!: string

  @Column({ type: 'text', nullable: true })
  tech!: string | null

  @Index()
  @Column({ name: 'pattern_hash', type: 'text', nullable: true })
  patternHash!: string | null

  @Column({ type: 'text', nullable: true })
  file!: string | null

  @Column({ type: 'int', nullable: true })
  line!: number | null

  @Column({ type: 'text' })
  sample!: string

  @Column({ type: 'int', default: 0 })
  count!: number

  @Column({ name: 'fixability_score', type: 'float', default: 0 })
  fixabilityScore!: number

  @Column({ type: 'text', default: 'open' })
  status!: ProblemStatus

  @CreateDateColumn({ name: 'first_seen', type: 'timestamptz' })
  firstSeen!: Date

  @UpdateDateColumn({ name: 'last_seen', type: 'timestamptz' })
  lastSeen!: Date
}
