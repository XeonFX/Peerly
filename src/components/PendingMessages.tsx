import { useI18n } from '../i18n'

export function PendingMessages({ entries, onRetry }: {
  entries: { id: string; text: string; failed: boolean }[]
  onRetry: () => Promise<void>
}) {
  const { tr } = useI18n()
  if (!entries.length) return null
  return <div className="max-h-40 shrink-0 overflow-y-auto px-4 py-2" aria-live="polite" data-testid="pending-messages">
    {entries.map(entry => <div key={entry.id} className="my-1 rounded-box border border-base-300 p-2 text-sm">
      <p className="whitespace-pre-wrap break-words">{entry.text}</p>
      <span className="text-xs text-base-content/60">{tr(entry.failed ? 'Delivery not confirmed. Message saved for retry.' : 'Pending delivery. Saved on this device.')}</span>
    </div>)}
    <button type="button" className="btn btn-ghost btn-xs" onClick={() => { void onRetry() }}>{tr('Retry pending messages')}</button>
  </div>
}
