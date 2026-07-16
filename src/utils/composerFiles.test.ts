import { describe, expect, it } from 'vitest'
import { filesFromClipboard } from './composerFiles'

describe('filesFromClipboard', () => {
  it('uses direct clipboard files when the browser exposes them', () => {
    const file = new File(['image'], 'paste.png', { type: 'image/png' })
    const result = filesFromClipboard({ files: [file], items: [] } as unknown as DataTransfer)
    expect(result).toEqual([file])
  })

  it('falls back to file clipboard items and ignores text items', () => {
    const file = new File(['image'], 'paste.png', { type: 'image/png' })
    const result = filesFromClipboard({
      files: [],
      items: [
        { kind: 'string', getAsFile: () => null },
        { kind: 'file', getAsFile: () => file },
      ],
    } as unknown as DataTransfer)
    expect(result).toEqual([file])
  })
})
