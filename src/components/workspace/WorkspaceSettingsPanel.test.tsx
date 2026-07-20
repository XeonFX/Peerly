// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { useBrowserStorage } from '../../hooks/useBrowserStorage'
import { I18nProvider } from '../../i18n'
import { WorkspaceSettingsPanel } from './WorkspaceSettingsPanel'

const mocks = vi.hoisted(() => ({
  clearWorkspaceData: vi.fn(async () => {}),
  estimateWorkspaceUsage: vi.fn(async () => ({
    messagesBytes: 120,
    filesBytes: 340,
    fileCount: 2,
    sharedFilesBytes: 560,
    sharedFileCount: 3,
    reclaimableBytes: 340,
    totalBytes: 460,
  })),
}))

vi.mock('../../utils/workspaceUsage', async importOriginal => {
  const original = await importOriginal<typeof import('../../utils/workspaceUsage')>()
  return {
    ...original,
    clearWorkspaceData: mocks.clearWorkspaceData,
    clearWorkspaceFiles: vi.fn(async () => {}),
    estimateWorkspaceUsage: mocks.estimateWorkspaceUsage,
  }
})

function browserStorage(): ReturnType<typeof useBrowserStorage> {
  return {
    estimate: {
      supported: true,
      usageBytes: 100,
      quotaBytes: 1000,
      availableBytes: 900,
      usageRatio: 0.1,
      persisted: true,
      measuredAt: 1,
    },
    pressure: 'ok',
    refresh: vi.fn(async () => {}),
    requestPersistence: vi.fn(async () => true),
    requestingPersistence: false,
  }
}

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: false })),
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('WorkspaceSettingsPanel', () => {
  it('renders workspace controls without global appearance preferences', async () => {
    render(
      <I18nProvider>
        <WorkspaceSettingsPanel
          workspaceId="workspace-1"
          workspaceName="Design team"
          browserStorage={browserStorage()}
          p2pCapability={{ status: 'available', detail: 'Browser WebRTC data channels are enabled. A real network path is confirmed when a teammate connects.' }}
          rtcPeerCount={0}
          connectionError={null}
          onRetryP2p={() => {}}
          onBeforeExport={() => {}}
          onLocalHistoryCleared={() => {}}
          notificationsSupported
          notificationsEnabled={false}
          notificationPermission="default"
          onEnableNotifications={async () => {}}
          onDisableNotifications={() => {}}
          soundsEnabled={false}
          onEnableSounds={async () => true}
          onDisableSounds={() => {}}
          onNameChange={() => {}}
          onAvatarChange={() => {}}
          onAvatarClear={() => {}}
          onBack={() => {}}
        />
      </I18nProvider>
    )

    await waitFor(() => expect(mocks.estimateWorkspaceUsage).toHaveBeenCalledWith('workspace-1'))
    expect(screen.getByTestId('workspace-storage').textContent).toContain('2 cached files')
    expect(screen.getByTestId('attention-sound-toggle').textContent).toContain('Turn on attention sounds')

    expect(screen.queryByTestId('locale-select')).toBeNull()
    expect(screen.queryByTestId('theme-toggle')).toBeNull()
  })

  it('clears local history after explicit confirmation', async () => {
    const onLocalHistoryCleared = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <I18nProvider>
        <WorkspaceSettingsPanel
          workspaceId="workspace-1"
          workspaceName="Design team"
          browserStorage={browserStorage()}
          p2pCapability={{ status: 'available', detail: 'ready' }}
          rtcPeerCount={0}
          connectionError={null}
          onRetryP2p={() => {}}
          onBeforeExport={() => {}}
          onLocalHistoryCleared={onLocalHistoryCleared}
          notificationsSupported={false}
          notificationsEnabled={false}
          notificationPermission="unsupported"
          onEnableNotifications={async () => {}}
          onDisableNotifications={() => {}}
          soundsEnabled={false}
          onEnableSounds={async () => true}
          onDisableSounds={() => {}}
          onNameChange={() => {}}
          onAvatarChange={() => {}}
          onAvatarClear={() => {}}
          onBack={() => {}}
        />
      </I18nProvider>
    )

    await waitFor(() => expect(mocks.estimateWorkspaceUsage).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('clear-local-history'))
    await waitFor(() => expect(mocks.clearWorkspaceData).toHaveBeenCalledWith('workspace-1'))
    expect(onLocalHistoryCleared).toHaveBeenCalledOnce()
  })
})
