import { env, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

function workspace(name) {
  return env.WORKSPACES.getByName(name)
}

// isolatedStorage is disabled for this config (WebSocket tests require it —
// see vitest.workers.config.ts), so every uid must be unique per test: a
// UserGatewayDO is keyed only by uid, shared across every workspace that
// mentions it, and state otherwise leaks across tests in this file.

describe('WorkspaceDO', () => {
  it('records a member on join and broadcasts presence to the others', async () => {
    const stub = workspace('peerly:ws-1')
    await stub.join({ uid: 'ws1-peer-a', dk: 'dk-a', capabilityVersion: 1 })
    await stub.join({ uid: 'ws1-peer-b', dk: 'dk-b', capabilityVersion: 1 })
    await runInDurableObject(stub, async (_instance, state) => {
      const rows = state.storage.sql.exec('SELECT uid FROM members ORDER BY uid').toArray()
      expect(rows.map(row => row.uid)).toEqual(['ws1-peer-a', 'ws1-peer-b'])
    })
  })

  it('delivers a workspace.presence event to every other member gateway, never to the sender', async () => {
    const stub = workspace('peerly:ws-2')
    await stub.join({ uid: 'ws2-peer-a', dk: 'dk-a', capabilityVersion: 1 })
    await stub.join({ uid: 'ws2-peer-b', dk: 'dk-b', capabilityVersion: 1 })

    const gatewayA = env.USER_GATEWAYS.getByName('peerly:ws2-peer-a')
    const eventsBeforeUpdate = await runInDurableObject(gatewayA, async (_instance, state) =>
      state.storage.sql.exec("SELECT body FROM events WHERE kind = 'workspace.presence'").toArray().length
    )

    await stub.presenceUpdate({ uid: 'ws2-peer-a', state: 'active' })

    const gatewayB = env.USER_GATEWAYS.getByName('peerly:ws2-peer-b')
    await runInDurableObject(gatewayB, async (_instance, state) => {
      const events = state.storage.sql.exec("SELECT body FROM events WHERE kind = 'workspace.presence'").toArray()
      const body = JSON.parse(events[events.length - 1].body)
      expect(body).toMatchObject({ uid: 'ws2-peer-a', state: 'active' })
    })

    await runInDurableObject(gatewayA, async (_instance, state) => {
      const events = state.storage.sql.exec("SELECT body FROM events WHERE kind = 'workspace.presence'").toArray()
      expect(events.length).toBe(eventsBeforeUpdate) // presenceUpdate never notifies its own author
    })
  })

  it('removes a member on leave', async () => {
    const stub = workspace('peerly:ws-3')
    await stub.join({ uid: 'ws3-peer-a', dk: 'dk-a', capabilityVersion: 1 })
    await stub.leave({ uid: 'ws3-peer-a' })
    await runInDurableObject(stub, async (_instance, state) => {
      const rows = state.storage.sql.exec('SELECT uid FROM members').toArray()
      expect(rows.length).toBe(0)
    })
  })

  it('revokeMember removes membership and notifies remaining members', async () => {
    const stub = workspace('peerly:ws-4')
    await stub.join({ uid: 'ws4-peer-a', dk: 'dk-a', capabilityVersion: 1 })
    await stub.join({ uid: 'ws4-peer-b', dk: 'dk-b', capabilityVersion: 1 })
    await stub.revokeMember({ uid: 'ws4-peer-a' })
    await runInDurableObject(stub, async (_instance, state) => {
      const rows = state.storage.sql.exec('SELECT uid FROM members').toArray()
      expect(rows.map(row => row.uid)).toEqual(['ws4-peer-b'])
    })
    const gatewayB = env.USER_GATEWAYS.getByName('peerly:ws4-peer-b')
    await runInDurableObject(gatewayB, async (_instance, state) => {
      const events = state.storage.sql.exec("SELECT body FROM events WHERE kind = 'workspace.presence'").toArray()
      expect(JSON.parse(events[events.length - 1].body)).toMatchObject({ uid: 'ws4-peer-a', state: 'revoked' })
    })
  })
})
