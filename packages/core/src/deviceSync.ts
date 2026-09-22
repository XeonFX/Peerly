/**
 * Copying an account's local data onto a device the user has just paired.
 *
 * Two rules shape everything here.
 *
 * The first is that the key allow-list is *closed*. Only keys a rule names are
 * ever read out of storage or written into it. One app used to do the
 * opposite — sync everything under its prefix except a short deny-list — which
 * means every key any future feature invents is synced by default, and the
 * only thing standing between a per-device value and another device is
 * somebody remembering to add it to the deny-list.
 *
 * The second is that importing never destroys. A device that already has data
 * keeps it; the incoming copy is merged in. There is no ordering between two
 * devices that both went offline, so "last writer wins" would mean "whichever
 * device the user happened to pair second wins".
 */

const HEX_32 = /^[0-9a-f]{32}$/i

export type DeviceSyncSnapshot = {
  v: 1
  createdAt: number
  values: Record<string, string>
  /** Shared only inside the approved one-time pairing room. */
  accountSyncSecret?: string
}

type Item = Record<string, unknown>

/** Merge two lists of records by identity, newest revision winning. */
export type ArrayMergeRule = {
  merge: 'array'
  /** Identity of a record. An empty string drops it. */
  idOf(item: Item): string
  /** Which of two records with the same id is newer. */
  revisionOf(item: Item): number
  /** Sort key for the merged list. Defaults to `revisionOf`. */
  orderBy?(item: Item): number
  /** Keep at most this many, dropping from the front. */
  cap?: number
  /**
   * Leave the merged list in local-then-incoming order instead of sorting.
   * For lists whose order is user-facing — a workspace rail should not
   * rearrange itself after a sync.
   */
  preserveOrder?: boolean
}

/** Shallow-merge two maps, incoming winning per field. */
export type ObjectMergeRule = { merge: 'object' }

/** A record with named lists inside it, each merged on its own terms. */
export type EnvelopeMergeRule = {
  merge: 'envelope'
  version: number
  /** Field name → how that list merges. */
  lists: Record<string, Omit<ArrayMergeRule, 'merge'>>
  /** Fields merged by taking the larger number, such as a saved-at stamp. */
  maxFields?: readonly string[]
}

/** Take the incoming value only when this device has none. */
export type CopyRule = { merge: 'copy' }

export type MergeRule = ArrayMergeRule | ObjectMergeRule | EnvelopeMergeRule | CopyRule

export type DeviceSyncConfig = {
  /** Where the account sync secret is kept. Never itself synced. */
  secretKey: string
  /** Exactly-named keys and how each merges. */
  keys: Readonly<Record<string, MergeRule>>
  /** Keys with a variable suffix — one workspace, one conversation. */
  prefixes?: readonly (readonly [prefix: string, rule: MergeRule])[]
  /** Refuse a snapshot larger than this, so one device cannot fill another. */
  maxBytes?: number
  maxKeys?: number
  /** Dispatched on `window` after an import wrote anything. */
  changedEvent?: string
}

const DEFAULT_MAX_BYTES = 2_000_000
const DEFAULT_MAX_KEYS = 500

export type DeviceSync = {
  /** This account's sync secret, or null if none is stored for it. */
  loadSecret(userId: string): string | null
  /** As `loadSecret`, minting one on first use. */
  ensureSecret(userId: string): string
  snapshot(accountSyncSecret?: string, storage?: Storage): DeviceSyncSnapshot
  /** Merges a snapshot in. Returns how many keys actually changed. */
  import(snapshot: DeviceSyncSnapshot, userId: string, storage?: Storage): number
}

