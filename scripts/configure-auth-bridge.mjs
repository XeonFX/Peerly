import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const configured = process.env.VITE_GOOGLE_AUTH_BRIDGE_ORIGIN?.trim()
if (configured) {
  const url = new URL(configured)
  if (url.protocol !== 'https:' || url.href !== `${url.origin}/`) {
    throw new Error('VITE_GOOGLE_AUTH_BRIDGE_ORIGIN must be an HTTPS origin without a path')
  }

  const headersPath = fileURLToPath(new URL('../dist/_headers', import.meta.url))
  const headers = readFileSync(headersPath, 'utf8')
  const updated = headers.replace(/^(\s*Content-Security-Policy:.*?frame-src )([^;]+);/m, (directive, prefix, sources) =>
    sources.split(/\s+/).includes(url.origin)
      ? directive
      : `${prefix}${sources} ${url.origin};`
  )
  if (!updated.split('\n').some(line => line.includes('Content-Security-Policy:') && line.includes(url.origin))) {
    throw new Error('Could not add the Google auth bridge to dist/_headers')
  }
  writeFileSync(headersPath, updated)
}
