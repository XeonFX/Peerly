import { useEffect, useState } from 'react'
import type { DeviceIdentity } from '../collab/deviceIdentity'
import {
  deviceFingerprint,
  listApprovedDevices,
  revokeDevice,
  type ApprovedDevice,
} from '../collab/deviceAuthorization'
import { revokeRealtimeDevice } from '@peerly/core'
import { useDevicePairing } from '../hooks/useDevicePairing'
import { useI18n } from '../i18n'
import { PUBLIC_NETWORK_ENV } from '../config'
import { Icon } from './Icon'

function newSecret(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export function MyDevicesPage({
  identity,
  userId,
  initialSecret,
}: {
  identity: DeviceIdentity
  userId: string
  initialSecret?: string
}) {
  const { tr } = useI18n()
  const [secret, setSecret] = useState<string | null>(initialSecret ?? null)
  const [role, setRole] = useState<'source' | 'target' | null>(initialSecret ? 'target' : null)
  const [currentKey, setCurrentKey] = useState('')
  const [devices, setDevices] = useState<ApprovedDevice[]>([])
  const [copied, setCopied] = useState(false)
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const pairing = useDevicePairing({ identity, userId, secret, role })
  const link = secret ? `${location.origin}/devices#pair=${secret}` : ''

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      void identity.publicKeyId().then(async key => {
        const approved = await listApprovedDevices(userId, key)
        if (!cancelled) { setCurrentKey(key); setDevices(approved) }
      })
    }
    refresh()
    window.addEventListener('peerly-devices-changed', refresh)
    window.addEventListener('peerly-device-meta-changed', refresh)
    return () => {
      cancelled = true
      window.removeEventListener('peerly-devices-changed', refresh)
      window.removeEventListener('peerly-device-meta-changed', refresh)
    }
  }, [identity, userId])

  return (
    <main className="h-full overflow-y-auto bg-base-200 p-6 sm:p-10" data-testid="my-devices-page">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold">{tr('My devices')}</h1>
        <p className="mt-2 text-sm text-base-content/65">
          {tr('Approve another device to sync your Peerly data and manage your messages from either device while both are online.')}
        </p>

        <section className="card mt-6 border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body gap-4">
            <div className="flex items-center gap-2 font-semibold"><Icon name="shield" /> {tr('Approved devices')}</div>
            <div className="rounded-box border border-base-300 p-3 text-sm">
              <div className="font-medium">{tr('This device')}</div>
              <div className="mt-1 font-mono text-xs text-base-content/55">{currentKey ? deviceFingerprint(currentKey) : '…'}</div>
            </div>
            {revokeError && (
              <div className="alert alert-warning text-sm" role="status">{revokeError}</div>
            )}
            {devices.length === 0 ? (
              <p className="text-sm text-base-content/55">{tr('No other devices are approved yet.')}</p>
            ) : devices.map(device => (
              <div key={device.deviceKeyId} className="flex items-center justify-between gap-4 rounded-box border border-base-300 p-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{device.label}</div>
                  <div className="mt-1 text-xs text-base-content/55">
                    {deviceFingerprint(device.deviceKeyId)}
                    {device.lastSeenAt ? ` · ${tr('Last seen')} ${new Date(device.lastSeenAt).toLocaleString()}` : ''}
                  </div>
                </div>
                <button className="btn btn-error btn-ghost btn-sm" type="button" onClick={() => {
                  if (!confirm(tr('Revoke this device? It will stop syncing with this device.'))) return
                  // Local first: dropping the peer-to-peer grant is the part
                  // that works offline and must never be blocked on network.
                  revokeDevice(userId, currentKey, device.deviceKeyId)
                  setRevokeError(null)
                  // Then the control plane, so the revoked device also loses
                  // its server session and capability instead of keeping them
                  // for the rest of their 30-day life. Surfaced on failure:
                  // a revocation that silently did nothing is worse than one
                  // that says so.
                  void revokeRealtimeDevice(PUBLIC_NETWORK_ENV, device.deviceKeyId).catch(() => {
                    setRevokeError(tr('Removed on this device, but the server could not be reached. Retry while online to sign that device out everywhere.'))
                  })
                }}>{tr('Revoke')}</button>
              </div>
            ))}

            {!secret && (
              <button className="btn btn-primary w-fit" type="button" onClick={() => {
                setSecret(newSecret()); setRole('source'); setCopied(false)
              }}>{tr('Approve another device')}</button>
            )}
            {secret && role === 'source' && !pairing.linked && (
              <div className="rounded-box border border-primary/30 bg-primary/5 p-4">
                <p className="text-sm">{tr('Open this private link on your other device:')}</p>
                <div className="mt-3 flex gap-2">
                  <input className="input input-bordered min-w-0 flex-1 text-xs" readOnly value={link} />
                  <button className="btn btn-outline" type="button" onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true))}>
                    {copied ? tr('Copied') : tr('Copy')}
                  </button>
                </div>
              </div>
            )}
            {secret && !pairing.remote && <p className="text-sm text-warning">{tr('Waiting for the other device…')}</p>}
            {pairing.remote && !pairing.sent && (
              <div className="rounded-box border border-warning/40 bg-warning/10 p-4">
                <p className="text-sm">{tr('Confirm that this fingerprint matches the other device:')} <span className="font-mono font-semibold">{deviceFingerprint(pairing.remote.deviceKeyId)}</span></p>
                <button className="btn btn-primary btn-sm mt-3" type="button" onClick={() => void pairing.approve()}>{tr('Approve device')}</button>
              </div>
            )}
            {pairing.sent && !pairing.linked && <p className="text-sm text-warning">{tr('Approved here. Confirm on the other device too.')}</p>}
            {pairing.linked && <div className="alert alert-success text-sm">{role === 'target' && pairing.synced === null ? tr('Approved. Syncing data…') : tr('Device approved and sync enabled.')}</div>}
            <p className="text-xs text-base-content/50">{tr('Pair only devices you control. Approval is mutual and the pairing link is a one-time secret.')}</p>
          </div>
        </section>
      </div>
    </main>
  )
}
