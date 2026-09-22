import { useCallback, useEffect, useRef, useState } from 'react'
import { encodeCanonicalLines } from './canonical.js'
import { verifyWithDeviceKeyId, type DeviceKeyId } from './deviceIdentity.js'
import { deviceFingerprint, type DeviceAuthorization, type DeviceGrant } from './deviceAuthorization.js'
import { sendActionInBackground } from './safeActionSend.js'
import { useRoom } from './react.js'
import type { DeviceSync, DeviceSyncSnapshot } from './deviceSync.js'
import type { DeviceSigner } from './textChatSigning.js'
import type { Env } from './env.js'

/**
 * Linking a second device to an account.
 *
 * One device shows a secret, the other receives it, and both meet in a room
 * derived from it. Each announces itself, the user compares the fingerprint
 * shown on both screens, and each approves — producing a pair of grants, one
 * in each direction. Only then does account data move.
 *
 * The secret is a rendezvous, not an authorization: it gets two devices into
 * the same room and nothing more. What authorizes is the user reading a
 * fingerprint off one screen and recognising it on the other. That is why
 * both directions are required and why data waits for both.
 */
export type PairRole = 'source' | 'target'

export type PairHello = {
  v: 1
  userId: string
  role: PairRole
  pairingId: string
  deviceKeyId: DeviceKeyId
  label: string
  sig: string
}

export type DevicePairingConfig = {
  appId: string
  env: Env
  identity: DeviceSigner
  userId: string
  /** The pairing secret. Null closes the room. */
  secret: string | null
  /** Which side of the exchange this device is on. Null closes the room. */
  role: PairRole | null
  /** Signed into every hello. Distinct per app. */
  helloScheme: string
  /** Namespace for the room id derived from the secret. Distinct per app. */
  roomScheme: string
  grants: Pick<DeviceAuthorization, 'sign' | 'save' | 'verify' | 'remember'>
  sync: Pick<DeviceSync, 'ensureSecret' | 'snapshot' | 'import'>
  /** Dispatched on `window` once both grants exist. */
  devicesChangedEvent: string
}

export type DevicePairing = {
  /** The other device's fingerprint, for the user to compare. */
  remoteFingerprint: string | null
  /** Signs and sends this device's half of the pair. */
  approve(): Promise<void>
  /** This device has approved; the other may not have yet. */
  approved: boolean
  /** Both halves exist. */
  linked: boolean
  /** Keys imported from the other device, or null if none has arrived. */
  syncedKeys: number | null
  error: string | null
}

/** A pairing id short enough to guess is not one. */
const MIN_PAIRING_ID = 16
const MAX_LABEL = 80

/** Resends, because the first can land before the other side is listening. */
const SYNC_RETRY_MS = [1_000, 3_000]

/** How long the room stays open after linking, so the last send lands. */
const LINGER_AFTER_LINK_MS = 5_000

function deviceLabel(): string {
  const kind = navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Browser'
  return `${navigator.platform || 'Device'} · ${kind}`.slice(0, 80)
}

function helloBytes(scheme: string, hello: Omit<PairHello, 'sig'>): Uint8Array {
  return encodeCanonicalLines([
    scheme,
    String(hello.v),
    hello.userId,
    hello.role,
    hello.pairingId,
    hello.deviceKeyId,
    hello.label,
  ])
}

async function isWellFormedHello(scheme: string, hello: PairHello): Promise<boolean> {
  if (
    !hello || hello.v !== 1 || !hello.userId ||
    (hello.role !== 'source' && hello.role !== 'target') ||
    typeof hello.pairingId !== 'string' || hello.pairingId.length < MIN_PAIRING_ID ||
    typeof hello.deviceKeyId !== 'string' || !hello.deviceKeyId ||
    typeof hello.label !== 'string' || hello.label.length > MAX_LABEL ||
    typeof hello.sig !== 'string' || !hello.sig
  ) return false
  return verifyWithDeviceKeyId(hello.deviceKeyId, helloBytes(scheme, hello), hello.sig)
}

