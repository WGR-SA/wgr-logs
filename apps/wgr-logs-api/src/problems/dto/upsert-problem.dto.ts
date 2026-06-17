import { IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator'

export class UpsertProblemDto {
  @IsString() signature!: string
  @IsString() category!: string
  @IsOptional() @IsString() file?: string
  @IsOptional() @IsInt() line?: number
  @IsString() sample!: string
  @IsInt() @Min(0) count!: number
  @IsNumber() @Min(0) @Max(1) fixabilityScore!: number
}
