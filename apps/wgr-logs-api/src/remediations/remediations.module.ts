import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthModule } from '../auth/auth.module'
import { Remediation } from './remediation.entity'
import { RemediationsService } from './remediations.service'
import { RemediationsController } from './remediations.controller'

@Module({
  imports: [TypeOrmModule.forFeature([Remediation]), AuthModule],
  providers: [RemediationsService],
  controllers: [RemediationsController],
})
export class RemediationsModule {}
