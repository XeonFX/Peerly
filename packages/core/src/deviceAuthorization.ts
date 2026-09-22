import { encodeCanonicalLines } from './canonical.js'
import { verifyWithDeviceKeyId, type DeviceKeyId } from './deviceIdentity.js'
import type { DeviceSigner } from './textChatSigning.js'

/**
 * Device grants: how one account's devices vouch for each other.
 *
 * A grant is a signed statement "device A says device B belongs to account U".
 * Two reciprocal grants make a pair, which is what lets a message signed by
 * your laptop be accepted by a peer who only ever recorded your phone's key.
 *
 * Everything here is app-agnostic except the scheme and the storage keys. The
 * scheme is signed into the grant bytes, so it is what stops a grant issued in
 * one product from verifying in the other — and, for the same reason, changing
 * an app's scheme invalidates every grant its users already hold.
 */

export type DeviceGrant = {
  v: 1
  userId: string
  issuerDeviceKeyId: DeviceKeyId
  subjectDeviceKeyId: DeviceKeyId
  createdAt: number
  /** Ties both directions of a pairing to the same exchange. */
  pairingId: string
  sig: string
}

/** A device the user has paired with, as shown on a "my devices" screen. */
export type ApprovedDevice = {
  deviceKeyId: string
  label: string
  approvedAt: number
  lastSeenAt?: number
}

export type DeviceAuthorizationConfig = {
  /** Signed into every grant; must differ per app and never change. */
  scheme: string
  grantsKey: string
  /** Labels and last-seen times — cosmetic, never trusted. */
  metaKey: string
  /** Dispatched on `window` after a revocation, for open device screens. */
  changedEvent: string
  /** Dispatched on `window` after a label or last-seen update. */
  metaChangedEvent: string
  maxGrants?: number
}

/**
 * Bounded so a large paired-device history cannot grow localStorage without
 * limit. Reads truncate to the newest, so this is also the point at which an
 * old pairing silently stops being honoured — keep it comfortably above any
 * plausible device count.
 */
const DEFAULT_MAX_GRANTS = 48

const MAX_USER_ID = 256
const MAX_KEY_ID = 512
const MAX_SIG = 512
const MIN_PAIRING_ID = 16
const MAX_PAIRING_ID = 128

/** Short, human-comparable form of a device key, for reading aloud. */
export function deviceFingerprint(deviceKeyId: string): string {
  const compact = deviceKeyId.replace(/^P-256:/, '').replace(/:/g, '')
  return `${compact.slice(0, 6)}…${compact.slice(-6)}`
}

/**
 * Whether a grant says exactly what the caller needs it to say. Pure, and
 * deliberately separate from signature checking: callers verify the signature
 * once, then ask this about the specific claim they are relying on.
 */
export function grantAuthorizes(
  grant: DeviceGrant | undefined,
  userId: string,
  issuerDeviceKeyId: string,
  subjectDeviceKeyId: string
): boolean {
  return Boolean(
    grant &&
    grant.userId === userId &&
    grant.issuerDeviceKeyId === issuerDeviceKeyId &&
    grant.subjectDeviceKeyId === subjectDeviceKeyId
  )
}

/** Shape and bounds only — says nothing about the signature. */
function isWellFormed(grant: DeviceGrant): boolean {
  return Boolean(
    grant &&
    grant.v === 1 &&
    typeof grant.userId === 'string' && grant.userId.length > 0 && grant.userId.length <= MAX_USER_ID &&
    typeof grant.issuerDeviceKeyId === 'string' && grant.issuerDeviceKeyId.length > 0 &&
    grant.issuerDeviceKeyId.length <= MAX_KEY_ID &&
    typeof grant.subjectDeviceKeyId === 'string' && grant.subjectDeviceKeyId.length > 0 &&
    grant.subjectDeviceKeyId.length <= MAX_KEY_ID &&
    // A device vouching for itself proves nothing.
    grant.issuerDeviceKeyId !== grant.subjectDeviceKeyId &&
    Number.isFinite(grant.createdAt) &&
    typeof grant.pairingId === 'string' &&
    grant.pairingId.length >= MIN_PAIRING_ID && grant.pairingId.length <= MAX_PAIRING_ID &&
    typeof grant.sig === 'string' && grant.sig.length > 0 && grant.sig.length <= MAX_SIG
  )
}

