import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthModule } from '../auth/auth.module'
import { Problem } from './problem.entity'
import { ProblemsService } from './problems.service'
import { ProblemsController } from './problems.controller'

@Module({
  imports: [TypeOrmModule.forFeature([Problem]), AuthModule],
  providers: [ProblemsService],
  controllers: [ProblemsController],
})
export class ProblemsModule {}
