import type { DeviceKeyId } from './deviceIdentity'

/**
 * Which device keys belong to which durable user, per workspace, learned only
 * from live handshakes (the one moment a key, an ID token, and a
 * proof-of-possession are all verified together). History verification uses
 * this to decide whether a signed entry may keep its identity claim.
 *
 * localStorage-persisted so history from members who are offline *now* still
 * verifies, as long as this device met them at least once.
 */

const KEY_PREFIX = 'peerly-key-bindings:'
const MAX_BINDINGS = 200

function storageKey(workspaceId: string): string {
  return `${KEY_PREFIX}${workspaceId}`
}

export function loadKeyBindings(workspaceId: string): Record<DeviceKeyId, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(workspaceId)) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const bindings: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') bindings[key] = value
    }
    return bindings
  } catch {
    return {}
  }
}

export function rememberKeyBinding(
  workspaceId: string,
  deviceKeyId: DeviceKeyId,
  userId: string
): void {
  try {
    const bindings = loadKeyBindings(workspaceId)
    if (bindings[deviceKeyId] === userId) return
    bindings[deviceKeyId] = userId
    const entries = Object.entries(bindings).slice(-MAX_BINDINGS)
    localStorage.setItem(storageKey(workspaceId), JSON.stringify(Object.fromEntries(entries)))
  } catch {
    // Unbound keys only lose their identity claim, never message text.
  }
}
