import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

describe('offline app shell', () => {
  it('preserves a working shell across HTTP errors, unexpected content and an offline restart', async () => {
    const handlers = new Map<string, (event: unknown) => void>()
    let shell = new Response('<html>working shell</html>', { headers: { 'content-type': 'text/html' } })
    let network: () => Promise<Response> = async () => new Response('Unavailable', { status: 503 })
    runInNewContext(readFileSync('public/sw.js', 'utf8'), {
      self: { location: { origin: 'https://peerly.cc' }, addEventListener: (type: string, handler: (event: unknown) => void) => handlers.set(type, handler) },
      caches: { open: async () => ({ put: async (_key: unknown, response: Response) => { shell = response } }), match: async () => shell.clone() },
      fetch: () => network(), URL, Response,
    })
    const navigate = async () => {
      let result: Promise<Response> | undefined
      const writes: Promise<unknown>[] = []
      handlers.get('fetch')!({ request: { method: 'GET', mode: 'navigate', url: 'https://peerly.cc/workspace/general' },
        respondWith: (promise: Promise<Response>) => { result = promise }, waitUntil: (promise: Promise<unknown>) => writes.push(promise) })
      const response = await result!
      await Promise.all(writes)
      return response
    }
    expect(await (await navigate()).text()).toBe('<html>working shell</html>')
    network = async () => Response.json({ unexpected: 'data' })
    await navigate()
    network = async () => { throw new Error('offline') }
    expect(await (await navigate()).text()).toBe('<html>working shell</html>')
    network = async () => new Response('<html>updated shell</html>', { headers: { 'content-type': 'text/html' } })
    await navigate()
    network = async () => { throw new Error('offline') }
    expect(await (await navigate()).text()).toBe('<html>updated shell</html>')
  })

  it('does not intercept API or arbitrary same-origin requests', () => {
    let fetchHandler: (event: unknown) => void = () => {}
    runInNewContext(readFileSync('public/sw.js', 'utf8'), {
      self: { location: { origin: 'https://peerly.cc' }, addEventListener: (type: string, handler: (event: unknown) => void) => { if (type === 'fetch') fetchHandler = handler } }, URL,
    })
    for (const path of ['/api/private', '/account.json']) {
      fetchHandler({ request: { method: 'GET', url: `https://peerly.cc${path}` },
        respondWith: () => { throw new Error('unexpected interception') } })
    }
  })
})
