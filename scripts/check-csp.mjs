import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { chromium } from '@playwright/test'

const root = resolve(import.meta.dirname, '..')
const dist = join(root, 'dist')
const headersText = await readFile(join(root, 'public', '_headers'), 'utf8')
const csp = headersText.match(/^\s*Content-Security-Policy:\s*(.+)$/m)?.[1]
if (!csp) throw new Error('public/_headers does not define Content-Security-Policy')

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
    let file = normalize(join(dist, pathname))
    if (!file.startsWith(dist)) {
      response.writeHead(403).end('Forbidden')
      return
    }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
    } catch {
      file = join(dist, 'index.html')
    }
    const body = await readFile(file)
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream',
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
    })
    response.end(body)
  } catch (error) {
    response.writeHead(500).end(String(error))
  }
})

await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Could not bind CSP test server')

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.addInitScript(() => {
    window.__peerlyCspViolations = []
    document.addEventListener('securitypolicyviolation', event => {
      window.__peerlyCspViolations.push({
        directive: event.violatedDirective,
        blocked: event.blockedURI,
      })
    })
  })
  const response = await page.goto(`http://127.0.0.1:${address.port}/`, {
    waitUntil: 'networkidle',
  })
  if (response?.headers()['content-security-policy'] !== csp) {
    throw new Error('Served CSP does not match public/_headers')
  }

  const startupViolations = await page.evaluate(() => window.__peerlyCspViolations)
  if (startupViolations.length > 0) {
    throw new Error(`Application violates CSP: ${JSON.stringify(startupViolations)}`)
  }

  // Negative control: prove the harness would fail if inline script execution
  // were accidentally allowed. The inserted script must be blocked by CSP.
  const negativeControl = await page.evaluate(async () => {
    window.__peerlyInlineRan = false
    const script = document.createElement('script')
    script.textContent = 'window.__peerlyInlineRan = true'
    document.head.appendChild(script)
    await new Promise(resolveDelay => setTimeout(resolveDelay, 50))
    return {
      ran: window.__peerlyInlineRan,
      violations: window.__peerlyCspViolations,
    }
  })
  if (negativeControl.ran || negativeControl.violations.length === 0) {
    throw new Error('CSP negative control did not block and report inline script execution')
  }

  // The production bundle registers the service worker. Reload once under its
  // control so hashed assets enter the runtime cache, then prove the app shell
  // still boots with the network disabled.
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload({ waitUntil: 'networkidle' })
  await page.context().setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await page.getByText('Peerly', { exact: true }).first().isVisible())) {
    throw new Error('PWA offline shell did not render Peerly')
  }
  await page.context().setOffline(false)

  process.stdout.write(
    'check:csp OK — app clean; negative control blocked; offline shell rendered.\n'
  )
} finally {
  await browser.close()
  await new Promise((resolveClose, reject) =>
    server.close(error => (error ? reject(error) : resolveClose()))
  )
}
