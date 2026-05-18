import { IsEnum, IsOptional, IsString } from 'class-validator'
import { ShipperKind } from '../agent.entity'

const SHIPPER_KINDS: ShipperKind[] = ['docker', 'bash', 'php', 'cf-tail', 'browser', 'unknown']

export class RegisterAgentDto {
  // The shipper sends its desired display name + actual hostname.
  // Admin can rename via PUT later.
  @IsString()
  name!: string

  @IsOptional()
  @IsString()
  hostname?: string

  @IsOptional()
  @IsEnum(SHIPPER_KINDS)
  shipper_kind?: ShipperKind

  @IsOptional()
  @IsString()
  shipper_ver?: string

  @IsOptional()
  @IsString()
  env?: string

  // Register token: must equal env REGISTER_TOKEN (or admin token).
  @IsString()
  register_token!: string
}
