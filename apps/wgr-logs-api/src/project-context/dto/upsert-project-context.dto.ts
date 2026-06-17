import { IsOptional, IsString } from 'class-validator'

export class UpsertProjectContextDto {
  @IsOptional() @IsString() tech?: string
  @IsString() summary!: string
}
