export const STORAGE_CHANGED_EVENT = 'peerly-storage-changed'

export const STORAGE_NOTICE_REMAINING_BYTES = 500 * 1024 ** 2
export const STORAGE_WARNING_REMAINING_BYTES = 250 * 1024 ** 2
export const STORAGE_CRITICAL_REMAINING_BYTES = 100 * 1024 ** 2

export type StoragePressure = 'ok' | 'notice' | 'warning' | 'critical'

export type BrowserStorageEstimate = {
  supported: boolean
  usageBytes?: number
  quotaBytes?: number
  availableBytes?: number
  usageRatio?: number
  persisted?: boolean
  measuredAt: number
}
export function storagePressure(usageBytes?: number, quotaBytes?: number): StoragePressure {
  if (usageBytes === undefined || quotaBytes === undefined || quotaBytes <= 0) return 'ok'
  const remaining = Math.max(0, quotaBytes - usageBytes)
  const ratio = usageBytes / quotaBytes
  if (remaining < STORAGE_CRITICAL_REMAINING_BYTES || ratio >= 0.95) return 'critical'
  if (remaining < STORAGE_WARNING_REMAINING_BYTES || ratio >= 0.9) return 'warning'
  if (remaining < STORAGE_NOTICE_REMAINING_BYTES || ratio >= 0.8) return 'notice'
  return 'ok'
}

/** Leave headroom for IndexedDB/browser overhead around a pending file write. */
export function hasRoomForWrite(
  estimate: BrowserStorageEstimate,
  bytes: number,
  reserveBytes = STORAGE_CRITICAL_REMAINING_BYTES
): boolean {
  if (!estimate.supported || estimate.availableBytes === undefined) return true
  return estimate.availableBytes - bytes >= reserveBytes
}

export async function estimateBrowserStorage(): Promise<BrowserStorageEstimate> {
  const manager = typeof navigator !== 'undefined' ? navigator.storage : undefined
  if (!manager?.estimate) return { supported: false, measuredAt: Date.now() }

  try {
    const { usage, quota } = await manager.estimate()
    const usageBytes = usage ?? undefined
    const quotaBytes = quota ?? undefined
    const persisted = manager.persisted ? await manager.persisted() : undefined
    return {
      supported: true,
      usageBytes,
      quotaBytes,
      availableBytes:
        usageBytes !== undefined && quotaBytes !== undefined
          ? Math.max(0, quotaBytes - usageBytes)
          : undefined,
      usageRatio:
        usageBytes !== undefined && quotaBytes && quotaBytes > 0
          ? Math.min(1, usageBytes / quotaBytes)
          : undefined,
      persisted,
      measuredAt: Date.now(),
    }
  } catch {
    return { supported: false, measuredAt: Date.now() }
  }
}

const ESTIMATE_TTL_MS = 5_000
let cachedEstimate: { value: BrowserStorageEstimate; at: number } | null = null

/**
 * estimate() costs real milliseconds; a burst of file-meta announcements was
 * paying it once per file. Anything that changes storage meaningfully calls
 * notifyStorageChanged(), which drops the cache.
 */
export async function estimateBrowserStorageCached(
  maxAgeMs = ESTIMATE_TTL_MS
): Promise<BrowserStorageEstimate> {
  if (cachedEstimate && Date.now() - cachedEstimate.at < maxAgeMs) return cachedEstimate.value
  const value = await estimateBrowserStorage()
  cachedEstimate = { value, at: Date.now() }
  return value
}

export function notifyStorageChanged(): void {
  cachedEstimate = null
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(STORAGE_CHANGED_EVENT))
}
