import { MAX_CACHED_FILE_BYTES } from './constants'
import type { CachedFile, FileMetaPayload } from '../protocol/types'
import { loadFileBlob, saveFileBlob } from '../utils/fileStore'

type PersistFile = (id: string, mimeType: string, buffer: ArrayBuffer) => Promise<void>
type LoadFile = (id: string) => Promise<{ mimeType: string; buffer: ArrayBuffer } | null>

type CacheEntry = {
  meta: FileMetaPayload
  /** Null once evicted under memory pressure; IndexedDB remains the store. */
  buffer: ArrayBuffer | null
}

/**
 * In-memory buffers are a cache, not the source of truth — IndexedDB is. Buffers
 * are evicted oldest-first past a byte budget so a busy workspace cannot grow the
 * tab's heap without bound. Metadata is kept for evicted files so they can still
 * be located and reloaded on demand.
 */
export class FileCache {
  private readonly files = new Map<string, CacheEntry>()
  private readonly persistFile: PersistFile
  private readonly loadFile: LoadFile
  private readonly maxBytes: number
  private bytes = 0

  constructor(
    persistFile: PersistFile = saveFileBlob,
    loadFile: LoadFile = loadFileBlob,
    maxBytes: number = MAX_CACHED_FILE_BYTES
  ) {
    this.persistFile = persistFile
    this.loadFile = loadFile
    this.maxBytes = maxBytes
  }

  async set(
    meta: FileMetaPayload,
    buffer: ArrayBuffer,
    options?: { persist?: boolean }
  ): Promise<void> {
    this.dropBuffer(meta.id)
    this.files.set(meta.id, { meta, buffer })
    this.bytes += buffer.byteLength
    this.evictToBudget(meta.id)

    if (options?.persist !== false) {
      await this.persistFile(meta.id, meta.mimeType, buffer)
    }
  }

  /** Synchronous, memory-only. Undefined if the buffer was evicted. */
  get(id: string): CachedFile | undefined {
    const entry = this.files.get(id)
    if (!entry?.buffer) return undefined
    return { buffer: entry.buffer, meta: entry.meta }
  }

  /** Memory first, then IndexedDB. Use when the buffer is actually needed. */
  async load(id: string): Promise<CachedFile | undefined> {
    const entry = this.files.get(id)
    if (!entry) return undefined
    if (entry.buffer) return { buffer: entry.buffer, meta: entry.meta }

    const stored = await this.loadFile(id)
    if (!stored) return undefined
    return { buffer: stored.buffer, meta: entry.meta }
  }

  /** True when the file is known, whether or not its buffer is resident. */
  has(id: string): boolean {
    return this.files.has(id)
  }

  clear(): void {
    this.files.clear()
    this.bytes = 0
  }

  forChannel(channelId: string): CachedFile[] {
    return this.all().filter(file => file.meta.channelId === channelId)
  }

  /** Only files whose buffers are still resident. */
  all(): CachedFile[] {
    const result: CachedFile[] = []
    for (const entry of this.files.values()) {
      if (entry.buffer) result.push({ buffer: entry.buffer, meta: entry.meta })
    }
    return result
  }

  private dropBuffer(id: string): void {
    const entry = this.files.get(id)
    if (entry?.buffer) {
      this.bytes -= entry.buffer.byteLength
      entry.buffer = null
    }
  }

  private evictToBudget(keepId: string): void {
    for (const [id, entry] of this.files) {
      if (this.bytes <= this.maxBytes) return
      if (id === keepId || !entry.buffer) continue
      this.dropBuffer(id)
    }
  }
}
