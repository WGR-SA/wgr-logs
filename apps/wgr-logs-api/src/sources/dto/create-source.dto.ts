import { IsBoolean, IsEnum, IsInt, IsObject, IsOptional } from 'class-validator'
import { SourceType } from '../source.entity'

const TYPES: SourceType[] = ['pm2', 'cakephp', 'wordpress', 'prestashop', 'nginx', 'journald', 'docker', 'files']

export class CreateSourceDto {
  @IsEnum(TYPES)
  type!: SourceType

  @IsObject()
  config!: Record<string, unknown>

  @IsOptional() @IsBoolean()
  enabled?: boolean

  @IsOptional() @IsInt()
  position?: number
}