export type DeviceAuthorization = {
  /** Canonical signing input. Exposed so tests can forge and tamper. */
  bytes(grant: Omit<DeviceGrant, 'sig'>): Uint8Array
  sign(
    signer: DeviceSigner,
    fields: Pick<DeviceGrant, 'userId' | 'subjectDeviceKeyId' | 'pairingId'>
  ): Promise<DeviceGrant>
  verify(grant: DeviceGrant): Promise<boolean>
  /** Stored grants for an account, each re-verified before it is returned. */
  load(userId: string): Promise<DeviceGrant[]>
  /** Stores a grant, replacing any earlier one for the same pair. */
  save(grant: DeviceGrant): Promise<boolean>
  /** Stored lookup; omit the subject to match any device this issuer vouched for. */
  find(
    userId: string,
    issuerDeviceKeyId: string,
    subjectDeviceKeyId?: string
  ): DeviceGrant | undefined
  /** The grant to attach when signing as `subjectDeviceKeyId`, if one exists. */
  findAuthorizing(userId: string, subjectDeviceKeyId: string): DeviceGrant | undefined
  /** Devices paired in *both* directions with the current one, newest first. */
  listApproved(userId: string, currentDeviceKeyId: string): Promise<ApprovedDevice[]>
  /** Drops both directions of a pairing, and the other device's label. */
  revoke(userId: string, currentDeviceKeyId: string, otherDeviceKeyId: string): void
  /** Records a display label and last-seen time for a device. */
  remember(deviceKeyId: string, label: string, seenAt?: number): void
}