function parseJson<T>(raw: string): T | undefined {
  try {
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

function mergeObjects(current: string, incoming: string): string {
  const left = parseJson<Item>(current)
  const right = parseJson<Item>(incoming)
  if (!left || !right || Array.isArray(left) || Array.isArray(right)) return current
  return JSON.stringify({ ...left, ...right })
}

function mergeItems(left: unknown[], right: unknown[], rule: Omit<ArrayMergeRule, 'merge'>): Item[] {
  const byId = new Map<string, Item>()
  for (const value of [...left, ...right]) {
    if (!value || typeof value !== 'object') continue
    const item = value as Item
    const id = rule.idOf(item)
    if (!id) continue
    const previous = byId.get(id)
    // `>=` so the incoming copy wins a tie: a record edited on both devices
    // in the same millisecond has to resolve somehow, and preferring the
    // remote one at least makes repeated syncs converge.
    if (!previous || rule.revisionOf(item) >= rule.revisionOf(previous)) byId.set(id, item)
  }
  const merged = [...byId.values()]
  const ordered = rule.preserveOrder
    ? merged
    : merged.sort((a, b) => (rule.orderBy ?? rule.revisionOf)(a) - (rule.orderBy ?? rule.revisionOf)(b))
  return rule.cap ? ordered.slice(-rule.cap) : ordered
}

function mergeArrays(current: string, incoming: string, rule: ArrayMergeRule): string {
  const left = parseJson<unknown>(current)
  const right = parseJson<unknown>(incoming)
  if (!Array.isArray(left) || !Array.isArray(right)) return current
  return JSON.stringify(mergeItems(left, right, rule))
}

function mergeEnvelope(current: string, incoming: string, rule: EnvelopeMergeRule): string {
  const left = parseJson<Item>(current)
  const right = parseJson<Item>(incoming)
  if (!left || !right) return current

  const result: Item = { v: rule.version }
  for (const field of rule.maxFields ?? []) {
    result[field] = Math.max(Number(left[field] ?? 0), Number(right[field] ?? 0))
  }
  for (const [field, listRule] of Object.entries(rule.lists)) {
    const a = left[field]
    const b = right[field]
    // An envelope missing its lists is not one we understand; leaving the
    // local copy alone beats replacing it with a half-read one.
    if (!Array.isArray(a) && !Array.isArray(b)) return current
    result[field] = mergeItems(
      Array.isArray(a) ? a : [],
      Array.isArray(b) ? b : [],
      listRule
    )
  }
  return JSON.stringify(result)
}

export function createDeviceSync(config: DeviceSyncConfig): DeviceSync {
  const maxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES
  const maxKeys = config.maxKeys ?? DEFAULT_MAX_KEYS

  /** The rule for a key, or undefined when the key is not synced at all. */
  function ruleFor(key: string): MergeRule | undefined {
    const exact = config.keys[key]
    if (exact) return exact
    return config.prefixes?.find(([prefix]) => key.startsWith(prefix))?.[1]
  }

  function sizeOf(key: string, value: string): number {
    return new Blob([key, value]).size
  }

  function writeSecret(userId: string, secret: string): void {
    if (!userId || !HEX_32.test(secret)) return
    localStorage.setItem(config.secretKey, JSON.stringify({ userId, secret: secret.toLowerCase() }))
  }

  function loadSecret(userId: string): string | null {
    const raw = localStorage.getItem(config.secretKey)
    if (!raw) return null
    const parsed = parseJson<{ userId?: unknown; secret?: unknown }>(raw)
    return parsed?.userId === userId &&
      typeof parsed.secret === 'string' &&
      HEX_32.test(parsed.secret)
      ? parsed.secret.toLowerCase()
      : null
  }

  return {
    loadSecret,

    ensureSecret(userId) {
      const existing = loadSecret(userId)
      if (existing) return existing
      const bytes = new Uint8Array(16)
      crypto.getRandomValues(bytes)
      const secret = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
      writeSecret(userId, secret)
      return secret
    },

    snapshot(accountSyncSecret, storage = localStorage) {
      const values: Record<string, string> = {}
      let bytes = 0
      for (let index = 0; index < storage.length; index++) {
        if (Object.keys(values).length >= maxKeys) break
        const key = storage.key(index)
        if (!key || !ruleFor(key)) continue
        const value = storage.getItem(key)
        if (value === null) continue
        const size = sizeOf(key, value)
        // Skip rather than stop: one oversized conversation should not cost
        // the user every key that happens to sort after it.
        if (bytes + size > maxBytes) continue
        values[key] = value
        bytes += size
      }
      return { v: 1, createdAt: Date.now(), values, accountSyncSecret }
    },

    import(snapshot, userId, storage = localStorage) {
      if (!snapshot || snapshot.v !== 1 || !snapshot.values || typeof snapshot.values !== 'object') {
        return 0
      }
      if (snapshot.accountSyncSecret) writeSecret(userId, snapshot.accountSyncSecret)

      let imported = 0
      let bytes = 0
      for (const [key, incoming] of Object.entries(snapshot.values).slice(0, maxKeys)) {
        if (typeof incoming !== 'string') continue
        // Re-checked on the way in: the sending device's allow-list is not
        // something this one gets to trust.
        const rule = ruleFor(key)
        if (!rule) continue
        bytes += sizeOf(key, incoming)
        if (bytes > maxBytes) break

        const current = storage.getItem(key)
        const next =
          current === null ? incoming
          : rule.merge === 'object' ? mergeObjects(current, incoming)
          : rule.merge === 'array' ? mergeArrays(current, incoming, rule)
          : rule.merge === 'envelope' ? mergeEnvelope(current, incoming, rule)
          : current // 'copy': this device already has a value, so keep it.

        if (next === current) continue
        storage.setItem(key, next)
        imported++
      }

      if (imported && config.changedEvent && typeof window !== 'undefined') {
        window.dispatchEvent(new Event(config.changedEvent))
      }
      return imported
    },
  }
}
