import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Request } from 'express'
import * as bcrypt from 'bcryptjs'
import { Agent } from '../agents/agent.entity'

declare module 'express' {
  interface Request {
    agent?: Agent
  }
}

@Injectable()
export class AgentGuard implements CanActivate {
  constructor(
    @InjectRepository(Agent)
    private readonly agents: Repository<Agent>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>()
    const agentId = req.params?.id
    if (!agentId) throw new UnauthorizedException('Missing agent id in path')

    const header = req.headers.authorization
    if (!header) throw new UnauthorizedException('Missing Authorization header')

    const [scheme, token] = header.split(' ')
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Bearer token expected')
    }

    const agent = await this.agents.findOne({ where: { id: agentId } })
    if (!agent) throw new UnauthorizedException('Unknown agent')

    const ok = await bcrypt.compare(token, agent.tokenHash)
    if (!ok) throw new UnauthorizedException('Invalid agent token')

    req.agent = agent
    return true
  }
}
