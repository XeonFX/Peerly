import { afterEach, expect, it, vi } from 'vitest'
import { loadLocalHistory, saveLocalHistory, clearUnsavedWorkspaceHistory } from './historyStorage'
import { buildWorkspaceBackup } from './workspaceBackup'

afterEach(() => vi.unstubAllGlobals())
it('reports storage failure and keeps the newest messages exportable until a successful retry', () => {
  const values = new Map<string, string>()
  let full = false
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (full) throw new DOMException('Quota exhausted', 'QuotaExceededError')
      values.set(key, value)
    } })
  const first = { id: 'one', type: 'text' as const, text: 'saved', timestamp: 1, channelId: 'general',
    senderId: 'alice', senderName: 'Alice', senderColor: '#fff' }
  const latest = { ...first, id: 'two', text: 'must survive export', timestamp: 2 }
  expect(saveLocalHistory('workspace', 'general', [first])).toBe(true)
  full = true
  expect(saveLocalHistory('workspace', 'general', [first, latest])).toBe(false)
  const backup = buildWorkspaceBackup({ workspaceId: 'workspace', workspaceName: 'Team', creatorKeyId: 'creator',
    allowList: { emails: [], signedAt: 0, signature: '' }, lastOpenedAt: 0 })
  expect(backup.histories.general.map(entry => entry.text)).toContain(latest.text)
  full = false
  expect(saveLocalHistory('workspace', 'general', [first, latest])).toBe(true)
  clearUnsavedWorkspaceHistory('workspace')
  expect(loadLocalHistory('workspace', 'general')).toHaveLength(2)
})
