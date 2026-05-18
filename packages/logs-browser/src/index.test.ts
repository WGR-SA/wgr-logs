/**
 * Basic unit tests for @wgr/logs-browser.
 * Run with: npm test -w @wgr/logs-browser
 *
 * Uses vitest's default environment (node), so we mock fetch + DOM where needed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { initLogger } from './index.js'

describe('logs-browser', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 })
    // @ts-expect-error inject global fetch
    globalThis.fetch = fetchMock
    // Pretend we're in a browser
    // @ts-expect-error
    globalThis.window = { addEventListener: vi.fn(), removeEventListener: vi.fn() }
    // @ts-expect-error
    globalThis.navigator = { userAgent: 'test-ua', sendBeacon: vi.fn(() => true) }
    // @ts-expect-error
    globalThis.location = { href: 'https://test.example.com/page' }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    // @ts-expect-error
    delete globalThis.window
    // @ts-expect-error
    delete globalThis.navigator
    // @ts-expect-error
    delete globalThis.location
    // @ts-expect-error
    delete globalThis.fetch
  })

  it('flushes a batch on demand', async () => {
    const logger = initLogger({
      collector: 'https://col.example.com',
      app: 'test-app',
      env: 'dev',
      autoHook: false,
    })
    logger.info('hello world', { user_count: 42 })
    await logger.flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://col.example.com/push')
    const body = JSON.parse(init.body)
    expect(body.app).toBe('test-app')
    expect(body.env).toBe('dev')
    expect(body.logs).toHaveLength(1)
    expect(body.logs[0]).toMatchObject({
      level: 'info',
      msg: 'hello world',
      ctx: { user_count: 42 },
      url: 'https://test.example.com/page',
      ua: 'test-ua',
    })

    await logger.destroy()
  })

  it('batches multiple lines into one request', async () => {
    const logger = initLogger({
      collector: 'https://col.example.com',
      app: 'test-app',
      autoHook: false,
    })
    logger.info('one')
    logger.warn('two')
    logger.error('three')
    await logger.flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.logs).toHaveLength(3)
    expect(body.logs.map((l: { level: string }) => l.level)).toEqual(['info', 'warn', 'error'])

    await logger.destroy()
  })

  it('forces flush when maxBatchSize is reached', async () => {
    const logger = initLogger({
      collector: 'https://col.example.com',
      app: 'test-app',
      autoHook: false,
      maxBatchSize: 3,
    })
    logger.info('one')
    logger.info('two')
    logger.info('three')
    // Wait a tick for the auto-flush to fire
    await new Promise((r) => setTimeout(r, 10))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await logger.destroy()
  })

  it('setUser updates the user_id field', async () => {
    const logger = initLogger({
      collector: 'https://col.example.com',
      app: 'test-app',
      autoHook: false,
    })
    logger.info('anon')
    logger.setUser('user-42')
    logger.info('logged-in')
    await logger.flush()

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.logs[0].user_id).toBeUndefined()
    expect(body.logs[1].user_id).toBe('user-42')

    await logger.destroy()
  })

  it('dryRun does not call fetch', async () => {
    const logger = initLogger({
      collector: 'https://col.example.com',
      app: 'test-app',
      autoHook: false,
      dryRun: true,
    })
    logger.error('important error')
    await logger.flush()

    expect(fetchMock).not.toHaveBeenCalled()
    await logger.destroy()
  })

  it('swallows fetch errors without throwing', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    const logger = initLogger({
      collector: 'https://col.example.com',
      app: 'test-app',
      autoHook: false,
    })
    logger.info('test')

    // Should not throw
    await expect(logger.flush()).resolves.toBeUndefined()
    await logger.destroy()
  })
})
