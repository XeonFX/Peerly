import { describe, expect, it } from 'vitest'
import { DOWNLOAD_MIME_TYPE, isInlineImageType, safeFileMimeType } from './fileType'

describe('inline image types', () => {
  it('allows raster images', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']) {
      expect(isInlineImageType(mime)).toBe(true)
      expect(safeFileMimeType(mime)).toBe(mime)
    }
  })

  it('never renders SVG inline', () => {
    // SVG is a script-capable document. Rendered inline it becomes a clickable
    // blob: URL in the app's origin, and any member could exfiltrate a
    // teammate's localStorage and IndexedDB by sharing a "chart.svg".
    expect(isInlineImageType('image/svg+xml')).toBe(false)
    expect(safeFileMimeType('image/svg+xml')).toBe(DOWNLOAD_MIME_TYPE)
  })

  it('is not fooled by casing or parameters', () => {
    expect(isInlineImageType('IMAGE/SVG+XML')).toBe(false)
    expect(isInlineImageType('image/svg+xml; charset=utf-8')).toBe(false)
    expect(isInlineImageType(' image/PNG ')).toBe(true)
    expect(safeFileMimeType('image/PNG;charset=binary')).toBe('image/png')
  })

  it('forces anything script-capable or unknown to a download', () => {
    for (const mime of [
      'text/html',
      'application/xhtml+xml',
      'application/javascript',
      'image/svg',
      'not-a-mime',
      '',
      undefined,
    ]) {
      expect(safeFileMimeType(mime)).toBe(DOWNLOAD_MIME_TYPE)
      expect(isInlineImageType(mime)).toBe(false)
    }
  })
})
