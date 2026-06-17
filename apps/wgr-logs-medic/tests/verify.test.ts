import { describe, expect, it } from 'vitest'
import { planChecks } from '../src/fix/verify.js'

describe('planChecks', () => {
  it('lints each changed PHP file with php -l', () => {
    const plan = planChecks(['src/a.php', 'src/b.php', 'README.md'], () => false)
    expect(plan.filter((c) => c.cmd === 'php')).toEqual([
      { cmd: 'php', args: ['-l', 'src/a.php'] },
      { cmd: 'php', args: ['-l', 'src/b.php'] },
    ])
  })

  it('adds phpstan when configured', () => {
    const plan = planChecks(['src/a.php'], (f) => f === 'phpstan.neon')
    expect(plan.some((c) => c.cmd === 'vendor/bin/phpstan')).toBe(true)
  })

  it('adds phpunit when configured', () => {
    const plan = planChecks(['src/a.php'], (f) => f === 'phpunit.xml')
    expect(plan.some((c) => c.cmd === 'vendor/bin/phpunit')).toBe(true)
  })

  it('no PHP files -> no php -l checks', () => {
    expect(planChecks(['README.md'], () => false).filter((c) => c.cmd === 'php')).toEqual([])
  })
})
