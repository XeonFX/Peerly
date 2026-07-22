import { encodeCanonicalLines, verifyWithDeviceKeyId } from '@peerly/core'
import { useRoom } from '@peerly/core/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DeviceIdentity } from '../collab/deviceIdentity'
import {
  rememberDevice,
  saveDeviceGrant,
  signDeviceGrant,
  verifyDeviceGrant,
  type DeviceGrant,
} from '../collab/deviceAuthorization'
import {
  createDeviceSyncSnapshot,
  ensureAccountSyncSecret,
  importDeviceSyncSnapshot,
  type DeviceSyncSnapshot,
} from '../collab/deviceSync'
import { APP_ID, PUBLIC_NETWORK_ENV } from '../config'

type Role = 'source' | 'target'
type Hello = {
  v: 1
  userId: string
  role: Role
  pairingId: string
  deviceKeyId: string
  label: string
  sig: string
}

const label = () => `${navigator.platform || 'Device'} · ${navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Browser'}`.slice(0, 80)
const bytes = (hello: Omit<Hello, 'sig'>) => encodeCanonicalLines([
  'peerly-device-pair-hello-v1', String(hello.v), hello.userId, hello.role,
  hello.pairingId, hello.deviceKeyId, hello.label,
])

export function useDevicePairing(options: {
  identity: DeviceIdentity
  userId: string
  secret: string | null
  role: Role | null
}) {
  const { identity, userId, secret, role } = options
  const pairingIdRef = useRef(crypto.randomUUID())
  const remotePeerRef = useRef('')
  const remoteKeyRef = useRef('')
  const [roomId, setRoomId] = useState('')
  const [remote, setRemote] = useState<Hello | null>(null)
  const [sent, setSent] = useState(false)
  const [received, setReceived] = useState<DeviceGrant | null>(null)
  const [synced, setSynced] = useState<number | null>(null)
  const grantSendRef = useRef<(grant: DeviceGrant) => void>(() => {})
  const dataSendRef = useRef<(data: DeviceSyncSnapshot) => void>(() => {})
  const pendingRef = useRef<DeviceSyncSnapshot | null>(null)
  const linkedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    if (!secret || !role) { setRoomId(''); return }
    void crypto.subtle.digest('SHA-256', new TextEncoder().encode(`peerly-device-pair-v1\n${secret}`)).then(raw => {
      if (cancelled) return
      const id = Array.from(new Uint8Array(raw).slice(0, 16), b => b.toString(16).padStart(2, '0')).join('')
      setRoomId(`device-pair-${id}`)
    })
    return () => { cancelled = true }
  }, [secret, role])

  const { room } = useRoom({ appId: APP_ID, roomId, password: secret ?? '', env: PUBLIC_NETWORK_ENV })

  useEffect(() => {
    setRemote(null); setSent(false); setReceived(null); setSynced(null)
    remotePeerRef.current = ''; remoteKeyRef.current = ''; pendingRef.current = null; linkedRef.current = false
  }, [secret, role])

  useEffect(() => {
    if (!room || !role) return
    const helloAction = room.makeAction<Hello>('pair-hello')
    const grantAction = room.makeAction<DeviceGrant>('pair-grant')
    const dataAction = room.makeAction<DeviceSyncSnapshot>('pair-data')
    grantSendRef.current = grant => { if (remotePeerRef.current) void grantAction.send(grant, { target: remotePeerRef.current }) }
    dataSendRef.current = data => { if (remotePeerRef.current) void dataAction.send(data, { target: remotePeerRef.current }) }

    const sendHello = (target?: string) => {
      void (async () => {
        const deviceKeyId = await identity.publicKeyId()
        const body: Omit<Hello, 'sig'> = { v: 1, userId, role, pairingId: pairingIdRef.current, deviceKeyId, label: label() }
        const hello = { ...body, sig: await identity.sign(bytes(body)) }
        await helloAction.send(hello, target ? { target } : undefined)
      })()
    }

    helloAction.onMessage = (hello, { peerId }) => {
      void (async () => {
        if (!hello || hello.v !== 1 || hello.userId !== userId || hello.role === role || !hello.deviceKeyId ||
          !(await verifyWithDeviceKeyId(hello.deviceKeyId, bytes(hello), hello.sig))) return
        const first = !remotePeerRef.current
        if (!first && (remotePeerRef.current !== peerId || remoteKeyRef.current !== hello.deviceKeyId)) return
        remotePeerRef.current = peerId; remoteKeyRef.current = hello.deviceKeyId
        rememberDevice(hello.deviceKeyId, hello.label)
        setRemote(hello)
        if (first) sendHello(peerId)
      })()
    }
    grantAction.onMessage = (grant, { peerId }) => {
      void (async () => {
        const current = await identity.publicKeyId()
        const expectedPairing = role === 'source' ? pairingIdRef.current : remote?.pairingId
        if (peerId !== remotePeerRef.current || grant.issuerDeviceKeyId !== remoteKeyRef.current ||
          grant.userId !== userId || grant.subjectDeviceKeyId !== current || grant.pairingId !== expectedPairing ||
          !(await verifyDeviceGrant(grant))) return
        if (await saveDeviceGrant(grant)) setReceived(grant)
      })()
    }
    dataAction.onMessage = (data, { peerId }) => {
      if (role !== 'target' || peerId !== remotePeerRef.current) return
      if (!linkedRef.current) { pendingRef.current = data; return }
      setSynced(importDeviceSyncSnapshot(data, userId))
    }
    room.onPeerJoin = peerId => sendHello(peerId)
    sendHello()
    return () => {
      helloAction.onMessage = null; grantAction.onMessage = null; dataAction.onMessage = null
      room.onPeerJoin = null; grantSendRef.current = () => {}; dataSendRef.current = () => {}
    }
  }, [room, role, userId, identity, remote?.pairingId])

  const approve = useCallback(async () => {
    if (!remote || !role) return
    const pairingId = role === 'source' ? pairingIdRef.current : remote.pairingId
    const grant = await signDeviceGrant(identity, userId, remote.deviceKeyId, pairingId)
    await saveDeviceGrant(grant)
    grantSendRef.current(grant)
    setSent(true)
  }, [identity, remote, role, userId])

  const linked = sent && Boolean(received)
  useEffect(() => {
    linkedRef.current = linked
    if (!linked) return
    window.dispatchEvent(new Event('peerly-devices-changed'))
    if (role === 'source') {
      const snapshot = createDeviceSyncSnapshot(ensureAccountSyncSecret(userId))
      dataSendRef.current(snapshot)
      window.setTimeout(() => dataSendRef.current(snapshot), 1_000)
      window.setTimeout(() => dataSendRef.current(snapshot), 3_000)
    } else if (pendingRef.current) {
      setSynced(importDeviceSyncSnapshot(pendingRef.current, userId))
      pendingRef.current = null
    }
  }, [linked, role, userId])

  useEffect(() => {
    if (!linked) return
    const timer = window.setTimeout(() => setRoomId(''), 5_000)
    return () => window.clearTimeout(timer)
  }, [linked])

  return { remote, approve, sent, linked, synced }
}
