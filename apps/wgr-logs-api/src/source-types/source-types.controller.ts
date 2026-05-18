import { Controller, Get, UseGuards } from '@nestjs/common'
import { AdminGuard } from '../auth/admin.guard'
import { readFileSync } from 'fs'
import { join } from 'path'

let cachedSchema: unknown | null = null

function loadSchema(): unknown {
  if (cachedSchema) return cachedSchema
  // The shipper modules schema is bundled into the API image at build time
  // (see Dockerfile: COPY packages/alloy-modules/schemas /opt/wgr-logs-api/schemas)
  const path = join(__dirname, '..', '..', 'schemas', 'source-types.json')
  cachedSchema = JSON.parse(readFileSync(path, 'utf8'))
  return cachedSchema
}

@Controller('source-types')
@UseGuards(AdminGuard)
export class SourceTypesController {
  @Get()
  getCatalog() {
    return loadSchema()
  }
}
