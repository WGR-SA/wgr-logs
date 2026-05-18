import { IsOptional, IsString } from 'class-validator'

export class HeartbeatDto {
  @IsOptional()
  @IsString()
  hostname?: string

  @IsOptional()
  @IsString()
  shipper_ver?: string
}
