/**
 * File MIME types arrive from peers and decide how a file is rendered. They must
 * be treated as untrusted input.
 *
 * The dangerous case is SVG. It matches a naive `image/*` check, so it renders
 * as an inline thumbnail — but it is a *document*, not pixels, and it executes
 * script. Blob URLs inherit the app's origin, so opening one runs that script
 * with full access to the app's localStorage and IndexedDB (every file the
 * victim has ever received). Any workspace member could share a normal-looking
 * "chart.svg" and exfiltrate a teammate's files the moment they clicked it.
 *
 * Only raster formats are rendered inline. Everything else — SVG, HTML, and any
 * unrecognized type — is forced to application/octet-stream, so the browser
 * downloads it instead of executing it.
 */
const INLINE_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
])

export const DOWNLOAD_MIME_TYPE = 'application/octet-stream'

function normalize(mime: string | undefined): string {
  // Strip any ";charset=..." parameters and normalize case before matching.
  return (mime ?? '').split(';')[0].trim().toLowerCase()
}

/** True only for raster images that are safe to render in an <img> / open inline. */
export function isInlineImageType(mime: string | undefined): boolean {
  return INLINE_IMAGE_TYPES.has(normalize(mime))
}

/**
 * The type a Blob may be created with. Anything not provably inert renders as a
 * download rather than a document.
 */
export function safeFileMimeType(mime: string | undefined): string {
  const normalized = normalize(mime)
  return INLINE_IMAGE_TYPES.has(normalized) ? normalized : DOWNLOAD_MIME_TYPE
}
