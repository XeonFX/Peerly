/**
 * Re-encodes any uploaded/fetched image through a canvas into a small WebP —
 * this isn't just a size optimization: rasterizing through `createImageBitmap`
 * + `canvas.drawImage` strips any embedded scripts/metadata a malicious file
 * could carry, so the resulting data URL is always safe to hand back out as
 * an avatar (see `avatarSafety.ts` for the corresponding receive-side check).
 */
const MAX_DIMENSION = 256
const WEBP_QUALITY = 0.82

export async function processAvatarImage(file: File): Promise<{ blob: Blob; dataUrl: string }> {
  return processAvatarBlob(file)
}

export async function processAvatarBlob(source: Blob): Promise<{ blob: Blob; dataUrl: string }> {
  if (!source.type.startsWith('image/')) {
    throw new Error('Please choose an image file.')
  }

  const bitmap = await createImageBitmap(source)
  const largest = Math.max(bitmap.width, bitmap.height)
  const scale = largest > MAX_DIMENSION ? MAX_DIMENSION / largest : 1
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('Could not process image.')
  }

  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      result => (result ? resolve(result) : reject(new Error('Could not convert to WebP.'))),
      'image/webp',
      WEBP_QUALITY
    )
  })

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Could not read processed image.'))
    reader.readAsDataURL(blob)
  })

  return { blob, dataUrl }
}
