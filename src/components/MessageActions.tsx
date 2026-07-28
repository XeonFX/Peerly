import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  QUICK_REACTIONS,
  searchReactionCategories,
} from '@peerly/core'
import { useI18n } from '../i18n'
import { Icon, type IconName } from './Icon'
import { buildMessageLink } from '../utils/messageLink'

type Props = {
  messageId: string
  text: string
  canEdit: boolean
  canDelete: boolean
  onReact: (emoji: string) => void
  onReply: () => void
  onEdit: () => void
  onDelete: () => void
  onOpenChange?: (open: boolean) => void
  testIdPrefix?: string
}

type MenuAction = {
  label: string
  icon: IconName
  danger?: boolean
  run: () => void
}

type PanelPosition = { left: number; top: number; visible: boolean }

const PANEL_GAP = 6
const VIEWPORT_MARGIN = 8

async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value)
}

export function MessageActions({
  messageId,
  text,
  canEdit,
  canDelete,
  onReact,
  onReply,
  onEdit,
  onDelete,
  onOpenChange,
  testIdPrefix = 'message',
}: Props) {
  const { tr } = useI18n()
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [panel, setPanel] = useState<'reactions' | 'more' | null>(null)
  const [position, setPosition] = useState<PanelPosition>({ left: 0, top: 0, visible: false })
  const [search, setSearch] = useState('')
  const categories = useMemo(() => searchReactionCategories(search), [search])

  useEffect(() => {
    onOpenChange?.(panel !== null)
  }, [onOpenChange, panel])

  useEffect(() => {
    if (!panel) return
    const close = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) setPanel(null)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanel(null)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [panel])

  useLayoutEffect(() => {
    if (!panel) return
    const place = () => {
      const anchor = rootRef.current?.getBoundingClientRect()
      const floating = panelRef.current
      if (!anchor || !floating) return
      const width = floating.offsetWidth
      const height = floating.offsetHeight
      const left = Math.min(
        window.innerWidth - width - VIEWPORT_MARGIN,
        Math.max(VIEWPORT_MARGIN, anchor.right - width)
      )
      const roomBelow = window.innerHeight - anchor.bottom - VIEWPORT_MARGIN
      const top = roomBelow >= height + PANEL_GAP
        ? anchor.bottom + PANEL_GAP
        : Math.max(VIEWPORT_MARGIN, anchor.top - height - PANEL_GAP)
      setPosition({ left, top, visible: true })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [panel])

  const chooseReaction = (emoji: string) => {
    onReact(emoji)
    setPanel(null)
    setSearch('')
  }

  const menuActions: MenuAction[] = [
    {
      label: tr('Add reaction'),
      icon: 'smile',
      run: () => setPanel('reactions'),
    },
    {
      label: tr('Reply'),
      icon: 'reply',
      run: () => {
        onReply()
        setPanel(null)
      },
    },
    ...(canEdit
      ? [{
          label: tr('Edit message'),
          icon: 'pencil' as const,
          run: () => {
            onEdit()
            setPanel(null)
          },
        }]
      : []),
    ...(canDelete
      ? [{
          label: tr('Delete message'),
          icon: 'trash' as const,
          danger: true,
          run: () => {
            onDelete()
            setPanel(null)
          },
        }]
      : []),
    {
      label: tr('Copy text'),
      icon: 'copy',
      run: () => {
        void copyText(text)
        setPanel(null)
      },
    },
    {
      label: tr('Copy link'),
      icon: 'link',
      run: () => {
        void copyText(buildMessageLink(messageId))
        setPanel(null)
      },
    },
  ]

  const floatingPanel = panel === 'reactions' ? (
    <div
      ref={panelRef}
      className="fixed z-100 w-80 max-w-[calc(100vw-1rem)] rounded-xl border border-base-300 bg-base-100 p-2 shadow-2xl"
      style={{ left: position.left, top: position.top, visibility: position.visible ? 'visible' : 'hidden' }}
      data-testid={`${testIdPrefix}-reaction-picker`}
    >
      <label className="input input-bordered input-sm flex items-center gap-2">
        <Icon name="search" size={14} />
        <input
          type="search"
          className="min-w-0 grow"
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder={tr('Search reactions')}
          autoFocus
        />
      </label>
      <div className="mt-2 max-h-72 overflow-y-auto">
        {categories.map(category => (
          <div key={category.id} className="mb-2 last:mb-0">
            <h3 className="px-1 pb-1 text-[0.65rem] font-semibold uppercase tracking-wide text-base-content/55">
              {tr(category.label)}
            </h3>
            <div className="grid grid-cols-7 gap-0.5">
              {category.reactions.map(reaction => (
                <button
                  key={reaction.emoji}
                  type="button"
                  className="btn btn-ghost btn-sm btn-square text-lg"
                  onClick={() => chooseReaction(reaction.emoji)}
                  aria-label={tr('React {emoji}', { emoji: reaction.emoji })}
                >
                  {reaction.emoji}
                </button>
              ))}
            </div>
          </div>
        ))}
        {categories.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-base-content/55">{tr('No reactions found.')}</p>
        )}
      </div>
    </div>
  ) : panel === 'more' ? (
    <div
      ref={panelRef}
      className="menu fixed z-100 w-52 rounded-xl border border-base-300 bg-base-100 p-1.5 shadow-2xl"
      style={{ left: position.left, top: position.top, visibility: position.visible ? 'visible' : 'hidden' }}
      data-testid={`${testIdPrefix}-more-menu`}
    >
      {menuActions.map(action => (
        <button
          key={action.label}
          type="button"
          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-base-200 ${action.danger ? 'text-error' : ''}`}
          onClick={action.run}
        >
          <Icon name={action.icon} size={15} />
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  ) : null

  return (
    <div
      ref={rootRef}
      className={`absolute right-2 top-0 z-20 ${panel ? '' : 'pointer-events-none opacity-0'} transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100`}
      data-testid={`${testIdPrefix}-actions`}
      data-actions-open={panel ? 'true' : 'false'}
    >
      <div className="flex h-8 items-center rounded-lg border border-base-300 bg-base-100 p-0.5 shadow-sm">
        {QUICK_REACTIONS.map(emoji => (
          <button
            key={emoji}
            type="button"
            className="btn btn-ghost btn-xs btn-square"
            onClick={() => chooseReaction(emoji)}
            aria-label={tr('React {emoji}', { emoji })}
            title={tr('React {emoji}', { emoji })}
          >
            {emoji}
          </button>
        ))}
        <button
          type="button"
          className="btn btn-ghost btn-xs btn-square"
          onClick={() => setPanel(current => current === 'reactions' ? null : 'reactions')}
          aria-label={tr('Add reaction')}
          title={tr('Add reaction')}
          aria-expanded={panel === 'reactions'}
        >
          <Icon name="smile" size={14} />
        </button>
        <button type="button" className="btn btn-ghost btn-xs btn-square" onClick={onReply} aria-label={tr('Reply')} title={tr('Reply')}>
          <Icon name="reply" size={14} />
        </button>
        {canEdit && (
          <button type="button" className="btn btn-ghost btn-xs btn-square" onClick={onEdit} aria-label={tr('Edit message')} title={tr('Edit message')}>
            <Icon name="pencil" size={13} />
          </button>
        )}
        {canDelete && (
          <button type="button" className="btn btn-ghost btn-xs btn-square text-error" onClick={onDelete} aria-label={tr('Delete message')} title={tr('Delete message')}>
            <Icon name="trash" size={13} />
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-xs btn-square"
          onClick={() => setPanel(current => current === 'more' ? null : 'more')}
          aria-label={tr('More actions')}
          title={tr('More actions')}
          aria-expanded={panel === 'more'}
        >
          <Icon name="more-horizontal" size={15} />
        </button>
      </div>
      {floatingPanel && createPortal(floatingPanel, document.body)}
    </div>
  )
}
