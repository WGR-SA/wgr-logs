import { Controller, Get } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'

@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Get()
  async check() {
    try {
      await this.ds.query('SELECT 1')
      return { status: 'ok', database: 'ok' }
    } catch (e) {
      return { status: 'degraded', database: 'down', error: (e as Error).message }
    }
  }
}
