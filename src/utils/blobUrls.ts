export class BlobUrlRegistry {
  private readonly urls = new Map<string, string>()

  /**
   * Returns the existing URL for `id`, creating one only if there isn't one.
   *
   * This must NOT revoke and recreate. File ids are per-file UUIDs, so a URL for
   * a given id always points at the same bytes — recreating gains nothing and
   * actively breaks things: revoking invalidates the URL that already-rendered
   * messages hold, and callers like mergeHistoryEntries deliberately keep the
   * existing message object rather than adopt the new URL.
   *
   * The failure is silent and easy to miss. It needs a second peer: after both
   * refresh, history sync re-runs entriesToMessages over files that are already
   * on screen, revoking their URLs. An <img> that already decoded keeps showing
   * its bitmap, so the thumbnail still looks right — until you click it and the
   * browser reports ERR_FILE_NOT_FOUND.
   */
  create(id: string, blob: Blob): string {
    const existing = this.urls.get(id)
    if (existing) return existing

    const url = URL.createObjectURL(blob)
    this.urls.set(id, url)
    return url
  }

  get(id: string): string | undefined {
    return this.urls.get(id)
  }

  revoke(id: string): void {
    const url = this.urls.get(id)
    if (!url) return
    URL.revokeObjectURL(url)
    this.urls.delete(id)
  }

  revokeAll(): void {
    for (const id of [...this.urls.keys()]) {
      this.revoke(id)
    }
  }
}