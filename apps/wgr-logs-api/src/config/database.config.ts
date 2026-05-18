import { TypeOrmModuleOptions } from '@nestjs/typeorm'
import { Agent } from '../agents/agent.entity'
import { Source } from '../sources/source.entity'
import { ConfigVersion } from '../config-versions/config-version.entity'

export const getDatabaseConfig = (): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: process.env.PG_HOST ?? 'pg',
  port: parseInt(process.env.PG_PORT ?? '5432', 10),
  username: process.env.PG_USER ?? 'wgrlogs',
  password: process.env.PG_PASSWORD ?? 'wgrlogs',
  database: process.env.PG_DATABASE ?? 'wgr_logs',

  // Explicit entity list (no auto-discovery, WGR convention)
  entities: [Agent, Source, ConfigVersion],

  // synchronize: true → recreates schema from entities on startup.
  // OK pour démarrer (pas de data critique), à remplacer par migrations TypeORM
  // dès qu'on a un volume non-trivial.
  synchronize: true,
  logging: process.env.NODE_ENV === 'development',
})
