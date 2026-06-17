import { createHash } from 'node:crypto'
import type { ParsedError } from '../types.js'

const TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\s*/
const EXCEPTION = /\[([A-Za-z0-9_\\]+(?:Exception|Error))\]/
// "(/abs/path.ext:123)" or "[/abs/path.ext, line 123]"
const FILE_PAREN = /\((\/[^():]+):(\d+)\)/
const FILE_BRACKET = /\[(\/[^\],]+),\s*line\s*(\d+)\]/

/** Collapse volatile bits so recurring occurrences share a template. */
function templatize(message: string): string {
  return message
    .replace(/'[^']*'/g, "'S'") // single-quoted strings
    .replace(/"[^"]*"/g, '"S"') // double-quoted strings
    .replace(/\b\d+\b/g, '#') // bare numbers (line numbers, ids, counts)
    .replace(/\/[^\s():,\]]+/g, '<path>') // absolute paths
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseError(rawLine: string): ParsedError {
  const line = rawLine.replace(TIMESTAMP, '')

  const colon = line.indexOf(':')
  const category = colon === -1 ? 'Unknown' : line.slice(0, colon).trim().split(/\s+/)[0]

  const exMatch = EXCEPTION.exec(line)
  const exceptionClass = exMatch ? exMatch[1] : undefined

  const fileMatch = FILE_PAREN.exec(line) ?? FILE_BRACKET.exec(line)
  const file = fileMatch ? fileMatch[1] : undefined
  const lineNo = fileMatch ? Number.parseInt(fileMatch[2], 10) : undefined

  const template = templatize(line)

  const signature = createHash('sha256')
    .update([category, exceptionClass ?? '', file ?? '', template].join('\n'))
    .digest('hex')
    .slice(0, 16)

  return { signature, category, exceptionClass, file, line: lineNo, template }
}
