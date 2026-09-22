import { useEffect, useRef, useState } from 'react'
import { encodeCanonicalLines } from './canonical.js'
import { verifyWithDeviceKeyId, type DeviceKeyId } from './deviceIdentity.js'
import { recordSyncActivity, syncPayloadBytes } from './syncActivity.js'
import { sendActionInBackground } from './safeActionSend.js'
import { useRoom } from './react.js'
import type { DeviceAuthorization } from './deviceAuthorization.js'
import type { DeviceSync, DeviceSyncSnapshot } from './deviceSync.js'
import type { DeviceSigner } from './textChatSigning.js'
import type { Env } from './env.js'

/**
 * Keeping one account's approved devices in step.
 *
 * Every device that holds the account's sync secret meets in a room derived
 * from it, announces itself with a signed hello, and — only once both devices
 * hold grants for each other — exchanges account data.
 *
 * The secret gets a device into the room. It does not get it any data: the
 * reciprocal grant check is what does, and it is redone on every hello rather
 * than remembered, so revoking a device on one machine stops the sync on the
 * next beat.
 */
export type SyncHello = {
  v: 1
  userId: string
  deviceKeyId: string
  label: string
  ts: number
  sig: string
}

export type ApprovedDeviceSyncConfig = {
  appId: string
  env: Env
  /** This device's signer. Null until it is ready. */
  identity: DeviceSigner | null
  /** The signed-in account. Undefined signs the sync off entirely. */
  userId: string | undefined
  /** Signed into every hello. Distinct per app. */
  helloScheme: string
  /** Namespace for the room id derived from the sync secret. Distinct per app. */
  roomScheme: string
  grants: Pick<DeviceAuthorization, 'load' | 'remember'>
  sync: Pick<DeviceSync, 'loadSecret' | 'snapshot' | 'import'>
  /** Listened for, so revoking a device re-runs the trust check at once. */
  devicesChangedEvent: string
}

/** A hello older than this is a replay, not a device saying hello. */
const HELLO_MAX_AGE_MS = 5 * 60_000

/** How often devices re-send, so a change on one reaches the others. */
const RESEND_INTERVAL_MS = 20_000

function deviceLabel(): string {
  const kind = navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Browser'
  return `${navigator.platform || 'Device'} · ${kind}`.slice(0, 80)
}

function helloBytes(scheme: string, hello: Omit<SyncHello, 'sig'>): Uint8Array {
  return encodeCanonicalLines([
    scheme,
    String(hello.v),
    hello.userId,
    hello.deviceKeyId,
    hello.label,
    String(hello.ts),
  ])
}

