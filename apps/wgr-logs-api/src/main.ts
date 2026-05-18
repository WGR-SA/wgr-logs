import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common'
import { NestFactory, Reflector } from '@nestjs/core'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true })

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }))

  // Honor @Exclude() on entity fields (e.g. Agent.tokenHash never leaves the API).
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)))

  // /mgmt prefix — coexists with Grafana on <LOGS_DOMAIN>.
  // Routes: https://<LOGS_DOMAIN>/mgmt/agents/..., /source-types, /health
  app.setGlobalPrefix('mgmt')

  const port = Number(process.env.API_PORT ?? 3000)
  await app.listen(port, '0.0.0.0')

  console.log(`[wgr-logs-api] listening on :${port}`)
}

void bootstrap()
