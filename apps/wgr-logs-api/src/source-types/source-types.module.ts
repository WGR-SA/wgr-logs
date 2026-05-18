import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { SourceTypesController } from './source-types.controller'

@Module({
  imports: [AuthModule],
  controllers: [SourceTypesController],
})
export class SourceTypesModule {}
