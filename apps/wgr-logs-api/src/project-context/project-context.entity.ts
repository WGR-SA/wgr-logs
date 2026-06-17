import { Column, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm'

@Entity('project_context')
@Unique(['repo'])
export class ProjectContext {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'text' })
  repo!: string

  @Column({ type: 'text', nullable: true })
  tech!: string | null

  @Column({ type: 'text' })
  summary!: string

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date
}
