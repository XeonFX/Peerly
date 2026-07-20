import type { StoredWorkspace } from '../collab/workspaceStore'
import { useI18n } from '../i18n'
import { Icon } from './Icon'
import { WorkspaceAvatar } from './WorkspaceAvatar'
import peerlyBrand from '../assets/peerly-brand.webp'

type Props = {
  workspaces: StoredWorkspace[]
  /** Workspace id currently open, or undefined when on the home view. */
  activeWorkspaceId?: string
  /** True when the home / direct-messages view is showing. */
  onHome: boolean
  onDevices: boolean
  onSync: boolean
  onAccount: boolean
  onSelectWorkspace: (workspace: StoredWorkspace) => void
  onHomeSelect: () => void
  onDevicesSelect: () => void
  onSyncSelect: () => void
  onAccountSelect: () => void
  onCreateWorkspace: () => void
  /** Per-workspace unread totals (best-effort; only the active one is live). */
  unreadByWorkspace?: Record<string, number>
}

/**
 * Discord-style far-left rail: Direct Messages / Home on top, joined workspaces
 * as icons below, and a create-workspace button at the bottom. Replaces the old
 * in-sidebar "switch workspace" button — switching now happens here, in place.
 */
export function WorkspaceRail({
  workspaces,
  activeWorkspaceId,
  onHome,
  onDevices,
  onSync,
  onAccount,
  onSelectWorkspace,
  onHomeSelect,
  onDevicesSelect,
  onSyncSelect,
  onAccountSelect,
  onCreateWorkspace,
  unreadByWorkspace = {},
}: Props) {
  const { tr } = useI18n()

  return (
    <nav
      className="workspace-rail flex w-16 shrink-0 flex-col items-center gap-2 border-r border-base-300/70 bg-base-300/40 py-3"
      aria-label={tr('Workspaces')}
      data-testid="workspace-rail"
    >
      <RailButton
        label={tr('Direct messages')}
        active={onHome}
        onClick={onHomeSelect}
        testId="rail-home"
      >
        <img src={peerlyBrand} alt="" className="h-7 w-7 object-contain" />
      </RailButton>

      <RailButton
        label={tr('Sync activity')}
        active={onSync}
        onClick={onSyncSelect}
        testId="rail-sync"
      >
        <Icon name="refresh" size={21} />
      </RailButton>

      <div className="my-1 h-px w-8 shrink-0 bg-base-content/10" />

      <RailButton
        label={tr('My devices')}
        active={onDevices}
        onClick={onDevicesSelect}
        testId="rail-devices"
      >
        <Icon name="shield" size={21} />
      </RailButton>

      <RailButton
        label={tr('Profile & preferences')}
        active={onAccount}
        onClick={onAccountSelect}
        testId="rail-account"
      >
        <Icon name="user" size={21} />
      </RailButton>

      <div className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto">
        {workspaces.map(workspace => (
          <RailButton
            key={workspace.workspaceId}
            label={workspace.workspaceName}
            active={!onHome && !onDevices && !onSync && !onAccount && workspace.workspaceId === activeWorkspaceId}
            unread={unreadByWorkspace[workspace.workspaceId] ?? 0}
            onClick={() => onSelectWorkspace(workspace)}
            testId={`rail-workspace-${workspace.workspaceId}`}
          >
            <WorkspaceAvatar name={workspace.workspaceName} avatarId={workspace.workspaceAvatarId} size="md" />
          </RailButton>
        ))}
      </div>

      <RailButton
        label={tr('Create workspace')}
        onClick={onCreateWorkspace}
        testId="rail-create-workspace"
        emphasis="create"
      >
        <Icon name="plus" size={20} />
      </RailButton>
    </nav>
  )
}

function RailButton({
  children,
  label,
  active = false,
  unread = 0,
  emphasis,
  onClick,
  testId,
}: {
  children: React.ReactNode
  label: string
  active?: boolean
  unread?: number
  emphasis?: 'create'
  onClick: () => void
  testId: string
}) {
  return (
    <div className="group relative flex w-full items-center justify-center">
      {/* Discord-style active/hover pill on the left edge. */}
      <span
        className={`absolute left-0 w-1 rounded-r-full bg-primary transition-all ${
          active ? 'h-8' : 'h-0 group-hover:h-4'
        }`}
        aria-hidden
      />
      <button
        type="button"
        onClick={onClick}
        title={label}
        aria-label={label}
        aria-current={active || undefined}
        data-testid={testId}
        className={`relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl transition-all duration-150 hover:rounded-xl ${
          active
            ? 'rounded-xl bg-primary/15 text-primary ring-2 ring-primary/50'
            : emphasis === 'create'
              ? 'bg-base-100/70 text-success hover:bg-success/15'
              : 'bg-base-100/70 text-base-content hover:bg-primary/15 hover:text-primary'
        }`}
      >
        {children}
        {unread > 0 && (
          <span
            className="absolute -bottom-0.5 -right-0.5 min-w-4 rounded-full border-2 border-base-300 bg-primary px-1 text-[0.6rem] font-semibold leading-4 text-primary-content"
            data-testid={`rail-unread-${testId}`}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    </div>
  )
}
