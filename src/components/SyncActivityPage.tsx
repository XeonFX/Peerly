import {
  clearSyncActivities,
  getSyncActivities,
  subscribeSyncActivities,
  type SyncActivity,
} from '@peerly/core'
import { useEffect, useState } from 'react'
import { deviceFingerprint } from '../collab/deviceAuthorization'
import { useI18n } from '../i18n'
import { safeAvatarUrl } from '../utils/avatarUrl'
import { Icon } from './Icon'

function bytesLabel(bytes: number | undefined): string {
  if (bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function SyncActivityPage() {
  const { tr } = useI18n()
  const [activities, setActivities] = useState<SyncActivity[]>(getSyncActivities)

  useEffect(() => subscribeSyncActivities(() => setActivities(getSyncActivities())), [])

  const peerLabel = (activity: SyncActivity) => {
    const peer = activity.peer
    if (peer.relationship === 'approved-device') return peer.deviceLabel || tr('Approved device')
    if (peer.name) return peer.name
    if (peer.relationship === 'stranger') return tr('Nearby user (not a friend)')
    if (peer.relationship === 'workspace-member') return tr('Workspace member')
    return tr('Unknown peer')
  }

  return (
    <main className="h-full overflow-y-auto bg-base-200 p-6 sm:p-10" data-testid="sync-activity-page">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{tr('Sync activity')}</h1>
            <p className="mt-2 max-w-2xl text-sm text-base-content/65">
              {tr('Metadata about recent peer-to-peer transfers. Message contents, room secrets, and private keys are never shown here.')}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
            clearSyncActivities(); setActivities([])
          }}>{tr('Clear')}</button>
        </div>

        <div className="mt-6 overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm">
          {activities.length === 0 ? (
            <div className="p-10 text-center text-sm text-base-content/55">{tr('No P2P transfers recorded in this session yet.')}</div>
          ) : (
            <ul className="divide-y divide-base-300">
              {activities.map(activity => {
                const avatar = safeAvatarUrl(activity.peer.avatar)
                const detail = activity.peer.deviceKeyId
                  ? deviceFingerprint(activity.peer.deviceKeyId)
                  : activity.peer.peerId ? `${tr('Peer')} ${activity.peer.peerId.slice(0, 10)}` : ''
                return (
                  <li key={activity.id} className="flex gap-3 p-4">
                    <div className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full ${activity.direction === 'sent' ? 'bg-primary/15 text-primary' : 'bg-success/15 text-success'}`}>
                      {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : <Icon name={activity.direction === 'sent' ? 'arrow-up' : 'arrow-down'} size={18} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div className="font-medium">{activity.direction === 'sent' ? tr('Sent to') : tr('Received from')} {peerLabel(activity)}</div>
                        <time className="text-xs text-base-content/45">{new Date(activity.at).toLocaleTimeString()}</time>
                      </div>
                      <div className="mt-0.5 text-sm text-base-content/70">{activity.summary}</div>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-base-content/45">
                        <span>{tr(activity.kind)}</span>
                        {activity.itemCount !== undefined && <span>{activity.itemCount} {tr('items')}</span>}
                        <span>{bytesLabel(activity.bytes)}</span>
                        {detail && <span className="font-mono">{detail}</span>}
                        <span>{tr(activity.peer.relationship)}</span>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </main>
  )
}
