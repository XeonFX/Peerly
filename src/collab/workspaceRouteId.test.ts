import { describe, expect, it } from 'vitest'
import {
  deriveWorkspaceRouteId,
  ensureWorkspaceRouteId,
  generateWorkspaceRouteId,
} from './workspaceRouteId'

describe('workspaceRouteId', () => {
  it('generates a public 128-bit route identity', () => {
    const first = generateWorkspaceRouteId()
    const second = generateWorkspaceRouteId()
    expect(first).toMatch(/^[a-f0-9]{32}$/)
    expect(second).toMatch(/^[a-f0-9]{32}$/)
    expect(second).not.toBe(first)
  })

  it('deterministically migrates the same legacy workspace on every device', async () => {
    const first = await deriveWorkspaceRouteId('legacy-secret')
    const second = await deriveWorkspaceRouteId('legacy-secret')
    expect(first).toBe(second)
    expect(first).toMatch(/^[a-f0-9]{32}$/)
  })

  it('preserves an invite-provided route identity', async () => {
    const workspaceRouteId = '0123456789abcdef0123456789abcdef'
    await expect(ensureWorkspaceRouteId({
      workspaceId: 'secret',
      workspaceRouteId,
    })).resolves.toBe(workspaceRouteId)
  })
})