export function useDevicePairing(config: DevicePairingConfig): DevicePairing {
  const { identity, userId, secret, role, helloScheme, roomScheme, grants, sync } = config

  const ownPairingIdRef = useRef(crypto.randomUUID())
  const remotePeerIdRef = useRef<string | null>(null)
  const remoteDeviceKeyRef = useRef<string | null>(null)
  const pendingSyncRef = useRef<DeviceSyncSnapshot | null>(null)
  const linkedRef = useRef(false)
  const grantSendRef = useRef<(grant: DeviceGrant) => void>(() => {})
  const syncSendRef = useRef<(snapshot: DeviceSyncSnapshot) => void>(() => {})

  const [roomId, setRoomId] = useState('')
  const [remote, setRemote] = useState<PairHello | null>(null)
  const [approved, setApproved] = useState(false)
  const [receivedGrant, setReceivedGrant] = useState<DeviceGrant | null>(null)
  const [syncedKeys, setSyncedKeys] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!secret || !role) {
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
        setRoomId(`device-pair-${id}`)
      })
    return () => { cancelled = true }
  }, [secret, role, roomScheme])

  const { room } = useRoom({
    appId: config.appId,
    roomId,
    password: secret ?? '',
    env: config.env,
    onError: setError,
  })

  // A new secret or role is a new pairing attempt, not a continuation.
  useEffect(() => {
    setRemote(null)
    setApproved(false)
    setReceivedGrant(null)
    setSyncedKeys(null)
    setError(null)
    remotePeerIdRef.current = null
    remoteDeviceKeyRef.current = null
    pendingSyncRef.current = null
    linkedRef.current = false
  }, [secret, role])

  useEffect(() => {
    if (!room || !role) return
    const helloAction = room.makeAction<PairHello>('pair-hello')
    const grantAction = room.makeAction<DeviceGrant>('pair-grant')
    const syncAction = room.makeAction<DeviceSyncSnapshot>('pair-sync')

    grantSendRef.current = grant => {
      const target = remotePeerIdRef.current
      if (target) sendActionInBackground(() => grantAction.send(grant, { target }), 'device grant')
    }
    syncSendRef.current = snapshot => {
      const target = remotePeerIdRef.current
      if (target) {
        sendActionInBackground(() => syncAction.send(snapshot, { target }), 'paired-device sync')
      }
    }

    const sendHello = (target?: string) => {
      sendActionInBackground(async () => {
        const body: Omit<PairHello, 'sig'> = {
          v: 1,
          userId,
          role,
          pairingId: ownPairingIdRef.current,
          deviceKeyId: (await identity.publicKeyId()) as DeviceKeyId,
          label: deviceLabel(),
        }
        const hello: PairHello = {
          ...body,
          sig: await identity.sign(helloBytes(helloScheme, body)),
        }
        await helloAction.send(hello, target ? { target } : undefined)
      }, 'device pairing hello')
    }

    helloAction.onMessage = (hello, { peerId }) => {
      void (async () => {
        if (!(await isWellFormedHello(helloScheme, hello))) return
        if (hello.userId !== userId || hello.role === role) return
        // Two tabs of the same browser must not pair with each other: a
        // device vouching for itself proves nothing.
        if (hello.deviceKeyId === (await identity.publicKeyId())) return

        const first = !remotePeerIdRef.current
        // Once a partner is chosen it is the only one: a third device in the
        // room must not be able to take over a pairing mid-exchange.
        if (
          !first &&
          (remotePeerIdRef.current !== peerId || remoteDeviceKeyRef.current !== hello.deviceKeyId)
        ) return

        remotePeerIdRef.current = peerId
        remoteDeviceKeyRef.current = hello.deviceKeyId
        grants.remember(hello.deviceKeyId, hello.label)
        setRemote(hello)
        if (first) sendHello(peerId)
      })()
    }

    grantAction.onMessage = (grant, { peerId }) => {
      void (async () => {
        if (peerId !== remotePeerIdRef.current) return
        if (grant.issuerDeviceKeyId !== remoteDeviceKeyRef.current) return
        // Whoever started the exchange named it, and the grant has to carry
        // that name — otherwise a grant from an unrelated pairing would do.
        const expectedPairingId =
          role === 'source' ? ownPairingIdRef.current : remote?.pairingId
        if (
          !expectedPairingId ||
          grant.userId !== userId ||
          grant.subjectDeviceKeyId !== (await identity.publicKeyId()) ||
          grant.pairingId !== expectedPairingId ||
          !(await grants.verify(grant))
        ) return
        if (await grants.save(grant)) setReceivedGrant(grant)
      })()
    }

    syncAction.onMessage = (snapshot, { peerId }) => {
      if (role !== 'target' || peerId !== remotePeerIdRef.current) return
      // Data can arrive before this side finishes linking. Holding it beats
      // importing on the strength of a pairing that is not complete.
      if (!linkedRef.current) {
        pendingSyncRef.current = snapshot
        return
      }
      setSyncedKeys(sync.import(snapshot, userId))
    }

    room.onPeerJoin = peerId => sendHello(peerId)
    sendHello()

    return () => {
      helloAction.onMessage = null
      grantAction.onMessage = null
      syncAction.onMessage = null
      room.onPeerJoin = null
      grantSendRef.current = () => {}
      syncSendRef.current = () => {}
    }
  }, [room, role, userId, identity, helloScheme, grants, sync, remote?.pairingId])

  const approve = useCallback(async () => {
    if (!remote || !role) return
    const pairingId = role === 'source' ? ownPairingIdRef.current : remote.pairingId
    const grant = await grants.sign(identity, {
      userId,
      subjectDeviceKeyId: remote.deviceKeyId,
      pairingId,
    })
    await grants.save(grant)
    grantSendRef.current(grant)
    setApproved(true)
  }, [identity, remote, role, userId, grants])

  const linked = approved && Boolean(receivedGrant)

  useEffect(() => {
    linkedRef.current = linked
    if (!linked) return
    window.dispatchEvent(new Event(config.devicesChangedEvent))
    if (role === 'source') {
      const snapshot = sync.snapshot(sync.ensureSecret(userId))
      syncSendRef.current(snapshot)
      const timers = SYNC_RETRY_MS.map(delay =>
        window.setTimeout(() => syncSendRef.current(snapshot), delay)
      )
      return () => { for (const timer of timers) window.clearTimeout(timer) }
    }
    if (pendingSyncRef.current) {
      setSyncedKeys(sync.import(pendingSyncRef.current, userId))
      pendingSyncRef.current = null
    }
    return
  }, [linked, role, userId, sync, config.devicesChangedEvent])

  useEffect(() => {
    if (!linked) return
    const timer = window.setTimeout(() => setRoomId(''), LINGER_AFTER_LINK_MS)
    return () => window.clearTimeout(timer)
  }, [linked])

  return {
    remoteFingerprint: remote ? deviceFingerprint(remote.deviceKeyId) : null,
    approve,
    approved,
    linked,
    syncedKeys,
    error,
  }
}
