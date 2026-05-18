import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator'
import { AgentStatus } from '../agent.entity'

const STATUSES: AgentStatus[] = ['pending', 'active', 'disabled']

export class UpdateAgentDto {
  @IsOptional() @IsString()
  name?: string

  @IsOptional() @IsString()
  env?: string

  @IsOptional() @IsString()
  cluster?: string

  @IsOptional() @IsEnum(STATUSES)
  status?: AgentStatus
}
