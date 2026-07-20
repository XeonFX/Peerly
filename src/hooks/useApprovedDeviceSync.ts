import { encodeCanonicalLines, recordSyncActivity, syncPayloadBytes, verifyWithDeviceKeyId } from '@peerly/core'
import { useRoom } from '@peerly/core/react'
import { useEffect, useRef, useState } from 'react'
import type { DeviceIdentity } from '../collab/deviceIdentity'
import { loadDeviceGrants, rememberDevice } from '../collab/deviceAuthorization'
import {
  createDeviceSyncSnapshot,
  importDeviceSyncSnapshot,
  loadAccountSyncSecret,
  type DeviceSyncSnapshot,
} from '../collab/deviceSync'
import { APP_ID } from '../config'

type SyncHello = {
  v: 1
  userId: string
  deviceKeyId: string
  label: string
  ts: number
  sig: string
}

function deviceLabel(): string {
  return `${navigator.platform || 'Device'} · ${navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Browser'}`.slice(0, 80)
}

function helloBytes(hello: Omit<SyncHello, 'sig'>): Uint8Array {
  return encodeCanonicalLines([
    'peerly-approved-device-sync-v1', String(hello.v), hello.userId,
    hello.deviceKeyId, hello.label, String(hello.ts),
  ])
}

export function useApprovedDeviceSync(
  identity: DeviceIdentity,
  userId: string | undefined
): number {
  const [roomId, setRoomId] = useState('')
  const [version, setVersion] = useState(0)
  const [registryVersion, setRegistryVersion] = useState(0)
  const trustedPeersRef = useRef(new Set<string>())
  const peerDevicesRef = useRef(new Map<string, SyncHello>())
  const secret = userId ? loadAccountSyncSecret(userId) : null

  useEffect(() => {
    const refresh = () => setRegistryVersion(value => value + 1)
    window.addEventListener('peerly-devices-changed', refresh)
    return () => window.removeEventListener('peerly-devices-changed', refresh)
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!secret) { setRoomId(''); return }
    void crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`peerly-account-sync-v1\n${secret}`)
    ).then(raw => {
      if (cancelled) return
      const id = Array.from(new Uint8Array(raw).slice(0, 16), byte =>
        byte.toString(16).padStart(2, '0')
      ).join('')
      setRoomId(`account-sync-${id}`)
    })
    return () => { cancelled = true }
  }, [secret])

  const { room } = useRoom({ appId: APP_ID, roomId, password: secret ?? '', env: import.meta.env })

  useEffect(() => {
    if (!room || !userId) return
    trustedPeersRef.current = new Set()
    const helloAction = room.makeAction<SyncHello>('device-hello')
    const dataAction = room.makeAction<DeviceSyncSnapshot>('device-data')

    const sendHello = (target?: string) => {
      void (async () => {
        const deviceKeyId = await identity.publicKeyId()
        const body: Omit<SyncHello, 'sig'> = {
          v: 1, userId, deviceKeyId, label: deviceLabel(), ts: Date.now(),
        }
        const hello = { ...body, sig: await identity.sign(helloBytes(body)) }
        await helloAction.send(hello, target ? { target } : undefined)
      })()
    }
    const sendData = (target: string) => {
      const snapshot = createDeviceSyncSnapshot()
      void dataAction.send(snapshot, { target }).then(() => {
        const peer = peerDevicesRef.current.get(target)
        recordSyncActivity({
          direction: 'sent', kind: 'account-data',
          peer: { peerId: target, deviceKeyId: peer?.deviceKeyId, deviceLabel: peer?.label, relationship: 'approved-device' },
          itemCount: Object.keys(snapshot.values).length,
          bytes: syncPayloadBytes(snapshot),
          summary: 'Approved-device account data',
        })
      })
    }

    helloAction.onMessage = (hello, { peerId }) => {
      void (async () => {
        if (!hello || hello.v !== 1 || hello.userId !== userId || !hello.deviceKeyId ||
          !hello.label || !Number.isFinite(hello.ts) || Math.abs(Date.now() - hello.ts) > 5 * 60_000 ||
          !(await verifyWithDeviceKeyId(hello.deviceKeyId, helloBytes(hello), hello.sig))) return
        const current = await identity.publicKeyId()
        const grants = await loadDeviceGrants(userId)
        const outgoing = grants.some(grant =>
          grant.issuerDeviceKeyId === current && grant.subjectDeviceKeyId === hello.deviceKeyId
        )
        const incoming = grants.some(grant =>
          grant.issuerDeviceKeyId === hello.deviceKeyId && grant.subjectDeviceKeyId === current
        )
        if (!outgoing || !incoming) return
        trustedPeersRef.current.add(peerId)
        peerDevicesRef.current.set(peerId, hello)
        rememberDevice(hello.deviceKeyId, hello.label, hello.ts)
        sendData(peerId)
      })()
    }
    dataAction.onMessage = (snapshot, { peerId }) => {
      if (!trustedPeersRef.current.has(peerId)) return
      const imported = importDeviceSyncSnapshot(snapshot, userId)
      const peer = peerDevicesRef.current.get(peerId)
      recordSyncActivity({
        direction: 'received', kind: 'account-data',
        peer: { peerId, deviceKeyId: peer?.deviceKeyId, deviceLabel: peer?.label, relationship: 'approved-device' },
        itemCount: Object.keys(snapshot.values ?? {}).length,
        bytes: syncPayloadBytes(snapshot),
        summary: imported > 0 ? `${imported} local data sets updated` : 'Account data already up to date',
      })
      if (imported > 0) setVersion(value => value + 1)
    }
    room.onPeerJoin = peerId => sendHello(peerId)
    room.onPeerLeave = peerId => { trustedPeersRef.current.delete(peerId); peerDevicesRef.current.delete(peerId) }
    sendHello()
    const timer = window.setInterval(() => {
      for (const peerId of trustedPeersRef.current) sendData(peerId)
    }, 20_000)
    return () => {
      window.clearInterval(timer)
      helloAction.onMessage = null
      dataAction.onMessage = null
      room.onPeerJoin = null
      room.onPeerLeave = null
      trustedPeersRef.current = new Set()
      peerDevicesRef.current = new Map()
    }
  }, [room, identity, userId, registryVersion])

  return version
}
