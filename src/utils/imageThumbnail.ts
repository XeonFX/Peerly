/**
 * Tiny WebP preview generated at send time and carried with file metadata, so
 * history sync can show images without transferring bodies. Size-capped: the
 * result lands in every member's localStorage per message.
 */

import { isInlineImageType, isInlineVideoType } from './fileType'

const MAX_DIMENSION = 320
const MAX_CHARS = 96_000

function drawThumbnail(source: CanvasImageSource, width: number, height: number): string | undefined {
  for (const [dimension, quality] of [
    [MAX_DIMENSION, 0.6],
    [240, 0.45],
    [160, 0.35],
  ] as const) {
    const scale = Math.min(1, dimension / Math.max(width, height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/webp', quality)
    if (dataUrl.startsWith('data:image/webp') && dataUrl.length <= MAX_CHARS) return dataUrl
  }
  return undefined
}

export async function makeImageThumbnail(buffer: ArrayBuffer, mimeType: string): Promise<string | undefined> {
  try {
    const bitmap = await createImageBitmap(new Blob([buffer], { type: mimeType }))
    try {
      return drawThumbnail(bitmap, bitmap.width, bitmap.height)
    } finally {
      bitmap.close()
    }
  } catch {
    // Undecodable "image": no thumbnail is a fine outcome, not an error.
    return undefined
  }
}

async function makeVideoThumbnail(buffer: ArrayBuffer, mimeType: string): Promise<string | undefined> {
  const url = URL.createObjectURL(new Blob([buffer], { type: mimeType }))
  try {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'metadata'
    video.src = url
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('Video metadata failed to load'))
    })
    if (!video.videoWidth || !video.videoHeight) return undefined
    const target = Number.isFinite(video.duration) ? Math.min(Math.max(video.duration * 0.1, 0), 1) : 0
    if (target > 0) {
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve()
        video.onerror = () => reject(new Error('Video seek failed'))
        video.currentTime = target
      })
    }
    return drawThumbnail(video, video.videoWidth, video.videoHeight)
  } catch {
    return undefined
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function makeMediaThumbnail(
  buffer: ArrayBuffer,
  mimeType: string
): Promise<string | undefined> {
  if (isInlineImageType(mimeType)) return makeImageThumbnail(buffer, mimeType)
  if (isInlineVideoType(mimeType)) return makeVideoThumbnail(buffer, mimeType)
  return undefined
}
