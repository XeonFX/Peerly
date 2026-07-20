import { encodeCanonicalLines, verifyWithDeviceKeyId, type DeviceKeyId } from '@peerly/core'
import type { DeviceIdentity } from './deviceIdentity'

const GRANTS_KEY = 'peerly-device-grants-v1'
const META_KEY = 'peerly-device-meta-v1'
const MAX_GRANTS = 48

export type DeviceGrant = {
  v: 1
  userId: string
  issuerDeviceKeyId: DeviceKeyId
  subjectDeviceKeyId: DeviceKeyId
  createdAt: number
  pairingId: string
  sig: string
}

export type ApprovedDevice = {
  deviceKeyId: string
  label: string
  approvedAt: number
  lastSeenAt?: number
}

export function deviceGrantBytes(grant: Omit<DeviceGrant, 'sig'>): Uint8Array {
  return encodeCanonicalLines([
    'peerly-device-grant-v1',
    String(grant.v),
    grant.userId,
    grant.issuerDeviceKeyId,
    grant.subjectDeviceKeyId,
    String(grant.createdAt),
    grant.pairingId,
  ])
}

export async function signDeviceGrant(
  identity: DeviceIdentity,
  userId: string,
  subjectDeviceKeyId: string,
  pairingId: string
): Promise<DeviceGrant> {
  const issuerDeviceKeyId = await identity.publicKeyId()
  if (!userId || !subjectDeviceKeyId || issuerDeviceKeyId === subjectDeviceKeyId) {
    throw new Error('Device grant requires two distinct keys for one account')
  }
  const body: Omit<DeviceGrant, 'sig'> = {
    v: 1,
    userId,
    issuerDeviceKeyId,
    subjectDeviceKeyId,
    createdAt: Date.now(),
    pairingId,
  }
  return { ...body, sig: await identity.sign(deviceGrantBytes(body)) }
}

export async function verifyDeviceGrant(grant: DeviceGrant): Promise<boolean> {
  if (
    !grant || grant.v !== 1 || !grant.userId ||
    !grant.issuerDeviceKeyId || !grant.subjectDeviceKeyId ||
    grant.issuerDeviceKeyId === grant.subjectDeviceKeyId ||
    !Number.isFinite(grant.createdAt) ||
    typeof grant.pairingId !== 'string' || grant.pairingId.length < 16 || grant.pairingId.length > 128 ||
    typeof grant.sig !== 'string' || !grant.sig
  ) return false
  return verifyWithDeviceKeyId(grant.issuerDeviceKeyId, deviceGrantBytes(grant), grant.sig)
}

function readGrants(): DeviceGrant[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(GRANTS_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.slice(-MAX_GRANTS) as DeviceGrant[] : []
  } catch {
    return []
  }
}

export async function loadDeviceGrants(userId: string): Promise<DeviceGrant[]> {
  const valid: DeviceGrant[] = []
  for (const grant of readGrants()) {
    if (grant.userId === userId && await verifyDeviceGrant(grant)) valid.push(grant)
  }
  return valid
}

export async function saveDeviceGrant(grant: DeviceGrant): Promise<boolean> {
  if (!(await verifyDeviceGrant(grant))) return false
  const grants = readGrants().filter(item => !(
    item.userId === grant.userId &&
    item.issuerDeviceKeyId === grant.issuerDeviceKeyId &&
    item.subjectDeviceKeyId === grant.subjectDeviceKeyId
  ))
  localStorage.setItem(GRANTS_KEY, JSON.stringify([...grants, grant].slice(-MAX_GRANTS)))
  return true
}

export function findDeviceGrant(
  userId: string,
  issuerDeviceKeyId: string,
  subjectDeviceKeyId?: string
): DeviceGrant | undefined {
  return readGrants().find(grant =>
    grant.userId === userId &&
    grant.issuerDeviceKeyId === issuerDeviceKeyId &&
    (!subjectDeviceKeyId || grant.subjectDeviceKeyId === subjectDeviceKeyId)
  )
}

export function findAuthorizingDeviceGrant(
  userId: string,
  subjectDeviceKeyId: string
): DeviceGrant | undefined {
  return readGrants().find(grant =>
    grant.userId === userId && grant.subjectDeviceKeyId === subjectDeviceKeyId
  )
}

export function grantAuthorizes(
  grant: DeviceGrant | undefined,
  userId: string,
  issuerDeviceKeyId: string,
  subjectDeviceKeyId: string
): boolean {
  return Boolean(grant && grant.userId === userId &&
    grant.issuerDeviceKeyId === issuerDeviceKeyId &&
    grant.subjectDeviceKeyId === subjectDeviceKeyId)
}

type Meta = Record<string, { label?: string; lastSeenAt?: number }>
function readMeta(): Meta {
  try {
    const value = JSON.parse(localStorage.getItem(META_KEY) ?? '{}') as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Meta : {}
  } catch { return {} }
}

export function deviceFingerprint(key: string): string {
  const compact = key.replace(/^P-256:/, '').replace(/:/g, '')
  return `${compact.slice(0, 6)}…${compact.slice(-6)}`
}

export function rememberDevice(key: string, label: string, lastSeenAt = Date.now()): void {
  const meta = readMeta()
  meta[key] = { label: label.slice(0, 80), lastSeenAt }
  localStorage.setItem(META_KEY, JSON.stringify(meta))
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('peerly-device-meta-changed'))
}

export async function listApprovedDevices(userId: string, currentKey: string): Promise<ApprovedDevice[]> {
  const grants = await loadDeviceGrants(userId)
  const meta = readMeta()
  return grants
    .filter(out => out.issuerDeviceKeyId === currentKey && grants.some(back =>
      back.issuerDeviceKeyId === out.subjectDeviceKeyId && back.subjectDeviceKeyId === currentKey
    ))
    .map(out => ({
      deviceKeyId: out.subjectDeviceKeyId,
      label: meta[out.subjectDeviceKeyId]?.label || deviceFingerprint(out.subjectDeviceKeyId),
      approvedAt: out.createdAt,
      lastSeenAt: meta[out.subjectDeviceKeyId]?.lastSeenAt,
    }))
}

export function revokeDevice(userId: string, currentKey: string, otherKey: string): void {
  const next = readGrants().filter(grant => grant.userId !== userId || !(
    (grant.issuerDeviceKeyId === currentKey && grant.subjectDeviceKeyId === otherKey) ||
    (grant.issuerDeviceKeyId === otherKey && grant.subjectDeviceKeyId === currentKey)
  ))
  localStorage.setItem(GRANTS_KEY, JSON.stringify(next))
  const meta = readMeta()
  delete meta[otherKey]
  localStorage.setItem(META_KEY, JSON.stringify(meta))
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('peerly-devices-changed'))
}
