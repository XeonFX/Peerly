import WebSocket from 'ws'

const site = process.env.PRODUCTION_SITE_URL
const relay = process.env.PRODUCTION_RELAY_URL
const health = process.env.PRODUCTION_RELAY_HEALTH_URL
if (!site || !relay || !health) {
  console.error('Set PRODUCTION_SITE_URL, PRODUCTION_RELAY_URL, and PRODUCTION_RELAY_HEALTH_URL')
  process.exit(2)
}

const failures = []
for (const path of ['/healthz', '/readyz', '/metrics']) {
  const response = await fetch(new URL(path, health))
  if (!response.ok) failures.push(`${path}: HTTP ${response.status}`)
}
const siteResponse = await fetch(site, { redirect: 'manual' })
if (!/max-age=\d+/.test(siteResponse.headers.get('strict-transport-security') ?? '')) {
  failures.push('site: missing HSTS')
}

await new Promise(resolve => {
  const url = new URL(relay)
  url.searchParams.set('token', 'legacy-static-token-must-fail')
  const socket = new WebSocket(url)
  const timeout = setTimeout(() => {
    failures.push('relay: legacy static token did not fail promptly')
    socket.terminate()
    resolve()
  }, 5_000)
  socket.on('unexpected-response', (_request, response) => {
    clearTimeout(timeout)
    if (![401, 403].includes(response.statusCode)) failures.push(`relay rejection: HTTP ${response.statusCode}`)
    resolve()
  })
  socket.on('open', () => {
    clearTimeout(timeout)
    failures.push('relay accepted a legacy static token')
    socket.close()
    resolve()
  })
  socket.on('error', () => {})
})

if (failures.length) {
  failures.forEach(failure => console.error(`FAIL ${failure}`))
  process.exit(1)
}
console.log('Production health, metrics, HSTS, and static-token rejection checks passed.')

