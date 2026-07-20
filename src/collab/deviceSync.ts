const CONFIG_KEY = 'peerly-account-sync-v1'
const MAX_BYTES = 2_000_000
const MAX_KEYS = 500

export type DeviceSyncSnapshot = {
  v: 1
  createdAt: number
  values: Record<string, string>
  accountSyncSecret?: string
}

function allowed(key: string): boolean {
  if (!key.startsWith('peerly-')) return false
  return ![
    'peerly-session',
    'peerly-id-token',
    'peerly-id-user-id',
    'peerly-id-provider',
    'peerly-id-email',
    'peerly-device-grants-v1',
    'peerly-device-meta-v1',
    CONFIG_KEY,
    'peerly-legal-consent-v1',
  ].includes(key)
}

export function loadAccountSyncSecret(userId: string): string | null {
  try {
    const value = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? '{}') as { userId?: unknown; secret?: unknown }
    return value.userId === userId && typeof value.secret === 'string' && /^[0-9a-f]{32}$/i.test(value.secret)
      ? value.secret.toLowerCase()
      : null
  } catch { return null }
}

export function ensureAccountSyncSecret(userId: string): string {
  const current = loadAccountSyncSecret(userId)
  if (current) return current
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const secret = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ userId, secret }))
  return secret
}

function saveSecret(userId: string, secret: string | undefined): void {
  if (secret && /^[0-9a-f]{32}$/i.test(secret)) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ userId, secret: secret.toLowerCase() }))
  }
}

export function createDeviceSyncSnapshot(accountSyncSecret?: string): DeviceSyncSnapshot {
  const values: Record<string, string> = {}
  let bytes = 0
  for (let index = 0; index < localStorage.length && Object.keys(values).length < MAX_KEYS; index++) {
    const key = localStorage.key(index)
    if (!key || !allowed(key)) continue
    const value = localStorage.getItem(key)
    if (value === null) continue
    const size = new Blob([key, value]).size
    if (bytes + size > MAX_BYTES) continue
    values[key] = value
    bytes += size
  }
  return { v: 1, createdAt: Date.now(), values, accountSyncSecret }
}

function mergeArrays(current: string, incoming: string, key: string): string {
  try {
    const left = JSON.parse(current) as unknown
    const right = JSON.parse(incoming) as unknown
    if (!Array.isArray(left) || !Array.isArray(right)) return current
    const byId = new Map<string, Record<string, unknown>>()
    const idOf = (item: Record<string, unknown>) => {
      if (key === 'peerly-workspaces') return String(item.workspaceId ?? '')
      if (key === 'peerly-friends-v1') return String(item.subjectUserId ?? '')
      return String(item.id ?? `${item.messageId ?? ''}\0${item.actorUserId ?? item.actorId ?? ''}\0${item.emoji ?? ''}`)
    }
    const revision = (item: Record<string, unknown>) => Math.max(
      Number(item.deletedAt ?? 0), Number(item.editedAt ?? 0),
      Number(item.timestamp ?? 0), Number(item.ts ?? 0),
      Number(item.lastOpenedAt ?? 0), Number(item.updatedAt ?? 0)
    )
    for (const value of [...left, ...right]) {
      if (!value || typeof value !== 'object') continue
      const item = value as Record<string, unknown>
      const id = idOf(item)
      if (!id) continue
      const previous = byId.get(id)
      if (!previous || revision(item) >= revision(previous)) byId.set(id, item)
    }
    return JSON.stringify([...byId.values()].sort((a, b) => revision(a) - revision(b)).slice(-500))
  } catch { return current }
}

function mergeObjects(current: string, incoming: string): string {
  try {
    const left = JSON.parse(current) as Record<string, unknown>
    const right = JSON.parse(incoming) as Record<string, unknown>
    if (!left || !right || Array.isArray(left) || Array.isArray(right)) return current
    return JSON.stringify({ ...left, ...right })
  } catch { return current }
}

function mergeDmHistory(current: string, incoming: string): string {
  try {
    const left = JSON.parse(current) as { wires?: unknown[]; reactions?: unknown[]; savedAt?: unknown }
    const right = JSON.parse(incoming) as { wires?: unknown[]; reactions?: unknown[]; savedAt?: unknown }
    if (!Array.isArray(left?.wires) || !Array.isArray(right?.wires)) return current
    const wires = mergeArrays(JSON.stringify(left.wires), JSON.stringify(right.wires), 'peerly-history-dm')
    const reactions = mergeArrays(
      JSON.stringify(left.reactions ?? []), JSON.stringify(right.reactions ?? []), 'peerly-reactions-dm'
    )
    return JSON.stringify({
      v: 2,
      savedAt: Math.max(Number(left.savedAt ?? 0), Number(right.savedAt ?? 0)),
      wires: JSON.parse(wires),
      reactions: JSON.parse(reactions),
    })
  } catch { return current }
}

export function importDeviceSyncSnapshot(snapshot: DeviceSyncSnapshot, userId: string): number {
  if (!snapshot || snapshot.v !== 1 || !snapshot.values || typeof snapshot.values !== 'object') return 0
  saveSecret(userId, snapshot.accountSyncSecret)
  let count = 0
  let bytes = 0
  const writeIfChanged = (key: string, current: string | null, next: string) => {
    if (current === next) return
    localStorage.setItem(key, next)
    count++
  }
  for (const [key, incoming] of Object.entries(snapshot.values).slice(0, MAX_KEYS)) {
    if (!allowed(key) || typeof incoming !== 'string') continue
    bytes += new Blob([key, incoming]).size
    if (bytes > MAX_BYTES) break
    const current = localStorage.getItem(key)
    if (current === null) writeIfChanged(key, current, incoming)
    else if (key.startsWith('peerly-gdm-hist-v1-')) {
      writeIfChanged(key, current, mergeDmHistory(current, incoming))
    } else if (
      key.startsWith('peerly-history-') ||
      key.startsWith('peerly-channels-') || key === 'peerly-workspaces' ||
      key === 'peerly-friends-v1' || key.endsWith('-subs-v1')
    ) writeIfChanged(key, current, mergeArrays(current, incoming, key))
    else if (key === 'peerly-dm-credentials-v1' || key === 'peerly-profile') {
      writeIfChanged(key, current, mergeObjects(current, incoming))
    } else continue
  }
  if (count && typeof window !== 'undefined') window.dispatchEvent(new Event('peerly-device-data-synced'))
  return count
}
