import { IsBoolean, IsInt, IsObject, IsOptional } from 'class-validator'

export class UpdateSourceDto {
  @IsOptional() @IsObject()
  config?: Record<string, unknown>

  @IsOptional() @IsBoolean()
  enabled?: boolean

  @IsOptional() @IsInt()
  position?: number
}
