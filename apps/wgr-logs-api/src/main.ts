import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true })

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }))

  // All routes are prefixed by /api (Traefik strips host but not prefix)
  app.setGlobalPrefix('api')

  const port = Number(process.env.API_PORT ?? 3000)
  await app.listen(port, '0.0.0.0')

  console.log(`[wgr-logs-api] listening on :${port}`)
}

void bootstrap()
