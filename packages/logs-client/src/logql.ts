import type { LogLevel } from './types.js'

type LabelOp = '=' | '!=' | '=~' | '!~'

interface LabelMatcher {
  name: string
  op: LabelOp
  value: string
}

const LABEL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export class LogQL {
  private readonly matchers: LabelMatcher[] = []
  private readonly filters: string[] = []

  static stream(matchers: Record<string, string> = {}): LogQL {
    const q = new LogQL()
    for (const [k, v] of Object.entries(matchers)) q.eq(k, v)
    return q
  }

  eq(name: string, value: string): this {
    return this.match(name, '=', value)
  }

  neq(name: string, value: string): this {
    return this.match(name, '!=', value)
  }

  regex(name: string, pattern: string): this {
    return this.match(name, '=~', pattern)
  }

  notRegex(name: string, pattern: string): this {
    return this.match(name, '!~', pattern)
  }

  level(level: LogLevel): this {
    return this.eq('level', level)
  }

  app(name: string): this {
    return this.eq('app', name)
  }

  env(env: string): this {
    return this.eq('env', env)
  }

  contains(text: string): this {
    this.filters.push(`|= \`${text}\``)
    return this
  }

  notContains(text: string): this {
    this.filters.push(`!= \`${text}\``)
    return this
  }

  matches(pattern: string): this {
    this.filters.push(`|~ \`${pattern}\``)
    return this
  }

  containsLiteral(text: string): this {
    return this.matches(escapeRegex(text))
  }

  toString(): string {
    if (this.matchers.length === 0) {
      throw new Error('LogQL requires at least one label matcher')
    }
    const labels = this.matchers
      .map(({ name, op, value }) => `${name}${op}"${escapeLabelValue(value)}"`)
      .join(', ')
    const tail = this.filters.length > 0 ? ' ' + this.filters.join(' ') : ''
    return `{${labels}}${tail}`
  }

  private match(name: string, op: LabelOp, value: string): this {
    if (!LABEL_NAME.test(name)) {
      throw new Error(`Invalid LogQL label name: ${name}`)
    }
    this.matchers.push({ name, op, value })
    return this
  }
}

export const logql = (matchers: Record<string, string> = {}) => LogQL.stream(matchers)
