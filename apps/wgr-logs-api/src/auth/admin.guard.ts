import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { Request } from 'express'

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>()
    const header = req.headers.authorization
    if (!header) throw new UnauthorizedException('Missing Authorization header')

    const [scheme, token] = header.split(' ')
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Bearer token expected')
    }

    const expected = process.env.ADMIN_TOKEN
    if (!expected) throw new UnauthorizedException('ADMIN_TOKEN not configured')

    if (token !== expected) throw new UnauthorizedException('Invalid admin token')
    return true
  }
}