/** Returns a counter that changes whenever local data was updated by a peer. */
export function useApprovedDeviceSync(config: ApprovedDeviceSyncConfig): number {
  const { identity, userId, helloScheme, roomScheme, grants, sync } = config
  const [roomId, setRoomId] = useState('')
  const [version, setVersion] = useState(0)
  const [grantsVersion, setGrantsVersion] = useState(0)
  const trustedPeersRef = useRef(new Set<string>())
  const peerDevicesRef = useRef(new Map<string, SyncHello>())
  const secret = userId ? sync.loadSecret(userId) : null

  useEffect(() => {
    const refresh = () => setGrantsVersion(value => value + 1)
    window.addEventListener(config.devicesChangedEvent, refresh)
    return () => window.removeEventListener(config.devicesChangedEvent, refresh)
  }, [config.devicesChangedEvent])

  useEffect(() => {
    let cancelled = false
    if (!secret) {
      setRoomId('')
      return
    }
    // Derived rather than used directly, so the room name is not the secret.
    void crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(`${roomScheme}\n${secret}`))
      .then(raw => {
        if (cancelled) return
        const id = Array.from(new Uint8Array(raw).slice(0, 16), byte =>
          byte.toString(16).padStart(2, '0')
        ).join('')
        setRoomId(`account-sync-${id}`)
      })
    return () => { cancelled = true }
  }, [secret, roomScheme])

  const { room } = useRoom({
    appId: config.appId,
    roomId,
    password: secret ?? '',
    env: config.env,
  })

  useEffect(() => {
    if (!room || !userId || !identity) return
    trustedPeersRef.current = new Set()
    const helloAction = room.makeAction<SyncHello>('device-hello')
    const dataAction = room.makeAction<DeviceSyncSnapshot>('device-data')

    const sendHello = (target?: string) => {
      sendActionInBackground(async () => {
        const body: Omit<SyncHello, 'sig'> = {
          v: 1,
          userId,
          deviceKeyId: await identity.publicKeyId(),
          label: deviceLabel(),
          ts: Date.now(),
        }
        const hello: SyncHello = { ...body, sig: await identity.sign(helloBytes(helloScheme, body)) }
        await helloAction.send(hello, target ? { target } : undefined)
      }, 'approved-device hello')
    }

    const sendData = (target: string) => {
      const snapshot = sync.snapshot()
      sendActionInBackground(async () => {
        await dataAction.send(snapshot, { target })
        const peer = peerDevicesRef.current.get(target)
        recordSyncActivity({
          direction: 'sent',
          kind: 'account-data',
          peer: {
            peerId: target,
            deviceKeyId: peer?.deviceKeyId,
            deviceLabel: peer?.label,
            relationship: 'approved-device',
          },
          itemCount: Object.keys(snapshot.values).length,
          bytes: syncPayloadBytes(snapshot),
          summary: 'Approved-device account data',
        })
      }, 'approved-device data')
    }

    helloAction.onMessage = (hello, { peerId }) => {
      void (async () => {
        if (
          !hello || hello.v !== 1 || hello.userId !== userId ||
          !hello.deviceKeyId || !hello.label || !Number.isFinite(hello.ts) ||
          // Without this a captured hello is good forever.
          Math.abs(Date.now() - hello.ts) > HELLO_MAX_AGE_MS ||
          !(await verifyWithDeviceKeyId(
            hello.deviceKeyId as DeviceKeyId,
            helloBytes(helloScheme, hello),
            hello.sig
          ))
        ) return

        // Both directions, every time. One-way means a half-finished pairing,
        // and re-checking is what makes a revocation take effect.
        const current = await identity.publicKeyId()
        const held = await grants.load(userId)
        const outgoing = held.some(grant =>
          grant.issuerDeviceKeyId === current && grant.subjectDeviceKeyId === hello.deviceKeyId
        )
        const incoming = held.some(grant =>
          grant.issuerDeviceKeyId === hello.deviceKeyId && grant.subjectDeviceKeyId === current
        )
        if (!outgoing || !incoming) return

        trustedPeersRef.current.add(peerId)
        peerDevicesRef.current.set(peerId, hello)
        grants.remember(hello.deviceKeyId, hello.label, hello.ts)
        sendData(peerId)
      })()
    }

    dataAction.onMessage = (snapshot, { peerId }) => {
      // Being in the room is not being trusted; only a completed hello is.
      if (!trustedPeersRef.current.has(peerId)) return
      const imported = sync.import(snapshot, userId)
      const peer = peerDevicesRef.current.get(peerId)
      recordSyncActivity({
        direction: 'received',
        kind: 'account-data',
        peer: {
          peerId,
          deviceKeyId: peer?.deviceKeyId,
          deviceLabel: peer?.label,
          relationship: 'approved-device',
        },
        itemCount: Object.keys(snapshot.values ?? {}).length,
        bytes: syncPayloadBytes(snapshot),
        summary: imported > 0 ? `${imported} local data sets updated` : 'Account data already up to date',
      })
      if (imported > 0) setVersion(value => value + 1)
    }

    room.onPeerJoin = peerId => sendHello(peerId)
    room.onPeerLeave = peerId => {
      trustedPeersRef.current.delete(peerId)
      peerDevicesRef.current.delete(peerId)
    }
    sendHello()

    const timer = window.setInterval(() => {
      for (const peerId of trustedPeersRef.current) sendData(peerId)
    }, RESEND_INTERVAL_MS)

    return () => {
      window.clearInterval(timer)
      helloAction.onMessage = null
      dataAction.onMessage = null
      room.onPeerJoin = null
      room.onPeerLeave = null
      trustedPeersRef.current = new Set()
      peerDevicesRef.current = new Map()
    }
  }, [room, identity, userId, helloScheme, grants, sync, grantsVersion])

  return version
}
