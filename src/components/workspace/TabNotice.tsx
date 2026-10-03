import { TAB_NOTICE_TEXT, type SiblingTabNotice } from '../../hooks/collab/useSiblingTabs'
import { useI18n } from '../../i18n'
import { Icon } from '../Icon'

/** A short, dismissible line when another tab of this browser joins or leaves this workspace. */
export function TabNotice({ notice, onDismiss }: { notice: SiblingTabNotice | null; onDismiss: () => void }) {
  const { tr } = useI18n()
  if (!notice) return null
  return (
    <div
      className="flex shrink-0 items-start gap-2 border-b border-info/20 bg-info/10 px-3 py-1.5 text-xs text-info sm:px-5"
      role="status"
      aria-live="polite"
      data-testid="tab-notice"
      data-notice={notice}
    >
      <span className="min-w-0 flex-1 break-words">{tr(TAB_NOTICE_TEXT[notice])}</span>
      <button
        type="button"
        className="btn btn-ghost btn-xs btn-square -my-1 shrink-0 text-info"
        onClick={onDismiss}
        aria-label={tr('Dismiss')}
        data-testid="tab-notice-dismiss"
      >
        <Icon name="x" />
      </button>
    </div>
  )
}
