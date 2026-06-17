import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator'

export class UpdateRemediationDto {
  @IsOptional() @IsString() branch?: string
  @IsOptional() @IsString() prUrl?: string
  @IsOptional() @IsInt() prNumber?: number
  @IsOptional() @IsString() sessionId?: string
  @IsOptional() @IsString() status?: string
  @IsOptional() @IsNumber() @Min(0) costUsd?: number
  @IsOptional() @IsString() summary?: string
  @IsOptional() @IsString() diffStat?: string
  @IsOptional() @IsString() notVerified?: string
  @IsOptional() @IsString() pendingComment?: string
}