export function createDeviceAuthorization(
  config: DeviceAuthorizationConfig
): DeviceAuthorization {
  const maxGrants = config.maxGrants ?? DEFAULT_MAX_GRANTS

  function bytes(grant: Omit<DeviceGrant, 'sig'>): Uint8Array {
    return encodeCanonicalLines([
      config.scheme,
      String(grant.v),
      grant.userId,
      grant.issuerDeviceKeyId,
      grant.subjectDeviceKeyId,
      String(grant.createdAt),
      grant.pairingId,
    ])
  }

  async function verify(grant: DeviceGrant): Promise<boolean> {
    if (!isWellFormed(grant)) return false
    return verifyWithDeviceKeyId(grant.issuerDeviceKeyId, bytes(grant), grant.sig)
  }

  function readStored(): DeviceGrant[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(config.grantsKey) ?? '[]') as unknown
      return Array.isArray(parsed) ? (parsed.slice(-maxGrants) as DeviceGrant[]) : []
    } catch {
      return []
    }
  }

  function writeStored(grants: readonly DeviceGrant[]): void {
    localStorage.setItem(config.grantsKey, JSON.stringify(grants.slice(-maxGrants)))
  }

  type DeviceMeta = Record<string, { label?: string; lastSeenAt?: number }>

  function readMeta(): DeviceMeta {
    try {
      const parsed = JSON.parse(localStorage.getItem(config.metaKey) ?? '{}') as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as DeviceMeta)
        : {}
    } catch {
      return {}
    }
  }

  function announce(event: string): void {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(event))
  }

  /** Declared here rather than as a method: apps re-export these as bare
   *  functions, so nothing may depend on the receiver. */
  async function load(userId: string): Promise<DeviceGrant[]> {
    const valid: DeviceGrant[] = []
    for (const grant of readStored()) {
      if (grant.userId === userId && (await verify(grant))) valid.push(grant)
    }
    return valid
  }

  return {
    bytes,
    verify,

    async sign(signer, fields) {
      const issuerDeviceKeyId = (await signer.publicKeyId()) as DeviceKeyId
      if (
        !fields.userId ||
        !fields.subjectDeviceKeyId ||
        issuerDeviceKeyId === fields.subjectDeviceKeyId
      ) {
        throw new Error('A device grant requires one account and two distinct device keys')
      }
      const body: Omit<DeviceGrant, 'sig'> = {
        v: 1,
        userId: fields.userId,
        issuerDeviceKeyId,
        subjectDeviceKeyId: fields.subjectDeviceKeyId,
        createdAt: Date.now(),
        pairingId: fields.pairingId,
      }
      return { ...body, sig: await signer.sign(bytes(body)) }
    },

    load,

    async save(grant) {
      if (!(await verify(grant))) return false
      const kept = readStored().filter(
        item =>
          !(
            item.userId === grant.userId &&
            item.issuerDeviceKeyId === grant.issuerDeviceKeyId &&
            item.subjectDeviceKeyId === grant.subjectDeviceKeyId
          )
      )
      writeStored([...kept, grant])
      return true
    },

    find(userId, issuerDeviceKeyId, subjectDeviceKeyId) {
      return readStored().find(
        grant =>
          grant.userId === userId &&
          grant.issuerDeviceKeyId === issuerDeviceKeyId &&
          (!subjectDeviceKeyId || grant.subjectDeviceKeyId === subjectDeviceKeyId)
      )
    },

    findAuthorizing(userId, subjectDeviceKeyId) {
      return readStored().find(
        grant => grant.userId === userId && grant.subjectDeviceKeyId === subjectDeviceKeyId
      )
    },

    async listApproved(userId, currentDeviceKeyId) {
      const grants = await load(userId)
      const meta = readMeta()
      const devices = new Map<string, ApprovedDevice>()
      for (const outgoing of grants) {
        if (outgoing.issuerDeviceKeyId !== currentDeviceKeyId) continue
        // One direction only means we vouched for a device that never
        // vouched back — a half-finished pairing, not an approved device.
        const reverse = grants.find(
          grant =>
            grant.issuerDeviceKeyId === outgoing.subjectDeviceKeyId &&
            grant.subjectDeviceKeyId === currentDeviceKeyId
        )
        if (!reverse) continue
        const deviceKeyId = outgoing.subjectDeviceKeyId
        devices.set(deviceKeyId, {
          deviceKeyId,
          label: meta[deviceKeyId]?.label || deviceFingerprint(deviceKeyId),
          approvedAt: Math.max(outgoing.createdAt, reverse.createdAt),
          ...(meta[deviceKeyId]?.lastSeenAt === undefined
            ? {}
            : { lastSeenAt: meta[deviceKeyId]?.lastSeenAt }),
        })
      }
      return [...devices.values()].sort((a, b) => b.approvedAt - a.approvedAt)
    },

    revoke(userId, currentDeviceKeyId, otherDeviceKeyId) {
      // Both directions go: keeping the inbound half would let the revoked
      // device keep proving it belongs to this account.
      writeStored(
        readStored().filter(
          grant =>
            grant.userId !== userId ||
            !(
              (grant.issuerDeviceKeyId === currentDeviceKeyId &&
                grant.subjectDeviceKeyId === otherDeviceKeyId) ||
              (grant.issuerDeviceKeyId === otherDeviceKeyId &&
                grant.subjectDeviceKeyId === currentDeviceKeyId)
            )
        )
      )
      const meta = readMeta()
      delete meta[otherDeviceKeyId]
      localStorage.setItem(config.metaKey, JSON.stringify(meta))
      announce(config.changedEvent)
    },

    remember(deviceKeyId, label, seenAt = Date.now()) {
      if (!deviceKeyId) return
      const meta = readMeta()
      meta[deviceKeyId] = {
        // A blank label must not erase one the user already recognises.
        label: label.trim().slice(0, 80) || meta[deviceKeyId]?.label || deviceFingerprint(deviceKeyId),
        lastSeenAt: seenAt,
      }
      localStorage.setItem(config.metaKey, JSON.stringify(meta))
      announce(config.metaChangedEvent)
    },
  }
}
